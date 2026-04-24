import { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider'
import { NotificationPref, ApiResponse } from '../../shared/types'

const TABLE = process.env.PREFS_TABLE!
const USER_POOL_ID = process.env.USER_POOL_ID!
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const cognito = new CognitoIdentityProviderClient({})

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method
  const path = event.rawPath

  try {
    // GET /prefs — list all users with their prefs
    if (method === 'GET' && path === '/prefs') return listPrefs()

    // GET /prefs/:userId — get one user's prefs
    if (method === 'GET' && path.startsWith('/prefs/')) return getPrefs(path.split('/')[2])

    // PUT /prefs/:userId — save one user's prefs
    if (method === 'PUT' && path.startsWith('/prefs/')) return savePrefs(path.split('/')[2], JSON.parse(event.body || '{}'))

    return respond(404, { success: false, error: 'Not found' })
  } catch (err) {
    console.error(err)
    return respond(500, { success: false, error: 'Internal server error' })
  }
}

async function listPrefs() {
  // Get all Cognito users
  const cognitoResult = await cognito.send(new ListUsersCommand({
    UserPoolId: USER_POOL_ID,
    Limit: 60,
  }))

  const cognitoUsers = (cognitoResult.Users ?? []).map(u => {
    const attrs = Object.fromEntries((u.Attributes ?? []).map(a => [a.Name, a.Value]))
    return {
      userId: attrs.sub ?? u.Username ?? '',
      email: attrs.email ?? '',
      name: attrs.name ?? attrs.email ?? u.Username ?? '',
    }
  })

  // Get all saved prefs
  const prefsResult = await ddb.send(new ScanCommand({ TableName: TABLE }))
  const prefsMap = Object.fromEntries((prefsResult.Items ?? []).map(p => [p.userId, p]))

  // Merge — Cognito is source of truth for users, DynamoDB for prefs
  const merged = cognitoUsers.map(u => ({
    userId: u.userId,
    name: prefsMap[u.userId]?.name ?? u.name,
    email: u.email,
    emailEnabled: prefsMap[u.userId]?.emailEnabled ?? false,
    smsEnabled: prefsMap[u.userId]?.smsEnabled ?? false,
    phone: prefsMap[u.userId]?.phone ?? '',
    alertTypes: prefsMap[u.userId]?.alertTypes ?? [],
    updatedAt: prefsMap[u.userId]?.updatedAt ?? '',
  } as NotificationPref))

  return respond(200, { success: true, data: merged })
}

async function getPrefs(userId: string) {
  const result = await ddb.send(new GetCommand({
    TableName: TABLE,
    Key: { userId },
  }))
  if (!result.Item) return respond(200, { success: true, data: null })
  return respond(200, { success: true, data: result.Item as NotificationPref })
}

async function savePrefs(userId: string, body: Partial<NotificationPref>) {
  const now = new Date().toISOString()
  const item: NotificationPref = {
    userId,
    name: body.name ?? '',
    email: body.email ?? '',
    emailEnabled: body.emailEnabled ?? false,
    smsEnabled: body.smsEnabled ?? false,
    phone: body.phone ?? '',
    alertTypes: body.alertTypes ?? [],
    updatedAt: now,
  }
  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }))
  return respond(200, { success: true, data: item })
}

function respond(statusCode: number, body: ApiResponse<unknown>) {
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
