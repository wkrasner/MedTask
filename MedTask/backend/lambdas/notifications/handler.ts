import { DynamoDBStreamHandler } from "aws-lambda";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { AttributeValue } from "@aws-sdk/client-dynamodb";
import { Task, TaskStatus } from "../../shared/types";

const sns = new SNSClient({});
const ses = new SESv2Client({});

const FROM_EMAIL = process.env.FROM_EMAIL!;
const ALERT_TOPIC_ARN = process.env.ALERT_TOPIC_ARN!;

// ─── Stream handler ───────────────────────────────────────────────────────────

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    if (record.eventName !== "MODIFY" && record.eventName !== "INSERT") continue;

    const newImage = record.dynamodb?.NewImage;
    const oldImage = record.dynamodb?.OldImage;
    if (!newImage) continue;

    const task = unmarshall(newImage as Record<string, AttributeValue>) as Task;
    const oldTask = oldImage ? (unmarshall(oldImage as Record<string, AttributeValue>) as Task) : null;

    await handleTaskChange(task, oldTask);
  }
};

// ─── Business logic ───────────────────────────────────────────────────────────

async function handleTaskChange(task: Task, old: Task | null) {
  const isNew = !old;
  const statusChanged = old && old.status !== task.status;

  // Notify on urgent new tasks
  if (isNew && task.priority === "urgent") {
    await publishSns(
      `🚨 Urgent ${task.taskType} created for ${task.patientName}`,
      `Task ID: ${task.taskId}\nPriority: URGENT\nNotes: ${task.notes}`
    );
  }

  // Notify on status transitions of interest
  if (statusChanged) {
    const interesting: TaskStatus[] = ["completed", "cancelled"];
    if (interesting.includes(task.status)) {
      await sendEmail(
        `Task ${task.status}: ${task.taskType} for ${task.patientName}`,
        buildStatusEmail(task)
      );
    }
  }

  // Prior auth: alert when due date is today or overdue
  if (task.taskType === "prior-auth" && task.dueDate && task.status === "open") {
    const due = new Date(task.dueDate);
    const now = new Date();
    if (due <= now) {
      await publishSns(
        `Prior Auth overdue: ${task.patientName}`,
        `Auth for ${(task as any).medicationOrProcedure} is overdue. Task: ${task.taskId}`
      );
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function publishSns(subject: string, message: string) {
  try {
    await sns.send(new PublishCommand({
      TopicArn: ALERT_TOPIC_ARN,
      Subject: subject,
      Message: message,
    }));
  } catch (err) {
    console.error("SNS publish failed", err);
  }
}

async function sendEmail(subject: string, body: string) {
  try {
    await ses.send(new SendEmailCommand({
      FromEmailAddress: FROM_EMAIL,
      Destination: { ToAddresses: [FROM_EMAIL] }, // replace with staff routing logic
      Content: {
        Simple: {
          Subject: { Data: subject },
          Body: { Text: { Data: body } },
        },
      },
    }));
  } catch (err) {
    console.error("SES send failed", err);
  }
}

function buildStatusEmail(task: Task): string {
  return [
    `Task type: ${task.taskType}`,
    `Patient: ${task.patientName} (DOB: ${task.patientDob})`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
    `Updated: ${task.updatedAt}`,
    task.completedAt ? `Completed at: ${task.completedAt}` : "",
    `Notes: ${task.notes}`,
  ].filter(Boolean).join("\n");
}
