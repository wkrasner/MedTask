import { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { createHash, randomBytes } from 'crypto'

const sm = new SecretsManagerClient({})
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const TOKENS_TABLE = process.env.TOKENS_TABLE!
const SECRET_ID = process.env.ECW_SECRET_ID!
const API_URL = process.env.API_URL!
const APP_URL = process.env.APP_URL!

interface EcwSecret {
  clientId: string
  clientSecret: string
  fhirBaseUrl: string
  authUrl: string
  tokenUrl: string
}

async function getSecret(): Promise<EcwSecret> {
  const result = await sm.send(new GetSecretValueCommand({ SecretId: SECRET_ID }))
  return JSON.parse(result.SecretString!)
}

async function getTokens(userId: string) {
  const result = await ddb.send(new GetCommand({ TableName: TOKENS_TABLE, Key: { userId } }))
  return result.Item ?? null
}

async function saveTokens(userId: string, tokens: Record<string, unknown>) {
  await ddb.send(new PutCommand({
    TableName: TOKENS_TABLE,
    Item: { userId, ...tokens, updatedAt: new Date().toISOString() },
  }))
}

// Generate PKCE code verifier and challenge
function generatePKCE() {
  const codeVerifier = randomBytes(32).toString('base64url')
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
  return { codeVerifier, codeChallenge }
}

async function refreshAccessToken(secret: EcwSecret, refreshToken: string, codeVerifier?: string) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: secret.clientId,
    client_secret: secret.clientSecret,
  })
  if (codeVerifier) params.set('code_verifier', codeVerifier)
  const res = await fetch(secret.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
  return res.json()
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const path = event.rawPath
  const method = event.requestContext.http.method

  try {
    const secret = await getSecret()

    // ── GET /fhir/auth — redirect user to ECW login ──────────────────────────
    if (method === 'GET' && path === '/fhir/auth') {
      const userId = event.queryStringParameters?.userId ?? 'unknown'

      // Generate PKCE
      const { codeVerifier, codeChallenge } = generatePKCE()

      // Store code verifier temporarily so we can use it in callback
      await saveTokens(`pkce_${userId}`, { codeVerifier, expiresAt: Date.now() + 600000 })

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: secret.clientId,
        redirect_uri: `${API_URL}/fhir/callback`,
        scope: 'openid launch/patient patient/AllergyIntolerance.read patient/Condition.read patient/Encounter.read patient/Medication.read patient/MedicationRequest.read patient/Observation.read patient/Procedure.read patient/DiagnosticReport.read patient/FamilyMemberHistory.read patient/Immunization.read patient/DocumentReference.read user/Encounter.read',
        state: userId,
        aud: secret.fhirBaseUrl,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      })

      const authUrl = `${secret.authUrl}?${params.toString()}`
      console.log('Auth URL:', authUrl)
      return { statusCode: 302, headers: { Location: authUrl }, body: '' }
    }

    // ── GET /fhir/callback — exchange code for tokens ────────────────────────
    if (method === 'GET' && path === '/fhir/callback') {
      const { code, state: userId, error, error_description } = event.queryStringParameters ?? {}

      if (error) {
        console.error('ECW auth error:', error, error_description)
        return { statusCode: 302, headers: { Location: `${APP_URL}?ecw_error=${encodeURIComponent(error_description ?? error)}` }, body: '' }
      }

      if (!code || !userId) return respond(400, { error: 'Missing code or state' })

      // Retrieve stored code verifier
      const pkceItem = await getTokens(`pkce_${userId}`)
      const codeVerifier = pkceItem?.codeVerifier

      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${API_URL}/fhir/callback`,
        client_id: secret.clientId,
        client_secret: secret.clientSecret,
      })
      if (codeVerifier) params.set('code_verifier', codeVerifier)

      console.log('Token exchange params:', params.toString())

      const res = await fetch(secret.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      })

      const responseText = await res.text()
      console.log('Token response status:', res.status)
      console.log('Token response body:', responseText)

      if (!res.ok) {
        return { statusCode: 302, headers: { Location: `${APP_URL}?ecw_error=${encodeURIComponent(responseText)}` }, body: '' }
      }

      const tokens = JSON.parse(responseText)
      await saveTokens(userId, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + (tokens.expires_in * 1000),
        patient: tokens.patient,
        codeVerifier,
      })

      return {
        statusCode: 302,
        headers: { Location: `${APP_URL}?ecw_connected=true` },
        body: '',
      }
    }

    // ── GET /fhir/status ──────────────────────────────────────────────────────
    if (method === 'GET' && path === '/fhir/status') {
      const userId = event.queryStringParameters?.userId
      if (!userId) return respond(400, { error: 'Missing userId' })
      const tokens = await getTokens(userId)
      const connected = !!(tokens?.accessToken)
      const expired = tokens ? tokens.expiresAt < Date.now() : true
      return respond(200, { connected, expired, needsRefresh: connected && expired })
    }

    // ── POST /fhir/refresh ────────────────────────────────────────────────────
    if (method === 'POST' && path === '/fhir/refresh') {
      const { userId } = JSON.parse(event.body ?? '{}')
      if (!userId) return respond(400, { error: 'Missing userId' })
      const tokens = await getTokens(userId)
      if (!tokens?.refreshToken) return respond(401, { error: 'No refresh token — user must re-authenticate' })
      const newTokens = await refreshAccessToken(secret, tokens.refreshToken, tokens.codeVerifier)
      await saveTokens(userId, {
        ...tokens,
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token ?? tokens.refreshToken,
        expiresAt: Date.now() + (newTokens.expires_in * 1000),
      })
      return respond(200, { success: true })
    }

    return respond(404, { error: 'Not found' })
  } catch (err) {
    console.error('FHIR auth error:', err)
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
