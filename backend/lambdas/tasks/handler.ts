import { APIGatewayProxyHandlerV2 } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'
import { randomUUID } from 'crypto'
import { Task, ActivityEntry, ListTasksQuery, ApiResponse, TaskStatus } from '../../shared/types'

const TABLE = process.env.TASKS_TABLE!
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method
  const path = event.rawPath
  const taskId = path.split('/')[2]

  try {
    // Activity log endpoints
    if (method === 'POST' && path.match(/\/tasks\/.+\/activity/)) {
      return addActivity(path.split('/')[2], JSON.parse(event.body || '{}'))
    }

    if (method === 'GET' && path === '/tasks') return listTasks(event.queryStringParameters as ListTasksQuery)
    if (method === 'GET' && taskId) return getTask(taskId)
    if (method === 'POST' && path === '/tasks') return createTask(JSON.parse(event.body || '{}'))
    if (method === 'PATCH' && taskId) return updateTask(taskId, JSON.parse(event.body || '{}'))
    if (method === 'DELETE' && taskId) return deleteTask(taskId)

    return respond(404, { success: false, error: 'Not found' })
  } catch (err) {
    console.error(err)
    return respond(500, { success: false, error: 'Internal server error' })
  }
}

async function createTask(body: Partial<Task>) {
  const taskId = randomUUID()
  const now = new Date().toISOString()

  const item: Record<string, unknown> = {
    PK: `TASK#${taskId}`,
    SK: `TYPE#${body.taskType}`,
    GSI1PK: `STATUS#${body.status ?? 'open'}`,
    GSI1SK: `UPDATED#${now}`,
    GSI2PK: body.assignedTo ? `STAFF#${body.assignedTo}` : 'STAFF#unassigned',
    GSI2SK: `UPDATED#${now}`,
    taskId,
    status: body.status ?? 'open',
    createdAt: now,
    updatedAt: now,
    activityLog: [],
    ...body,
  }

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }))
  return respond(201, { success: true, data: item })
}

async function getTask(taskId: string) {
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${taskId}` },
    Limit: 1,
  }))
  if (!result.Items?.length) return respond(404, { success: false, error: 'Task not found' })
  return respond(200, { success: true, data: result.Items[0] as Task })
}

async function listTasks(query: ListTasksQuery = {}) {
 const { status, taskType, assignedTo, lastKey } = query
const limit = query.limit ? parseInt(query.limit as string, 10) : 100
  if (assignedTo) {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :s',
      ExpressionAttributeValues: { ':s': `STAFF#${assignedTo}` },
      Limit: limit,
      ScanIndexForward: false,
    }))
    return respond(200, { success: true, data: result.Items as Task[], pagination: { count: result.Count ?? 0 } })
  }

  const gsi1Key = status ? `STATUS#${status}` : 'STATUS#open'
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :s',
    FilterExpression: taskType ? 'taskType = :t' : undefined,
    ExpressionAttributeValues: {
      ':s': gsi1Key,
      ...(taskType ? { ':t': taskType } : {}),
    },
    Limit: limit,
    ExclusiveStartKey: lastKey ? JSON.parse(Buffer.from(lastKey, 'base64').toString()) : undefined,
    ScanIndexForward: false,
  }))

  // If status filter is 'all', query all statuses
  if (!status) {
    const statuses: TaskStatus[] = ['open', 'in-progress', 'pending', 'completed', 'denied', 'cancelled']
    const allResults = await Promise.all(statuses.map(s =>
      ddb.send(new QueryCommand({
        TableName: TABLE,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :s',
        ExpressionAttributeValues: { ':s': `STATUS#${s}` },
        Limit: limit,
        ScanIndexForward: false,
      }))
    ))
    const items = allResults.flatMap(r => r.Items ?? [])
      .sort((a, b) => b.updatedAt > a.updatedAt ? 1 : -1)
    return respond(200, { success: true, data: items as Task[], pagination: { count: items.length } })
  }

  return respond(200, {
    success: true,
    data: result.Items as Task[],
    pagination: {
      count: result.Count ?? 0,
      nextKey: result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : undefined,
    },
  })
}

async function updateTask(taskId: string, body: Partial<Task>) {
  const now = new Date().toISOString()
  const existing = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${taskId}` },
    Limit: 1,
  }))
  if (!existing.Items?.length) return respond(404, { success: false, error: 'Task not found' })
  const sk = existing.Items[0].SK as string

  const updates: Record<string, unknown> = { ...body, updatedAt: now }
  delete updates.taskId
  delete updates.PK
  delete updates.SK

  if (updates.status) {
    updates.GSI1PK = `STATUS#${updates.status}`
    updates.GSI1SK = `UPDATED#${now}`
  }
  if (updates.assignedTo) {
    updates.GSI2PK = `STAFF#${updates.assignedTo}`
    updates.GSI2SK = `UPDATED#${now}`
  }

  const keys = Object.keys(updates)
  const expr = 'SET ' + keys.map((k, i) => `#k${i} = :v${i}`).join(', ')
  const names = Object.fromEntries(keys.map((k, i) => [`#k${i}`, k]))
  const values = Object.fromEntries(keys.map((k, i) => [`:v${i}`, updates[k]]))

  const result = await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `TASK#${taskId}`, SK: sk },
    UpdateExpression: expr,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  }))

  return respond(200, { success: true, data: result.Attributes as Task })
}

async function addActivity(taskId: string, body: ActivityEntry) {
  const now = new Date().toISOString()
  const existing = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${taskId}` },
    Limit: 1,
  }))
  if (!existing.Items?.length) return respond(404, { success: false, error: 'Task not found' })
  const sk = existing.Items[0].SK as string

  const entry: ActivityEntry = {
    id: randomUUID(),
    text: body.text,
    staffId: body.staffId,
    staffName: body.staffName,
    timestamp: now,
  }

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `TASK#${taskId}`, SK: sk },
    UpdateExpression: 'SET activityLog = list_append(if_not_exists(activityLog, :empty), :entry), updatedAt = :now',
    ExpressionAttributeValues: {
      ':entry': [entry],
      ':empty': [],
      ':now': now,
    },
  }))

  return respond(200, { success: true, data: entry })
}

async function deleteTask(taskId: string) {
  const existing = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': `TASK#${taskId}` },
    Limit: 1,
  }))
  if (!existing.Items?.length) return respond(404, { success: false, error: 'Task not found' })
  const sk = existing.Items[0].SK as string
  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `TASK#${taskId}`, SK: sk } }))
  return respond(200, { success: true })
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
