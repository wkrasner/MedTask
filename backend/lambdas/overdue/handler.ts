import { ScheduledHandler } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import { Task, NotificationPref } from '../../shared/types'

const TASKS_TABLE = process.env.TASKS_TABLE!
const PREFS_TABLE = process.env.PREFS_TABLE!
const FROM_EMAIL = process.env.FROM_EMAIL!
const APP_URL = process.env.APP_URL!

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const ses = new SESv2Client({})
const sns = new SNSClient({})

export const handler: ScheduledHandler = async () => {
  const today = new Date().toISOString().slice(0, 10)

  // Scan all open/in-progress/pending tasks across statuses
  const activeStatuses = ['open', 'in-progress', 'pending']
  const allTasks: Task[] = []

  for (const status of activeStatuses) {
    const result = await ddb.send(new QueryCommand({
      TableName: TASKS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :s',
      ExpressionAttributeValues: { ':s': `STATUS#${status}` },
    }))
    allTasks.push(...(result.Items ?? []) as Task[])
  }

  // Filter to overdue tasks
  const overdueTasks = allTasks.filter(t => t.dueDate && t.dueDate < today)

  if (overdueTasks.length === 0) {
    console.log('No overdue tasks today')
    return
  }

  console.log(`Found ${overdueTasks.length} overdue tasks`)

  // Get subscribers for overdue alerts
  const prefsResult = await ddb.send(new ScanCommand({ TableName: PREFS_TABLE }))
  const recipients = ((prefsResult.Items ?? []) as NotificationPref[])
    .filter(p => p.alertTypes.includes('task_overdue'))

  if (recipients.length === 0) return

  // Build summary email
  const subject = `MedTask Daily: ${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? 's' : ''}`
  const body = [
    `Daily overdue task summary — ${new Date().toLocaleDateString('en-US')}`,
    `${overdueTasks.length} task${overdueTasks.length !== 1 ? 's are' : ' is'} past due:`,
    '',
    ...overdueTasks.map(t =>
      `• ${t.patientName} (ECW: ${t.ecwAccountNumber}) — ${t.taskType} — Due: ${t.dueDate} — Assigned: ${t.assignedName ?? 'Unassigned'}`
    ),
    '',
    `View all tasks: ${APP_URL}`,
  ].join('\n')

  const smsText = `MedTask: ${overdueTasks.length} overdue task${overdueTasks.length !== 1 ? 's' : ''}. Check ${APP_URL}`

  // Send to each recipient
  for (const pref of recipients) {
    if (pref.emailEnabled && pref.email) {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: FROM_EMAIL,
        Destination: { ToAddresses: [pref.email] },
        Content: {
          Simple: {
            Subject: { Data: subject },
            Body: { Text: { Data: body } },
          },
        },
      })).catch(e => console.error('SES overdue error', pref.email, e))
    }

    if (pref.smsEnabled && pref.phone) {
      await sns.send(new PublishCommand({
        PhoneNumber: pref.phone,
        Message: smsText,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
        },
      })).catch(e => console.error('SNS overdue error', pref.phone, e))
    }
  }

  console.log(`Overdue alerts sent to ${recipients.length} recipient(s)`)
}
