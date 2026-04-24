import { DynamoDBStreamHandler } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { unmarshall } from '@aws-sdk/util-dynamodb'
import { AttributeValue } from '@aws-sdk/client-dynamodb'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { NotificationPref, Task, AlertType } from '../../shared/types'

const PREFS_TABLE = process.env.PREFS_TABLE!
const FROM_EMAIL = process.env.FROM_EMAIL!
const APP_URL = process.env.APP_URL!

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const ses = new SESv2Client({})
const sns = new SNSClient({})

export const handler: DynamoDBStreamHandler = async (event) => {
  // Load all notification prefs once per invocation
  const prefsResult = await ddb.send(new ScanCommand({ TableName: PREFS_TABLE }))
  const allPrefs = (prefsResult.Items ?? []) as NotificationPref[]

  for (const record of event.Records) {
    if (!record.dynamodb?.NewImage) continue
    const newTask = unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>) as Task
    const oldTask = record.dynamodb.OldImage
      ? (unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>) as Task)
      : null

    const isNew = record.eventName === 'INSERT'
    const isUpdate = record.eventName === 'MODIFY'

    // Determine which alert type this event maps to
    const alertTypes: AlertType[] = []

    if (isNew && newTask.priority === 'urgent') alertTypes.push('task_created_urgent')
    if (isNew) alertTypes.push('task_status_changed')
    if (isUpdate && oldTask && oldTask.status !== newTask.status) {
      alertTypes.push('task_status_changed')
      if (newTask.status === 'denied') alertTypes.push('task_denied')
    }

    if (alertTypes.length === 0) continue

    // Find all prefs subscribers for these alert types
    const recipients = allPrefs.filter(p =>
      p.alertTypes.some(at => alertTypes.includes(at))
    )

    for (const pref of recipients) {
      const subject = buildSubject(newTask, alertTypes, isNew, oldTask)
      const body = buildBody(newTask, alertTypes, isNew, oldTask)

      if (pref.emailEnabled && pref.email) {
        await sendEmail(pref.email, subject, body).catch(e => console.error('SES error', e))
      }
      if (pref.smsEnabled && pref.phone) {
        await sendSms(pref.phone, `MedTask: ${subject}\n${APP_URL}`).catch(e => console.error('SNS error', e))
      }
    }
  }
}

function buildSubject(task: Task, alertTypes: AlertType[], isNew: boolean, oldTask: Task | null): string {
  if (alertTypes.includes('task_denied')) return `Task DENIED — ${task.patientName} (${task.taskType})`
  if (alertTypes.includes('task_created_urgent')) return `🚨 URGENT task created — ${task.patientName}`
  if (isNew) return `New task: ${task.taskType} for ${task.patientName}`
  if (oldTask) return `Task updated: ${task.patientName} — ${oldTask.status} → ${task.status}`
  return `Task update: ${task.patientName}`
}

function buildBody(task: Task, alertTypes: AlertType[], isNew: boolean, oldTask: Task | null): string {
  const lines = [
    `Patient: ${task.patientName}`,
    `DOB: ${task.patientDob}`,
    `ECW #: ${task.ecwAccountNumber}`,
    `Task type: ${task.taskType}`,
    `Priority: ${task.priority}`,
    `Status: ${task.status}`,
    oldTask && oldTask.status !== task.status ? `Previous status: ${oldTask.status}` : '',
    task.assignedName ? `Assigned to: ${task.assignedName}` : '',
    task.dueDate ? `Due: ${task.dueDate}` : '',
    '',
    `Notes: ${task.notes}`,
    '',
    `View task: ${APP_URL}`,
  ].filter(Boolean)
  return lines.join('\n')
}

async function sendEmail(to: string, subject: string, body: string) {
  await ses.send(new SendEmailCommand({
    FromEmailAddress: FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject },
        Body: { Text: { Data: body } },
      },
    },
  }))
}

async function sendSms(phone: string, message: string) {
  await sns.send(new PublishCommand({
    PhoneNumber: phone,
    Message: message,
    MessageAttributes: {
      'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
    },
  }))
}
