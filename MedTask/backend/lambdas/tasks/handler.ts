import { APIGatewayProxyHandlerV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";
import {
  Task,
  CreateTaskRequest,
  UpdateTaskRequest,
  ListTasksQuery,
  ApiResponse,
} from "../../shared/types";

const TABLE = process.env.TASKS_TABLE!;
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ─── Router ──────────────────────────────────────────────────────────────────

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  try {
    if (method === "GET" && path === "/tasks") return listTasks(event.queryStringParameters as ListTasksQuery);
    if (method === "GET" && path.startsWith("/tasks/")) return getTask(path.split("/")[2]);
    if (method === "POST" && path === "/tasks") return createTask(JSON.parse(event.body || "{}"));
    if (method === "PATCH" && path.startsWith("/tasks/")) return updateTask(path.split("/")[2], JSON.parse(event.body || "{}"));
    if (method === "DELETE" && path.startsWith("/tasks/")) return deleteTask(path.split("/")[2]);

    return respond(404, { success: false, error: "Not found" });
  } catch (err) {
    console.error(err);
    return respond(500, { success: false, error: "Internal server error" });
  }
};

// ─── Handlers ────────────────────────────────────────────────────────────────

async function createTask(body: CreateTaskRequest): Promise<ReturnType<typeof respond>> {
  const taskId = randomUUID();
  const now = new Date().toISOString();

  const item: Record<string, unknown> = {
    PK: `TASK#${taskId}`,
    SK: `TYPE#${body.taskType}`,
    GSI1PK: `STATUS#${body.status ?? "open"}`,
    GSI1SK: `UPDATED#${now}`,
    GSI2PK: body.assignedTo ? `STAFF#${body.assignedTo}` : "STAFF#unassigned",
    GSI2SK: `UPDATED#${now}`,
    taskId,
    status: "open",
    createdAt: now,
    updatedAt: now,
    ...body,
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));
  return respond(201, { success: true, data: item });
}

async function getTask(taskId: string): Promise<ReturnType<typeof respond>> {
  // We need to query because SK (taskType) is unknown at this point
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": `TASK#${taskId}` },
    Limit: 1,
  }));

  if (!result.Items?.length) return respond(404, { success: false, error: "Task not found" });
  return respond(200, { success: true, data: result.Items[0] as Task });
}

async function listTasks(query: ListTasksQuery = {}): Promise<ReturnType<typeof respond>> {
  const { status, taskType, assignedTo, limit = 50, lastKey } = query;

  // Prefer the status GSI for filtering by status; fall back to full scan for taskType
  if (status) {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :s",
      FilterExpression: taskType ? "taskType = :t" : undefined,
      ExpressionAttributeValues: {
        ":s": `STATUS#${status}`,
        ...(taskType ? { ":t": taskType } : {}),
      },
      Limit: limit,
      ExclusiveStartKey: lastKey ? JSON.parse(Buffer.from(lastKey, "base64").toString()) : undefined,
      ScanIndexForward: false,
    }));

    return respond(200, {
      success: true,
      data: result.Items as Task[],
      pagination: {
        count: result.Count ?? 0,
        nextKey: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString("base64")
          : undefined,
      },
    });
  }

  // Filter by assigned staff
  if (assignedTo) {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE,
      IndexName: "GSI2",
      KeyConditionExpression: "GSI2PK = :s",
      ExpressionAttributeValues: { ":s": `STAFF#${assignedTo}` },
      Limit: limit,
      ScanIndexForward: false,
    }));
    return respond(200, { success: true, data: result.Items as Task[], pagination: { count: result.Count ?? 0 } });
  }

  // Default: all tasks, newest first via GSI1 open status
  const result = await ddb.send(new QueryCommand({
    TableName: TABLE,
    IndexName: "GSI1",
    KeyConditionExpression: "GSI1PK = :s",
    ExpressionAttributeValues: { ":s": "STATUS#open" },
    Limit: limit,
    ScanIndexForward: false,
  }));
  return respond(200, { success: true, data: result.Items as Task[], pagination: { count: result.Count ?? 0 } });
}

async function updateTask(taskId: string, body: UpdateTaskRequest): Promise<ReturnType<typeof respond>> {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { ...body, updatedAt: now };
  delete updates.taskId;

  if (updates.status) {
    updates.GSI1PK = `STATUS#${updates.status}`;
    updates.GSI1SK = `UPDATED#${now}`;
  }
  if (updates.assignedTo) {
    updates.GSI2PK = `STAFF#${updates.assignedTo}`;
    updates.GSI2SK = `UPDATED#${now}`;
  }

  // Build dynamic update expression
  const keys = Object.keys(updates);
  const expr = "SET " + keys.map((k, i) => `#k${i} = :v${i}`).join(", ");
  const names = Object.fromEntries(keys.map((k, i) => [`#k${i}`, k]));
  const values = Object.fromEntries(keys.map((k, i) => [`:v${i}`, updates[k]]));

  // We need PK + SK — fetch the task to get SK first
  const existing = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": `TASK#${taskId}` },
    Limit: 1,
  }));
  if (!existing.Items?.length) return respond(404, { success: false, error: "Task not found" });
  const sk = existing.Items[0].SK as string;

  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { PK: `TASK#${taskId}`, SK: sk },
    UpdateExpression: expr,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
    ReturnValues: "ALL_NEW",
  }));

  return respond(200, { success: true });
}

async function deleteTask(taskId: string): Promise<ReturnType<typeof respond>> {
  const existing = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "PK = :pk",
    ExpressionAttributeValues: { ":pk": `TASK#${taskId}` },
    Limit: 1,
  }));
  if (!existing.Items?.length) return respond(404, { success: false, error: "Task not found" });
  const sk = existing.Items[0].SK as string;

  await ddb.send(new DeleteCommand({ TableName: TABLE, Key: { PK: `TASK#${taskId}`, SK: sk } }));
  return respond(200, { success: true });
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function respond(statusCode: number, body: ApiResponse<unknown>) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  };
}
