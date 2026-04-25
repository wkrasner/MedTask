import { APIGatewayProxyHandlerV2, ScheduledHandler } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import * as ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const ses = new SESv2Client({})

const TASKS_TABLE = process.env.TASKS_TABLE!
const PREFS_TABLE = process.env.PREFS_TABLE!
const FROM_EMAIL = process.env.FROM_EMAIL!

// ── Types ─────────────────────────────────────────────────────────────────────
interface ReportFilters {
  taskType?: string
  status?: string
  priority?: string
  assignedTo?: string
  startDate?: string
  endDate?: string
  dueDateFrom?: string
  dueDateTo?: string
}

interface TaskRow {
  taskId: string
  taskType: string
  status: string
  priority: string
  patientName: string
  patientDob: string
  ecwAccountNumber: string
  assignedName: string
  notes: string
  dueDate: string
  createdAt: string
  updatedAt: string
  daysInQueue: number
  activityLog: string
  [key: string]: unknown
}

// ── Fetch all tasks ───────────────────────────────────────────────────────────
async function fetchAllTasks(filters: ReportFilters): Promise<TaskRow[]> {
  const statuses = filters.status
    ? [filters.status]
    : ['open', 'in-progress', 'pending', 'completed', 'denied', 'cancelled']

  const allTasks: TaskRow[] = []

  for (const status of statuses) {
    const result = await ddb.send(new QueryCommand({
      TableName: TASKS_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :s',
      ExpressionAttributeValues: { ':s': `STATUS#${status}` },
      Limit: 1000,
    }))
    allTasks.push(...(result.Items ?? []) as TaskRow[])
  }

  const today = new Date()

  return allTasks
    .filter(t => {
      if (filters.taskType && t.taskType !== filters.taskType) return false
      if (filters.priority && t.priority !== filters.priority) return false
      if (filters.assignedTo && t.assignedTo !== filters.assignedTo) return false
      if (filters.startDate && t.createdAt < filters.startDate) return false
      if (filters.endDate && t.createdAt > filters.endDate + 'T23:59:59') return false
      if (filters.dueDateFrom && t.dueDate && t.dueDate < filters.dueDateFrom) return false
      if (filters.dueDateTo && t.dueDate && t.dueDate > filters.dueDateTo) return false
      return true
    })
    .map(t => ({
      ...t,
      daysInQueue: t.createdAt
        ? Math.floor((today.getTime() - new Date(t.createdAt).getTime()) / 86400000)
        : 0,
      activityLog: Array.isArray(t.activityLog)
        ? (t.activityLog as any[]).map((e: any) =>
            `[${new Date(e.timestamp).toLocaleDateString()} ${e.staffName}]: ${e.text}`
          ).join(' | ')
        : '',
    }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

// ── Build summary data ────────────────────────────────────────────────────────
function buildSummary(tasks: TaskRow[]) {
  const byType: Record<string, Record<string, number>> = {}
  const byStatus: Record<string, number> = {}
  const byPriority: Record<string, number> = {}
  const byStaff: Record<string, number> = {}

  for (const t of tasks) {
    if (!byType[t.taskType]) byType[t.taskType] = {}
    byType[t.taskType][t.status] = (byType[t.taskType][t.status] ?? 0) + 1
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1
    byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1
    const staff = t.assignedName || 'Unassigned'
    byStaff[staff] = (byStaff[staff] ?? 0) + 1
  }

  return { byType, byStatus, byPriority, byStaff, total: tasks.length }
}

// ── Detail columns ────────────────────────────────────────────────────────────
const DETAIL_COLUMNS = [
  { key: 'patientName', header: 'Patient Name' },
  { key: 'patientDob', header: 'Date of Birth' },
  { key: 'ecwAccountNumber', header: 'ECW Account #' },
  { key: 'taskType', header: 'Task Type' },
  { key: 'status', header: 'Status' },
  { key: 'priority', header: 'Priority' },
  { key: 'assignedName', header: 'Assigned To' },
  { key: 'dueDate', header: 'Due Date' },
  { key: 'createdAt', header: 'Created At' },
  { key: 'updatedAt', header: 'Updated At' },
  { key: 'daysInQueue', header: 'Days in Queue' },
  { key: 'notes', header: 'Notes' },
  { key: 'activityLog', header: 'Activity Log' },
]

// ── Generate Excel ────────────────────────────────────────────────────────────
async function generateExcel(tasks: TaskRow[], title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'MedTask'
  wb.created = new Date()

  const summary = buildSummary(tasks)

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  const ws1 = wb.addWorksheet('Summary')
  ws1.properties.defaultRowHeight = 18

  const titleRow = ws1.addRow([title])
  titleRow.font = { bold: true, size: 14, color: { argb: 'FF111827' } }
  ws1.addRow([`Generated: ${new Date().toLocaleString()}`]).font = { size: 10, color: { argb: 'FF6B7280' } }
  ws1.addRow([`Total tasks: ${summary.total}`]).font = { bold: true }
  ws1.addRow([])

  // By task type
  ws1.addRow(['BY TASK TYPE']).font = { bold: true, size: 12, color: { argb: 'FF6366F1' } }
  const typeHeader = ws1.addRow(['Task Type', 'Open', 'In Progress', 'Pending', 'Completed', 'Denied', 'Cancelled', 'Total'])
  typeHeader.font = { bold: true }
  typeHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } }

  for (const [type, statuses] of Object.entries(summary.byType)) {
    const total = Object.values(statuses).reduce((a, b) => a + b, 0)
    ws1.addRow([
      type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      statuses['open'] ?? 0,
      statuses['in-progress'] ?? 0,
      statuses['pending'] ?? 0,
      statuses['completed'] ?? 0,
      statuses['denied'] ?? 0,
      statuses['cancelled'] ?? 0,
      total,
    ])
  }

  ws1.addRow([])
  ws1.addRow(['BY STATUS']).font = { bold: true, size: 12, color: { argb: 'FF6366F1' } }
  const statusHeader = ws1.addRow(['Status', 'Count'])
  statusHeader.font = { bold: true }
  statusHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } }
  for (const [s, count] of Object.entries(summary.byStatus)) {
    ws1.addRow([s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), count])
  }

  ws1.addRow([])
  ws1.addRow(['BY PRIORITY']).font = { bold: true, size: 12, color: { argb: 'FF6366F1' } }
  const priHeader = ws1.addRow(['Priority', 'Count'])
  priHeader.font = { bold: true }
  priHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } }
  for (const [p, count] of Object.entries(summary.byPriority)) {
    ws1.addRow([p.replace(/\b\w/g, c => c.toUpperCase()), count])
  }

  ws1.addRow([])
  ws1.addRow(['BY STAFF']).font = { bold: true, size: 12, color: { argb: 'FF6366F1' } }
  const staffHeader = ws1.addRow(['Staff Member', 'Tasks Assigned'])
  staffHeader.font = { bold: true }
  staffHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2FF' } }
  for (const [staff, count] of Object.entries(summary.byStaff)) {
    ws1.addRow([staff, count])
  }

  ws1.getColumn(1).width = 30
  ws1.getColumn(2).width = 15
  for (let i = 3; i <= 8; i++) ws1.getColumn(i).width = 15

  // ── Sheet 2: Detail ───────────────────────────────────────────────────────
  const ws2 = wb.addWorksheet('Detail')
  ws2.columns = DETAIL_COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.key === 'notes' || c.key === 'activityLog' ? 40 : c.key === 'patientName' ? 22 : 15 }))

  const headerRow = ws2.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6366F1' } }
  headerRow.height = 20

  for (const task of tasks) {
    const row = ws2.addRow(DETAIL_COLUMNS.map(c => task[c.key] ?? ''))
    // Color denied tasks
    if (task.status === 'denied') {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF5F5' } }
    }
    // Color overdue tasks
    const isOverdue = task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10) && !['completed', 'cancelled', 'denied'].includes(task.status)
    if (isOverdue) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } }
    }
    row.alignment = { wrapText: true, vertical: 'top' }
  }

  ws2.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: DETAIL_COLUMNS.length } }

  return Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer)
}

// ── Generate CSV ──────────────────────────────────────────────────────────────
function generateCSV(tasks: TaskRow[]): string {
  const escape = (v: unknown) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = DETAIL_COLUMNS.map(c => escape(c.header)).join(',')
  const rows = tasks.map(t => DETAIL_COLUMNS.map(c => escape(t[c.key] ?? '')).join(','))
  return [header, ...rows].join('\n')
}

// ── Generate plain text (Word-compatible) ─────────────────────────────────────
function generateText(tasks: TaskRow[], title: string): string {
  const summary = buildSummary(tasks)
  const lines: string[] = []
  const hr = '─'.repeat(60)

  lines.push(title)
  lines.push(`Generated: ${new Date().toLocaleString()}`)
  lines.push(`Total tasks: ${summary.total}`)
  lines.push('')
  lines.push(hr)
  lines.push('SUMMARY BY TASK TYPE')
  lines.push(hr)

  for (const [type, statuses] of Object.entries(summary.byType)) {
    const total = Object.values(statuses).reduce((a, b) => a + b, 0)
    lines.push(`${type.replace(/-/g, ' ').toUpperCase()}: ${total} total`)
    for (const [s, count] of Object.entries(statuses)) {
      lines.push(`  ${s}: ${count}`)
    }
  }

  lines.push('')
  lines.push(hr)
  lines.push('TASK DETAIL')
  lines.push(hr)

  for (const task of tasks) {
    lines.push('')
    lines.push(`Patient: ${task.patientName} | DOB: ${task.patientDob} | ECW: ${task.ecwAccountNumber}`)
    lines.push(`Type: ${task.taskType} | Status: ${task.status} | Priority: ${task.priority}`)
    lines.push(`Assigned: ${task.assignedName || 'Unassigned'} | Due: ${task.dueDate || '—'} | Days in queue: ${task.daysInQueue}`)
    lines.push(`Created: ${task.createdAt} | Updated: ${task.updatedAt}`)
    if (task.notes) lines.push(`Notes: ${task.notes}`)
    if (task.activityLog) lines.push(`Activity: ${task.activityLog}`)
    lines.push('  ' + '─'.repeat(40))
  }

  return lines.join('\n')
}

// ── Generate PDF ──────────────────────────────────────────────────────────────
function generatePDF(tasks: TaskRow[], title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'LETTER' })
    const chunks: Buffer[] = []
    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const summary = buildSummary(tasks)
    const colors = { primary: '#6366F1', danger: '#DC2626', gray: '#6B7280', dark: '#111827', light: '#F3F4F6' }

    // Header
    doc.rect(0, 0, doc.page.width, 60).fill(colors.primary)
    doc.fillColor('white').fontSize(18).font('Helvetica-Bold').text(title, 40, 18)
    doc.fontSize(9).font('Helvetica').text(`Generated: ${new Date().toLocaleString()} | Total tasks: ${summary.total}`, 40, 42)
    doc.fillColor(colors.dark)
    doc.y = 80

    // Summary section
    doc.fontSize(13).font('Helvetica-Bold').fillColor(colors.primary).text('SUMMARY', 40)
    doc.moveDown(0.3)

    // By type table
    doc.fontSize(10).font('Helvetica-Bold').fillColor(colors.dark).text('By Task Type')
    doc.moveDown(0.2)

    const tableX = 40
    const colWidths = [160, 60, 70, 60, 70, 60, 70, 55]
    const headers = ['Task Type', 'Open', 'In Progress', 'Pending', 'Completed', 'Denied', 'Cancelled', 'Total']

    // Header row
    doc.rect(tableX, doc.y, colWidths.reduce((a, b) => a + b), 18).fill('#EEF2FF')
    let x = tableX
    headers.forEach((h, i) => {
      doc.fillColor(colors.primary).fontSize(8).font('Helvetica-Bold').text(h, x + 3, doc.y + 5, { width: colWidths[i] - 6, lineBreak: false })
      x += colWidths[i]
    })
    doc.y += 20

    for (const [type, statuses] of Object.entries(summary.byType)) {
      const total = Object.values(statuses).reduce((a, b) => a + b, 0)
      const vals = [
        type.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        statuses['open'] ?? 0,
        statuses['in-progress'] ?? 0,
        statuses['pending'] ?? 0,
        statuses['completed'] ?? 0,
        statuses['denied'] ?? 0,
        statuses['cancelled'] ?? 0,
        total,
      ]
      x = tableX
      const rowY = doc.y
      vals.forEach((v, i) => {
        doc.fillColor(colors.dark).fontSize(8).font('Helvetica').text(String(v), x + 3, rowY + 3, { width: colWidths[i] - 6, lineBreak: false })
        x += colWidths[i]
      })
      doc.rect(tableX, rowY, colWidths.reduce((a, b) => a + b), 16).stroke('#E5E7EB')
      doc.y = rowY + 17
    }

    doc.moveDown(1)

    // Detail section
    if (doc.y > doc.page.height - 150) doc.addPage()
    doc.fontSize(13).font('Helvetica-Bold').fillColor(colors.primary).text('TASK DETAIL')
    doc.moveDown(0.3)

    for (const task of tasks) {
      const blockHeight = 90
      if (doc.y > doc.page.height - blockHeight - 40) doc.addPage()

      const startY = doc.y
      const isOverdue = task.dueDate && task.dueDate < new Date().toISOString().slice(0, 10) && !['completed', 'cancelled', 'denied'].includes(task.status)
      const bgColor = task.status === 'denied' ? '#FFF5F5' : isOverdue ? '#FFFBEB' : '#F9FAFB'

      doc.rect(40, startY, doc.page.width - 80, blockHeight).fill(bgColor).stroke('#E5E7EB')

      doc.fillColor(colors.dark).fontSize(9).font('Helvetica-Bold')
        .text(`${task.patientName}`, 48, startY + 6, { continued: true })
        .font('Helvetica').fillColor(colors.gray)
        .text(`  DOB: ${task.patientDob}  |  ECW: ${task.ecwAccountNumber}`)

      doc.fillColor(colors.dark).fontSize(8).font('Helvetica')
        .text(`Type: ${task.taskType}  |  Status: ${task.status}  |  Priority: ${task.priority}  |  Assigned: ${task.assignedName || 'Unassigned'}`, 48, startY + 20)

      doc.text(`Due: ${task.dueDate || '—'}  |  Days in queue: ${task.daysInQueue}  |  Created: ${task.createdAt?.slice(0, 10)}`, 48, startY + 33)

      if (task.notes) {
        doc.fillColor(colors.gray).text(`Notes: ${task.notes.slice(0, 120)}${task.notes.length > 120 ? '…' : ''}`, 48, startY + 46, { width: doc.page.width - 96 })
      }

      if (task.activityLog) {
        doc.fillColor(colors.gray).text(`Activity: ${task.activityLog.slice(0, 100)}${task.activityLog.length > 100 ? '…' : ''}`, 48, startY + 59, { width: doc.page.width - 96 })
      }

      doc.y = startY + blockHeight + 6
    }

    doc.end()
  })
}

// ── API Handler ───────────────────────────────────────────────────────────────
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const method = event.requestContext.http.method
  const path = event.rawPath

  if (method === 'POST' && path === '/reports/generate') {
    try {
      const body = JSON.parse(event.body ?? '{}')
      const { format = 'excel', filters = {}, title = 'MedTask Report' } = body

      const tasks = await fetchAllTasks(filters)

      if (format === 'csv') {
        const csv = generateCSV(tasks)
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="medtask-report-${new Date().toISOString().slice(0, 10)}.csv"`,
            'Access-Control-Allow-Origin': '*',
          },
          body: Buffer.from(csv).toString('base64'),
          isBase64Encoded: true,
        }
      }

      if (format === 'text') {
        const text = generateText(tasks, title)
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Content-Disposition': `attachment; filename="medtask-report-${new Date().toISOString().slice(0, 10)}.txt"`,
            'Access-Control-Allow-Origin': '*',
          },
          body: Buffer.from(text).toString('base64'),
          isBase64Encoded: true,
        }
      }

      if (format === 'pdf') {
        const pdf = await generatePDF(tasks, title)
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="medtask-report-${new Date().toISOString().slice(0, 10)}.pdf"`,
            'Access-Control-Allow-Origin': '*',
          },
          body: pdf.toString('base64'),
          isBase64Encoded: true,
        }
      }

      // Default: Excel
      const excel = await generateExcel(tasks, title)
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="medtask-report-${new Date().toISOString().slice(0, 10)}.xlsx"`,
          'Access-Control-Allow-Origin': '*',
        },
        body: excel.toString('base64'),
        isBase64Encoded: true,
      }
    } catch (err) {
      console.error('Report generation error:', err)
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Report generation failed', detail: (err as Error).message }),
      }
    }
  }

  return {
    statusCode: 404,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ error: 'Not found' }),
  }
}

// ── Scheduled Handler ─────────────────────────────────────────────────────────
export const scheduledHandler: ScheduledHandler = async () => {
  try {
    const title = `MedTask Daily Report — ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`

    // Fetch all tasks (no filter for daily report)
    const tasks = await fetchAllTasks({})

    // Generate both formats
    const [excel, pdf] = await Promise.all([
      generateExcel(tasks, title),
      generatePDF(tasks, title),
    ])

    // Get all notification subscribers
    const prefsResult = await ddb.send(new ScanCommand({ TableName: PREFS_TABLE }))
    const recipients = (prefsResult.Items ?? []).filter((p: any) =>
      p.emailEnabled && p.email && p.alertTypes?.includes('task_overdue')
    )

    if (recipients.length === 0) {
      console.log('No recipients configured for daily report')
      return
    }

    const summary = buildSummary(tasks)
    const overdueCount = tasks.filter(t =>
      t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10) &&
      !['completed', 'cancelled', 'denied'].includes(t.status)
    ).length

    const emailBody = [
      title,
      '',
      `Total tasks: ${summary.total}`,
      `Open: ${summary.byStatus['open'] ?? 0}`,
      `In Progress: ${summary.byStatus['in-progress'] ?? 0}`,
      `Pending: ${summary.byStatus['pending'] ?? 0}`,
      `Completed: ${summary.byStatus['completed'] ?? 0}`,
      `Denied: ${summary.byStatus['denied'] ?? 0}`,
      `Overdue: ${overdueCount}`,
      '',
      'Full report attached as Excel and PDF.',
    ].join('\n')

    for (const pref of recipients) {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: FROM_EMAIL,
        Destination: { ToAddresses: [pref.email] },
        Content: {
          Simple: {
            Subject: { Data: title },
            Body: { Text: { Data: emailBody } },
          },
        },
      })).catch(e => console.error('SES error for', pref.email, e))
    }

    console.log(`Daily report sent to ${recipients.length} recipient(s)`)
  } catch (err) {
    console.error('Scheduled report error:', err)
  }
}
