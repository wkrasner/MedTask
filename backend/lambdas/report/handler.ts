import { APIGatewayProxyHandlerV2, ScheduledHandler } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const ses = new SESv2Client({})

const TASKS_TABLE = process.env.TASKS_TABLE!
const PREFS_TABLE = process.env.PREFS_TABLE!
const FROM_EMAIL = process.env.FROM_EMAIL!

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
      daysInQueue: t.createdAt ? Math.floor((today.getTime() - new Date(t.createdAt).getTime()) / 86400000) : 0,
      activityLog: Array.isArray(t.activityLog)
        ? (t.activityLog as any[]).map((e: any) => `[${new Date(e.timestamp).toLocaleDateString()} ${e.staffName}]: ${e.text}`).join(' | ')
        : '',
    }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

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

const COLUMNS = [
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

// ── Pure JS CSV ───────────────────────────────────────────────────────────────
function generateCSV(tasks: TaskRow[]): string {
  const escape = (v: unknown) => {
    const s = String(v ?? '')
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = COLUMNS.map(c => escape(c.header)).join(',')
  const rows = tasks.map(t => COLUMNS.map(c => escape(t[c.key] ?? '')).join(','))
  return [header, ...rows].join('\n')
}

// ── Pure JS plain text ────────────────────────────────────────────────────────
function generateText(tasks: TaskRow[], title: string): string {
  const summary = buildSummary(tasks)
  const hr = '─'.repeat(60)
  const lines: string[] = [title, `Generated: ${new Date().toLocaleString()}`, `Total tasks: ${summary.total}`, '', hr, 'SUMMARY BY TASK TYPE', hr]
  for (const [type, statuses] of Object.entries(summary.byType)) {
    const total = Object.values(statuses).reduce((a, b) => a + b, 0)
    lines.push(`${type.replace(/-/g, ' ').toUpperCase()}: ${total} total`)
    for (const [s, count] of Object.entries(statuses)) lines.push(`  ${s}: ${count}`)
  }
  lines.push('', hr, 'TASK DETAIL', hr)
  for (const task of tasks) {
    lines.push('', `Patient: ${task.patientName} | DOB: ${task.patientDob} | ECW: ${task.ecwAccountNumber}`)
    lines.push(`Type: ${task.taskType} | Status: ${task.status} | Priority: ${task.priority}`)
    lines.push(`Assigned: ${task.assignedName || 'Unassigned'} | Due: ${task.dueDate || '—'} | Days in queue: ${task.daysInQueue}`)
    lines.push(`Created: ${task.createdAt} | Updated: ${task.updatedAt}`)
    if (task.notes) lines.push(`Notes: ${task.notes}`)
    if (task.activityLog) lines.push(`Activity: ${task.activityLog}`)
    lines.push('  ' + '─'.repeat(40))
  }
  return lines.join('\n')
}

// ── Pure JS XLSX (OpenXML format) ─────────────────────────────────────────────
function generateXLSX(tasks: TaskRow[], title: string): Buffer {
  const summary = buildSummary(tasks)

  const xmlEscape = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // Shared strings
  const strings: string[] = []
  const si = (s: string) => { const i = strings.indexOf(s); if (i >= 0) return i; strings.push(s); return strings.length - 1 }

  // Build summary sheet rows
  const summaryRows: Array<Array<string | number>> = [
    [title], [`Generated: ${new Date().toLocaleString()}`], [`Total tasks: ${summary.total}`], [],
    ['BY TASK TYPE'], ['Task Type', 'Open', 'In Progress', 'Pending', 'Completed', 'Denied', 'Cancelled', 'Total'],
  ]
  for (const [type, statuses] of Object.entries(summary.byType)) {
    const total = Object.values(statuses).reduce((a, b) => a + b, 0)
    summaryRows.push([type, statuses['open'] ?? 0, statuses['in-progress'] ?? 0, statuses['pending'] ?? 0, statuses['completed'] ?? 0, statuses['denied'] ?? 0, statuses['cancelled'] ?? 0, total])
  }
  summaryRows.push([], ['BY STATUS'], ['Status', 'Count'])
  for (const [s, count] of Object.entries(summary.byStatus)) summaryRows.push([s, count])
  summaryRows.push([], ['BY PRIORITY'], ['Priority', 'Count'])
  for (const [p, count] of Object.entries(summary.byPriority)) summaryRows.push([p, count])
  summaryRows.push([], ['BY STAFF'], ['Staff Member', 'Tasks Assigned'])
  for (const [staff, count] of Object.entries(summary.byStaff)) summaryRows.push([staff, count])

  // Build detail sheet rows
  const detailRows: Array<Array<string | number>> = [COLUMNS.map(c => c.header)]
  for (const task of tasks) detailRows.push(COLUMNS.map(c => task[c.key] ?? ''))

  // Generate worksheet XML
  const makeSheet = (rows: Array<Array<string | number>>) => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    rows.forEach((row, ri) => {
      xml += `<row r="${ri + 1}">`
      row.forEach((cell, ci) => {
        const col = String.fromCharCode(65 + ci)
        const ref = `${col}${ri + 1}`
        if (typeof cell === 'number') {
          xml += `<c r="${ref}"><v>${cell}</v></c>`
        } else {
          const idx = si(String(cell))
          xml += `<c r="${ref}" t="s"><v>${idx}</v></c>`
        }
      })
      xml += '</row>'
    })
    xml += '</sheetData></worksheet>'
    return xml
  }

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map(s => `<si><t>${xmlEscape(s)}</t></si>`).join('')}</sst>`

  const sheet1 = makeSheet(summaryRows)
  const sheet2 = makeSheet(detailRows)

  const workbookXml = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/><sheet name="Detail" sheetId="2" r:id="rId2"/></sheets></workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

  // Build ZIP manually using Node.js built-ins
  const files: Record<string, string> = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'xl/workbook.xml': workbookXml,
    'xl/_rels/workbook.xml.rels': workbookRels,
    'xl/worksheets/sheet1.xml': sheet1,
    'xl/worksheets/sheet2.xml': sheet2,
    'xl/sharedStrings.xml': sharedStringsXml,
  }

  // Simple ZIP implementation using Node's zlib
  const { deflateRawSync } = require('zlib')

  const crc32 = (buf: Buffer): number => {
    const table = (() => {
      const t = new Uint32Array(256)
      for (let i = 0; i < 256; i++) {
        let c = i
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
        t[i] = c
      }
      return t
    })()
    let crc = 0xFFFFFFFF
    for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8)
    return (crc ^ 0xFFFFFFFF) >>> 0
  }

  const writeUint16LE = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
  const writeUint32LE = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }

  const localHeaders: Buffer[] = []
  const centralDirs: Buffer[] = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name)
    const dataBuf = Buffer.from(content, 'utf8')
    const compressed = deflateRawSync(dataBuf, { level: 6 })
    const crc = crc32(dataBuf)
    const now = new Date()
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

    const local = Buffer.concat([
      Buffer.from([0x50, 0x4B, 0x03, 0x04]),
      writeUint16LE(20), writeUint16LE(0),
      writeUint16LE(8),
      writeUint16LE(dosTime), writeUint16LE(dosDate),
      writeUint32LE(crc),
      writeUint32LE(compressed.length),
      writeUint32LE(dataBuf.length),
      writeUint16LE(nameBuf.length),
      writeUint16LE(0),
      nameBuf,
      compressed,
    ])

    const central = Buffer.concat([
      Buffer.from([0x50, 0x4B, 0x01, 0x02]),
      writeUint16LE(20), writeUint16LE(20),
      writeUint16LE(0), writeUint16LE(8),
      writeUint16LE(dosTime), writeUint16LE(dosDate),
      writeUint32LE(crc),
      writeUint32LE(compressed.length),
      writeUint32LE(dataBuf.length),
      writeUint16LE(nameBuf.length),
      writeUint16LE(0), writeUint16LE(0),
      writeUint16LE(0), writeUint16LE(0),
      writeUint32LE(0),
      writeUint32LE(offset),
      nameBuf,
    ])

    localHeaders.push(local)
    centralDirs.push(central)
    offset += local.length
  }

  const centralDir = Buffer.concat(centralDirs)
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4B, 0x05, 0x06]),
    writeUint16LE(0), writeUint16LE(0),
    writeUint16LE(centralDirs.length),
    writeUint16LE(centralDirs.length),
    writeUint32LE(centralDir.length),
    writeUint32LE(offset),
    writeUint16LE(0),
  ])

  return Buffer.concat([...localHeaders, centralDir, eocd])
}

// ── API Handler ───────────────────────────────────────────────────────────────
export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: '' }
  }

  if (event.requestContext.http.method !== 'POST') {
    return { statusCode: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Not found' }) }
  }

  try {
    const body = JSON.parse(event.body ?? '{}')
    const { format = 'excel', filters = {}, title = 'MedTask Report' } = body
    const tasks = await fetchAllTasks(filters)
    const date = new Date().toISOString().slice(0, 10)
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' }

    if (format === 'csv') {
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="medtask-report-${date}.csv"` }, body: Buffer.from(generateCSV(tasks)).toString('base64'), isBase64Encoded: true }
    }
    if (format === 'text') {
      return { statusCode: 200, headers: { ...cors, 'Content-Type': 'text/plain', 'Content-Disposition': `attachment; filename="medtask-report-${date}.txt"` }, body: Buffer.from(generateText(tasks, title)).toString('base64'), isBase64Encoded: true }
    }
    // Default: Excel
    const xlsx = generateXLSX(tasks, title)
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="medtask-report-${date}.xlsx"` }, body: xlsx.toString('base64'), isBase64Encoded: true }
  } catch (err) {
    console.error('Report error:', err)
    return { statusCode: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Report generation failed', detail: (err as Error).message }) }
  }
}

// ── Scheduled Handler ─────────────────────────────────────────────────────────
export const scheduledHandler: ScheduledHandler = async () => {
  try {
    const title = `MedTask Daily Report — ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`
    const tasks = await fetchAllTasks({})
    const summary = buildSummary(tasks)
    const overdueCount = tasks.filter(t => t.dueDate && t.dueDate < new Date().toISOString().slice(0, 10) && !['completed', 'cancelled', 'denied'].includes(t.status)).length

    const prefsResult = await ddb.send(new ScanCommand({ TableName: PREFS_TABLE }))
    const recipients = (prefsResult.Items ?? []).filter((p: any) => p.emailEnabled && p.email && p.alertTypes?.includes('task_overdue'))

    if (!recipients.length) { console.log('No recipients'); return }

    const emailBody = [title, '', `Total: ${summary.total}`, `Open: ${summary.byStatus['open'] ?? 0}`, `Overdue: ${overdueCount}`, '', 'Log into MedTask for the full report.'].join('\n')

    for (const pref of recipients) {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: FROM_EMAIL,
        Destination: { ToAddresses: [pref.email] },
        Content: { Simple: { Subject: { Data: title }, Body: { Text: { Data: emailBody } } } },
      })).catch(e => console.error('SES error', pref.email, e))
    }
    console.log(`Daily report sent to ${recipients.length} recipients`)
  } catch (err) {
    console.error('Scheduled report error:', err)
  }
}
