import { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'

const sm = new SecretsManagerClient({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const TOKENS_TABLE = process.env.TOKENS_TABLE!
const SECRET_ID = process.env.ECW_SECRET_ID!

interface EcwSecret {
  clientId: string
  clientSecret: string
  fhirBaseUrl: string
  tokenUrl: string
}

async function getSecret(): Promise<EcwSecret> {
  const result = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ID }))
  return JSON.parse(result.SecretString!)
}

async function getValidToken(userId: string, secret: EcwSecret): Promise<string> {
  const result = await ddb.send(new GetCommand({ TableName: TOKENS_TABLE, Key: { userId } }))
  const tokens = result.Item
  if (!tokens?.accessToken) throw new Error('ECW_NOT_CONNECTED')

  // If token is still valid (with 60s buffer), use it
  if (tokens.expiresAt > Date.now() + 60000) return tokens.accessToken

  // Refresh expired token
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: secret.clientId,
    client_secret: secret.clientSecret,
  })
  const res = await fetch(secret.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) throw new Error('ECW_TOKEN_EXPIRED')
  const newTokens = await res.json()
  await ddb.send(new PutCommand({
    TableName: TOKENS_TABLE,
    Item: {
      ...tokens,
      userId,
      accessToken: newTokens.access_token,
      refreshToken: newTokens.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + (newTokens.expires_in * 1000),
      updatedAt: new Date().toISOString(),
    },
  }))
  return newTokens.access_token
}

async function fhirGet(baseUrl: string, token: string, path: string) {
  const res = await fetch(`${baseUrl}/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`FHIR ${path} failed: ${res.status} ${text}`)
  }
  return res.json()
}

// Parse FHIR Patient resource into clean object
function parsePatient(resource: any) {
  const name = resource.name?.[0]
  const given = name?.given?.join(' ') ?? ''
  const family = name?.family ?? ''
  const fullName = `${family}, ${given}`.trim()

  const dob = resource.birthDate ?? ''
  const mrn = resource.identifier?.find((i: any) =>
    i.type?.coding?.some((c: any) => c.code === 'MR')
  )?.value ?? resource.identifier?.[0]?.value ?? ''

  const phone = resource.telecom?.find((t: any) => t.system === 'phone')?.value ?? ''
  const email = resource.telecom?.find((t: any) => t.system === 'email')?.value ?? ''

  const address = resource.address?.[0]
  const addressStr = address
    ? `${address.line?.join(' ') ?? ''}, ${address.city ?? ''}, ${address.state ?? ''} ${address.postalCode ?? ''}`.trim()
    : ''

  return { id: resource.id, fullName, dob, mrn, phone, email, address: addressStr, gender: resource.gender ?? '' }
}

// Parse FHIR MedicationRequest resources
function parseMedications(bundle: any): string[] {
  const entries = bundle.entry ?? []
  return entries
    .filter((e: any) => e.resource?.status === 'active')
    .map((e: any) => {
      const med = e.resource
      return med.medicationCodeableConcept?.text
        ?? med.medicationCodeableConcept?.coding?.[0]?.display
        ?? med.medicationReference?.display
        ?? 'Unknown medication'
    })
    .filter(Boolean)
    .slice(0, 10)
}

// Parse FHIR Encounter resources — get last few visits
function parseEncounters(bundle: any) {
  const entries = bundle.entry ?? []
  return entries
    .map((e: any) => {
      const enc = e.resource
      const classCode = enc.class?.code ?? enc.class?.system ?? ''
      const classDisplay = enc.class?.display ?? classCode

      // Map ECW class codes to readable labels
      const typeMap: Record<string, string> = {
        AMB: 'Office Visit',
        VR: 'Telehealth',
        PHN: 'Phone',
        IMP: 'Inpatient',
        EMER: 'Emergency',
      }
      const visitType = typeMap[classCode.toUpperCase()] ?? classDisplay ?? 'Visit'

      const date = enc.period?.start ?? enc.period?.end ?? ''
      const provider = enc.participant?.[0]?.individual?.display ?? ''
      const reason = enc.reasonCode?.[0]?.text
        ?? enc.reasonCode?.[0]?.coding?.[0]?.display
        ?? ''
      const status = enc.status ?? ''

      return { date, visitType, provider, reason, status }
    })
    .filter((e: any) => e.date)
    .sort((a: any, b: any) => b.date.localeCompare(a.date))
    .slice(0, 5)
}

// Parse active conditions
function parseConditions(bundle: any): string[] {
  const entries = bundle.entry ?? []
  return entries
    .filter((e: any) => e.resource?.clinicalStatus?.coding?.[0]?.code === 'active')
    .map((e: any) => {
      const cond = e.resource
      return cond.code?.text ?? cond.code?.coding?.[0]?.display ?? ''
    })
    .filter(Boolean)
    .slice(0, 10)
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const path = event.rawPath
  const method = event.requestContext.http.method

  // Get userId from Authorization header (Cognito sub)
  const authHeader = event.headers?.authorization ?? event.headers?.Authorization ?? ''
  const userId = event.queryStringParameters?.userId ?? 'unknown'

  try {
    const secret = await getSecret()

    let token: string
    try {
      token = await getValidToken(userId, secret)
    } catch (err) {
      const msg = (err as Error).message
      if (msg === 'ECW_NOT_CONNECTED') {
        return respond(401, { error: 'ECW_NOT_CONNECTED', message: 'User has not connected ECW account' })
      }
      if (msg === 'ECW_TOKEN_EXPIRED') {
        return respond(401, { error: 'ECW_TOKEN_EXPIRED', message: 'ECW session expired, please reconnect' })
      }
      throw err
    }

    const base = secret.fhirBaseUrl

    // ── GET /fhir/search — search patients ───────────────────────────────────
    if (method === 'GET' && path === '/fhir/search') {
      const { name, dob, phone, mrn } = event.queryStringParameters ?? {}

      if (!name && !dob && !phone && !mrn) {
        return respond(400, { error: 'Provide at least one search parameter: name, dob, phone, or mrn' })
      }

      const params = new URLSearchParams()
      if (name) params.set('name', name)
      if (dob) params.set('birthdate', dob)
      if (phone) params.set('phone', phone)
      if (mrn) params.set('identifier', mrn)
      params.set('_count', '10')

      const bundle = await fhirGet(base, token, `Patient?${params.toString()}`)
      const patients = (bundle.entry ?? []).map((e: any) => parsePatient(e.resource))

      return respond(200, { success: true, data: patients, total: bundle.total ?? patients.length })
    }

    // ── GET /fhir/patient/{id} — get full patient details ───────────────────
    if (method === 'GET' && path.match(/^\/fhir\/patient\/[^/]+$/)) {
      const patientId = path.split('/').pop()!

      // Fetch patient demographics, meds, encounters, and conditions in parallel
      const [patientResource, medsBundle, encountersBundle, conditionsBundle] = await Promise.all([
        fhirGet(base, token, `Patient/${patientId}`),
        fhirGet(base, token, `MedicationRequest?patient=${patientId}&status=active&_count=20`),
        fhirGet(base, token, `Encounter?patient=${patientId}&_sort=-date&_count=5`),
        fhirGet(base, token, `Condition?patient=${patientId}&clinical-status=active&_count=20`),
      ])

      const patient = parsePatient(patientResource)
      const medications = parseMedications(medsBundle)
      const encounters = parseEncounters(encountersBundle)
      const conditions = parseConditions(conditionsBundle)

      return respond(200, {
        success: true,
        data: { ...patient, medications, encounters, conditions },
      })
    }

    return respond(404, { error: 'Not found' })
  } catch (err) {
    console.error('FHIR search error:', err)
    return respond(500, { error: 'Internal server error', detail: (err as Error).message })
  }
}

function respond(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    },
    body: JSON.stringify(body),
  }
}
