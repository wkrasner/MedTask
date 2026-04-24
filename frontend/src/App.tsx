import { useState, useMemo } from 'react'
import { useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'

// ── Core types ────────────────────────────────────────────────────────────────
type BuiltInTaskType = 'prior-auth' | 'prescription' | 'return-call' | 'scheduling' | 'records-request' | 'referral'
type TaskStatus = 'open' | 'in-progress' | 'pending' | 'completed' | 'denied' | 'cancelled'
type Priority = 'urgent' | 'high' | 'normal' | 'low'

// Custom task type definition
interface CustomTaskTypeDef {
  key: string         // e.g. "lab-order"
  label: string       // e.g. "Lab Order"
  icon: string        // emoji e.g. "🧪"
  color: string       // hex e.g. "#0F6E56"
  bg: string          // hex e.g. "#E1F5EE"
  fields: CustomField[]
}
interface CustomField {
  key: string
  label: string
  type: 'text' | 'date' | 'select' | 'textarea'
  options?: string[]   // for select type
  placeholder?: string
}

interface BaseTask {
  taskId: string
  taskType: string      // BuiltInTaskType or custom key
  status: TaskStatus
  priority: Priority
  patientName: string
  patientDob: string
  ecwAccountNumber: string
  assignedTo?: string
  assignedName?: string
  notes: string
  dueDate?: string | null
  updatedAt: string
  customFields?: Record<string, string>   // stores custom field values
  [key: string]: unknown
}

const STAFF = [
  { id: 's1', name: 'Maria Chen' },
  { id: 's2', name: 'James Okafor' },
  { id: 's3', name: 'Priya Nair' },
  { id: 's4', name: 'Tom Russo' },
]

// ── Built-in task type metadata ───────────────────────────────────────────────
const BUILTIN_TYPE_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  'prior-auth':      { label: 'Prior Auth',      color: '#7C3AED', bg: '#EDE9FE', icon: '🔐' },
  'prescription':    { label: 'Prescription',    color: '#0369A1', bg: '#E0F2FE', icon: '💊' },
  'return-call':     { label: 'Return Call',     color: '#B45309', bg: '#FEF3C7', icon: '📞' },
  'scheduling':      { label: 'Scheduling',      color: '#065F46', bg: '#D1FAE5', icon: '📅' },
  'records-request': { label: 'Records Request', color: '#9D174D', bg: '#FCE7F3', icon: '📋' },
  'referral':        { label: 'Referral',        color: '#1E40AF', bg: '#DBEAFE', icon: '🏥' },
}

// Built-in type-specific fields
const BUILTIN_FIELDS: Record<string, Array<{ key: string; label: string; type: string; options?: string[]; placeholder?: string }>> = {
  'prior-auth': [
    { key: 'insuranceName', label: 'Insurance name', type: 'text' },
    { key: 'medicationOrProcedure', label: 'Medication or procedure', type: 'text' },
    { key: 'authNumber', label: 'Auth number (if known)', type: 'text' },
    { key: 'appealDeadline', label: 'Appeal deadline', type: 'date' },
    { key: 'denialReason', label: 'Denial reason (if denied)', type: 'text' },
  ],
  'prescription': [
    { key: 'medicationName', label: 'Medication name', type: 'text' },
    { key: 'dosage', label: 'Dosage', type: 'text' },
    { key: 'pharmacy', label: 'Pharmacy', type: 'text' },
    { key: 'sentToPharmacy', label: 'Sent to pharmacy', type: 'select', options: ['No', 'Yes'] },
  ],
  'return-call': [
    { key: 'callbackNumber', label: 'Callback number', type: 'text' },
    { key: 'reasonForCall', label: 'Reason for call', type: 'text' },
  ],
  'scheduling': [
    { key: 'appointmentType', label: 'Appointment type', type: 'text' },
    { key: 'requestedProvider', label: 'Requested provider', type: 'text' },
    { key: 'requestedDateRange', label: 'Requested date range', type: 'text', placeholder: 'e.g. Within 2 weeks' },
    { key: 'confirmationNumber', label: 'Confirmation #', type: 'text' },
  ],
  'records-request': [
    { key: 'requestingProviderName', label: 'Requesting provider', type: 'text' },
    { key: 'requestingProviderFax', label: 'Fax number', type: 'text' },
    { key: 'recordTypes', label: 'Record types needed', type: 'text', placeholder: 'e.g. Office notes, labs, imaging' },
    { key: 'recordsDateRange', label: 'Date range', type: 'text', placeholder: 'e.g. 2023-01-01 to present' },
    { key: 'authorizationOnFile', label: 'Authorization on file', type: 'select', options: ['Yes', 'No'] },
  ],
  'referral': [
    { key: 'referredToProvider', label: 'Referred to provider', type: 'text' },
    { key: 'referredToSpecialty', label: 'Specialty', type: 'text' },
    { key: 'referralReason', label: 'Referral reason', type: 'text' },
    { key: 'urgency', label: 'Urgency', type: 'select', options: ['Routine', 'Urgent', 'Stat'] },
    { key: 'insuranceAuthRequired', label: 'Insurance auth required', type: 'select', options: ['Yes', 'No'] },
    { key: 'referredToFax', label: 'Provider fax', type: 'text' },
  ],
}

const MOCK_TASKS: BaseTask[] = [
  { taskId: 't1', taskType: 'prior-auth', status: 'open', priority: 'urgent', patientName: 'Eleanor Voss', patientDob: '1958-03-12', ecwAccountNumber: 'ECW-10021', assignedTo: 's1', assignedName: 'Maria Chen', notes: 'Humira 40mg. Insurance requires step therapy documentation.', dueDate: '2026-04-24', updatedAt: '2026-04-22T08:14:00Z', insuranceName: 'Aetna', medicationOrProcedure: 'Humira 40mg', authNumber: null },
  { taskId: 't2', taskType: 'prior-auth', status: 'pending', priority: 'high', patientName: 'Robert Tran', patientDob: '1971-07-29', ecwAccountNumber: 'ECW-10034', assignedTo: 's1', assignedName: 'Maria Chen', notes: 'MRI lumbar spine. Sent initial request 4/19.', dueDate: '2026-04-28', updatedAt: '2026-04-21T14:30:00Z', insuranceName: 'BCBS', medicationOrProcedure: 'MRI Lumbar Spine', authNumber: 'BCBS-4421' },
  { taskId: 't3', taskType: 'prior-auth', status: 'denied', priority: 'high', patientName: 'Carl Benning', patientDob: '1965-09-14', ecwAccountNumber: 'ECW-10051', assignedTo: 's1', assignedName: 'Maria Chen', notes: 'Denied — not medically necessary per Cigna. Filing appeal.', dueDate: '2026-04-30', updatedAt: '2026-04-21T10:00:00Z', insuranceName: 'Cigna', medicationOrProcedure: 'Ozempic 1mg', authNumber: null, denialReason: 'Not medically necessary', appealDeadline: '2026-05-15' },
  { taskId: 't4', taskType: 'prescription', status: 'open', priority: 'high', patientName: 'David Marsh', patientDob: '1945-06-18', ecwAccountNumber: 'ECW-10062', assignedTo: 's3', assignedName: 'Priya Nair', notes: 'Patient called pharmacy — script not received. Resend.', dueDate: '2026-04-22', updatedAt: '2026-04-22T09:45:00Z', medicationName: 'Metformin 1000mg', dosage: '1000mg BID', pharmacy: 'CVS Farmingdale', sentToPharmacy: false },
  { taskId: 't5', taskType: 'prescription', status: 'open', priority: 'normal', patientName: 'Anne Kowalski', patientDob: '1990-02-27', ecwAccountNumber: 'ECW-10078', assignedTo: 's3', assignedName: 'Priya Nair', notes: 'Refill request. Last filled 3/22. Confirm compliance before sending.', dueDate: '2026-04-25', updatedAt: '2026-04-21T16:00:00Z', medicationName: 'Lexapro 10mg', dosage: '10mg QD', pharmacy: 'Walgreens Bethpage', sentToPharmacy: false },
  { taskId: 't6', taskType: 'prescription', status: 'in-progress', priority: 'urgent', patientName: 'Frank Deluca', patientDob: '1967-09-15', ecwAccountNumber: 'ECW-10083', assignedTo: 's2', assignedName: 'James Okafor', notes: 'Dr. Smith needs to review labs before signing. Creatinine elevated.', dueDate: '2026-04-22', updatedAt: '2026-04-22T10:30:00Z', medicationName: 'Lisinopril 20mg', dosage: '20mg QD', pharmacy: 'Rite Aid Lindenhurst', sentToPharmacy: false },
  { taskId: 't7', taskType: 'return-call', status: 'open', priority: 'urgent', patientName: 'Gloria Mendes', patientDob: '1953-04-01', ecwAccountNumber: 'ECW-10091', assignedTo: 's4', assignedName: 'Tom Russo', notes: 'Chest tightness since starting new BP med. Called 8am.', callbackNumber: '631-555-0192', reasonForCall: 'Side effect concern', callbackAttempts: 0, dueDate: '2026-04-22', updatedAt: '2026-04-22T08:02:00Z' },
  { taskId: 't8', taskType: 'return-call', status: 'in-progress', priority: 'normal', patientName: 'Harold Beck', patientDob: '1978-12-22', ecwAccountNumber: 'ECW-10104', assignedTo: 's4', assignedName: 'Tom Russo', notes: 'Left VM at noon. Calling back after 3pm.', callbackNumber: '631-555-0341', reasonForCall: 'Lab results question', callbackAttempts: 1, dueDate: undefined, updatedAt: '2026-04-22T12:05:00Z' },
  { taskId: 't9', taskType: 'return-call', status: 'completed', priority: 'low', patientName: 'Irene Walsh', patientDob: '1961-08-30', ecwAccountNumber: 'ECW-10112', assignedTo: 's1', assignedName: 'Maria Chen', notes: 'Spoke with patient. Referral explained. No further action.', callbackNumber: '631-555-0088', reasonForCall: 'Referral question', callbackAttempts: 2, dueDate: undefined, updatedAt: '2026-04-21T15:45:00Z' },
  { taskId: 't10', taskType: 'scheduling', status: 'open', priority: 'high', patientName: 'Yusuf Ali', patientDob: '1935-01-09', ecwAccountNumber: 'ECW-10125', assignedTo: 's2', assignedName: 'James Okafor', notes: 'Cardiology referral. 91 y/o — needs morning slot. Transport Tues/Thurs only.', appointmentType: 'Cardiology consult', requestedProvider: 'Dr. Patel, Cardiology', requestedDateRange: 'Within 2 weeks', dueDate: '2026-05-06', updatedAt: '2026-04-22T07:30:00Z' },
  { taskId: 't11', taskType: 'scheduling', status: 'pending', priority: 'normal', patientName: 'Bethany Cole', patientDob: '1988-05-16', ecwAccountNumber: 'ECW-10138', assignedTo: 's3', assignedName: 'Priya Nair', notes: 'Annual physical. Requested late afternoon. Waiting on callback from scheduler.', appointmentType: 'Annual physical', requestedProvider: 'Dr. Kim', requestedDateRange: 'May 2026', dueDate: '2026-05-30', updatedAt: '2026-04-20T09:00:00Z' },
  { taskId: 't12', taskType: 'scheduling', status: 'completed', priority: 'normal', patientName: 'Marcus Dunn', patientDob: '2001-10-03', ecwAccountNumber: 'ECW-10147', assignedTo: 's4', assignedName: 'Tom Russo', notes: 'Confirmed 5/1 at 10am with Dr. Kim. Reminder sent.', appointmentType: 'Follow-up visit', confirmationNumber: 'APT-2241', dueDate: undefined, updatedAt: '2026-04-19T14:00:00Z' },
  { taskId: 't13', taskType: 'records-request', status: 'open', priority: 'normal', patientName: 'Patricia Odom', patientDob: '1972-04-11', ecwAccountNumber: 'ECW-10159', assignedTo: 's2', assignedName: 'James Okafor', notes: 'New cardiologist at St. Francis needs complete records going back 3 years.', dueDate: '2026-04-29', updatedAt: '2026-04-22T09:00:00Z', requestingProviderName: 'St. Francis Heart Center', requestingProviderFax: '631-555-0900', recordsDateRange: '2023-01-01 to present', recordTypes: 'Office notes, EKGs, labs', authorizationOnFile: true, sentMethod: null },
  { taskId: 't14', taskType: 'records-request', status: 'in-progress', priority: 'high', patientName: 'Leonard Cruz', patientDob: '1950-07-22', ecwAccountNumber: 'ECW-10163', assignedTo: 's2', assignedName: 'James Okafor', notes: 'Workers comp attorney requested records urgently. Auth signed 4/20.', dueDate: '2026-04-24', updatedAt: '2026-04-22T11:15:00Z', requestingProviderName: 'Law Office of Stern & Katz', requestingProviderFax: '212-555-0412', recordsDateRange: '2025-06-01 to 2026-04-01', recordTypes: 'All visit notes, imaging reports', authorizationOnFile: true, sentMethod: 'fax' },
  { taskId: 't15', taskType: 'records-request', status: 'denied', priority: 'normal', patientName: 'Nancy Bloom', patientDob: '1981-12-03', ecwAccountNumber: 'ECW-10177', assignedTo: 's3', assignedName: 'Priya Nair', notes: 'Denied — no valid patient authorization on file. Notified requesting office.', dueDate: undefined, updatedAt: '2026-04-21T14:00:00Z', requestingProviderName: 'Northwell Orthopedics', requestingProviderFax: '516-555-0211', recordsDateRange: '2024-01-01 to present', recordTypes: 'X-ray reports, office notes', authorizationOnFile: false, denialReason: 'No signed patient authorization on file' },
  { taskId: 't16', taskType: 'referral', status: 'open', priority: 'high', patientName: 'Thomas Byrne', patientDob: '1960-02-28', ecwAccountNumber: 'ECW-10184', assignedTo: 's1', assignedName: 'Maria Chen', notes: 'Dr. Kim ordered GI consult for persistent GERD unresponsive to PPI. Insurance requires auth.', dueDate: '2026-04-28', updatedAt: '2026-04-22T08:45:00Z', referredToProvider: 'Dr. Angela Reeves', referredToSpecialty: 'Gastroenterology', referralReason: 'GERD refractory to omeprazole 40mg', urgency: 'routine', insuranceAuthRequired: true, authNumber: null, appointmentScheduled: false },
  { taskId: 't17', taskType: 'referral', status: 'pending', priority: 'urgent', patientName: 'Sandra Holt', patientDob: '1977-08-19', ecwAccountNumber: 'ECW-10196', assignedTo: 's4', assignedName: 'Tom Russo', notes: 'Stat referral to neurology for new-onset seizure. Awaiting insurance approval.', dueDate: '2026-04-23', updatedAt: '2026-04-22T10:00:00Z', referredToProvider: 'Dr. Pham, Neurology', referredToSpecialty: 'Neurology', referralReason: 'New-onset tonic-clonic seizure', urgency: 'stat', insuranceAuthRequired: true, authNumber: null, appointmentScheduled: false },
  { taskId: 't18', taskType: 'referral', status: 'denied', priority: 'high', patientName: 'Kevin Marsh', patientDob: '1985-11-07', ecwAccountNumber: 'ECW-10201', assignedTo: 's1', assignedName: 'Maria Chen', notes: 'Aetna denied referral to out-of-network specialist. Peer-to-peer review requested.', dueDate: '2026-05-01', updatedAt: '2026-04-20T15:00:00Z', referredToProvider: 'Dr. Chen, Oncology', referredToSpecialty: 'Oncology', referralReason: 'Abnormal CT findings suspicious for malignancy', urgency: 'urgent', insuranceAuthRequired: true, authNumber: null, appointmentScheduled: false, denialReason: 'Out-of-network provider, no in-network exception approved' },
]

const STATUS_COLS = [
  { key: 'open',        label: 'Open',        dot: '#EF4444' },
  { key: 'in-progress', label: 'In Progress', dot: '#F59E0B' },
  { key: 'pending',     label: 'Pending',     dot: '#3B82F6' },
  { key: 'completed',   label: 'Completed',   dot: '#10B981' },
  { key: 'denied',      label: 'Denied',      dot: '#DC2626' },
  { key: 'cancelled',   label: 'Cancelled',   dot: '#9CA3AF' },
] as const

const PRIORITY_BADGE = {
  urgent: { bg: '#FEE2E2', color: '#991B1B', label: 'Urgent' },
  high:   { bg: '#FEF3C7', color: '#92400E', label: 'High' },
  normal: { bg: '#F3F4F6', color: '#374151', label: 'Normal' },
  low:    { bg: '#F0FDF4', color: '#166534', label: 'Low' },
} as const

// Color palette options for new task types
const COLOR_PALETTE = [
  { color: '#7C3AED', bg: '#EDE9FE', name: 'Purple' },
  { color: '#0369A1', bg: '#E0F2FE', name: 'Blue' },
  { color: '#B45309', bg: '#FEF3C7', name: 'Amber' },
  { color: '#065F46', bg: '#D1FAE5', name: 'Green' },
  { color: '#9D174D', bg: '#FCE7F3', name: 'Pink' },
  { color: '#1E40AF', bg: '#DBEAFE', name: 'Indigo' },
  { color: '#991B1B', bg: '#FEE2E2', name: 'Red' },
  { color: '#374151', bg: '#F3F4F6', name: 'Gray' },
  { color: '#0F6E56', bg: '#E1F5EE', name: 'Teal' },
  { color: '#92400E', bg: '#FEF3C7', name: 'Orange' },
]

const ICON_OPTIONS = ['🧪', '📊', '💉', '🩺', '🩹', '📝', '📬', '🔔', '📋', '💼', '🏃', '🩻', '💊', '🧬', '📞', '📅', '🏥', '🔐', '⚕️', '🧾']

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function formatDob(dob: string) {
  if (!dob) return '—'
  const [y, m, d] = dob.split('-')
  return `${m}/${d}/${y}`
}
const today = new Date().toISOString().slice(0, 10)
const isOverdue = (d?: string | null) => !!d && d < today
const isDueToday = (d?: string | null) => d === today

const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 13, fontFamily: 'inherit', color: '#111827', background: '#fff', outline: 'none' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 4 }
const fieldStyle: React.CSSProperties = { marginBottom: 12 }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={fieldStyle}><label style={labelStyle}>{label.toUpperCase()}</label>{children}</div>
}

function getTypeMeta(taskType: string, customTypes: CustomTaskTypeDef[]) {
  if (BUILTIN_TYPE_META[taskType]) return BUILTIN_TYPE_META[taskType]
  const c = customTypes.find(t => t.key === taskType)
  if (c) return { label: c.label, color: c.color, bg: c.bg, icon: c.icon }
  return { label: taskType, color: '#374151', bg: '#F3F4F6', icon: '📋' }
}

function getTypeFields(taskType: string, customTypes: CustomTaskTypeDef[]) {
  if (BUILTIN_FIELDS[taskType]) return BUILTIN_FIELDS[taskType]
  const c = customTypes.find(t => t.key === taskType)
  return c?.fields ?? []
}

// ── Manage Task Types Panel ───────────────────────────────────────────────────
function ManageTypesPanel({ customTypes, onClose, onSave }: {
  customTypes: CustomTaskTypeDef[]
  onClose: () => void
  onSave: (types: CustomTaskTypeDef[]) => void
}) {
  const [types, setTypes] = useState<CustomTaskTypeDef[]>(customTypes)
  const [editing, setEditing] = useState<CustomTaskTypeDef | null>(null)
  const [isNew, setIsNew] = useState(false)

  // Form state for editing
  const [formLabel, setFormLabel] = useState('')
  const [formIcon, setFormIcon] = useState('📋')
  const [formColor, setFormColor] = useState(COLOR_PALETTE[0].color)
  const [formBg, setFormBg] = useState(COLOR_PALETTE[0].bg)
  const [formFields, setFormFields] = useState<CustomField[]>([])

  const startNew = () => {
    setIsNew(true)
    setEditing(null)
    setFormLabel('')
    setFormIcon('📋')
    setFormColor(COLOR_PALETTE[0].color)
    setFormBg(COLOR_PALETTE[0].bg)
    setFormFields([])
  }

  const startEdit = (t: CustomTaskTypeDef) => {
    setIsNew(false)
    setEditing(t)
    setFormLabel(t.label)
    setFormIcon(t.icon)
    setFormColor(t.color)
    setFormBg(t.bg)
    setFormFields([...t.fields])
  }

  const saveType = () => {
    if (!formLabel.trim()) return
    const key = formLabel.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const newType: CustomTaskTypeDef = { key: editing ? editing.key : key, label: formLabel.trim(), icon: formIcon, color: formColor, bg: formBg, fields: formFields }
    if (editing) setTypes(prev => prev.map(t => t.key === editing.key ? newType : t))
    else setTypes(prev => [...prev, newType])
    setEditing(null)
    setIsNew(false)
  }

  const deleteType = (key: string) => setTypes(prev => prev.filter(t => t.key !== key))

  const addField = () => setFormFields(prev => [...prev, { key: `field${prev.length}`, label: '', type: 'text' }])
  const updateField = (i: number, updates: Partial<CustomField>) => setFormFields(prev => prev.map((f, idx) => idx === i ? { ...f, ...updates, key: updates.label ? updates.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') : f.key } : f))
  const removeField = (i: number) => setFormFields(prev => prev.filter((_, idx) => idx !== i))

  const panelStyle: React.CSSProperties = { position: 'fixed', top: 0, right: 0, bottom: 0, width: 500, background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', zIndex: 200, display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 199 }} />
      <div style={panelStyle}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F9FAFB' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#111827' }}>Manage Task Types</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Add custom task categories for your practice</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6B7280' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {/* Built-in types (read only) */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.05em', marginBottom: 10 }}>BUILT-IN TYPES (cannot be removed)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(BUILTIN_TYPE_META).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: v.bg, border: `1px solid ${v.color}30` }}>
                  <span style={{ fontSize: 16 }}>{v.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: v.color }}>{v.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: v.color, opacity: 0.7 }}>Built-in</span>
                </div>
              ))}
            </div>
          </div>

          {/* Custom types */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.05em', marginBottom: 10 }}>CUSTOM TYPES</div>
            {types.length === 0 && !isNew && (
              <div style={{ border: '2px dashed #E5E7EB', borderRadius: 8, padding: '20px', textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>
                No custom types yet. Click "+ Add type" to create one.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {types.map(t => (
                <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: t.bg, border: `1px solid ${t.color}30` }}>
                  <span style={{ fontSize: 16 }}>{t.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: t.color }}>{t.label}</div>
                    <div style={{ fontSize: 11, color: t.color, opacity: 0.7 }}>{t.fields.length} custom field{t.fields.length !== 1 ? 's' : ''}</div>
                  </div>
                  <button onClick={() => startEdit(t)} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, border: `1px solid ${t.color}50`, background: 'white', color: t.color, cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button>
                  <button onClick={() => deleteType(t.key)} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, border: '1px solid #FECACA', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
                </div>
              ))}
            </div>
          </div>

          {/* Editor */}
          {(isNew || editing) && (
            <div style={{ background: '#F9FAFB', borderRadius: 10, padding: '16px', marginBottom: 16, border: '1px solid #E5E7EB' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 14 }}>{isNew ? 'New task type' : `Editing: ${editing?.label}`}</div>

              <Field label="Type name">
                <input style={inputStyle} value={formLabel} onChange={e => setFormLabel(e.target.value)} placeholder="e.g. Lab Order" />
              </Field>

              {/* Icon picker */}
              <div style={fieldStyle}>
                <label style={labelStyle}>ICON</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ICON_OPTIONS.map(ico => (
                    <button key={ico} onClick={() => setFormIcon(ico)} style={{ width: 36, height: 36, fontSize: 18, border: `2px solid ${formIcon === ico ? formColor : '#E5E7EB'}`, borderRadius: 8, background: formIcon === ico ? formBg : '#fff', cursor: 'pointer' }}>{ico}</button>
                  ))}
                </div>
              </div>

              {/* Color picker */}
              <div style={fieldStyle}>
                <label style={labelStyle}>COLOR</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {COLOR_PALETTE.map(p => (
                    <button key={p.color} onClick={() => { setFormColor(p.color); setFormBg(p.bg) }}
                      style={{ width: 28, height: 28, borderRadius: '50%', background: p.color, border: `3px solid ${formColor === p.color ? '#111827' : 'transparent'}`, cursor: 'pointer' }}
                      title={p.name} />
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: formBg, marginBottom: 14 }}>
                <span style={{ fontSize: 16 }}>{formIcon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: formColor }}>{formLabel || 'Preview'}</span>
              </div>

              {/* Custom fields */}
              <div style={fieldStyle}>
                <label style={labelStyle}>CUSTOM FIELDS</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {formFields.map((f, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: 6, alignItems: 'center' }}>
                      <input style={inputStyle} value={f.label} onChange={e => updateField(i, { label: e.target.value })} placeholder="Field name" />
                      <select style={inputStyle} value={f.type} onChange={e => updateField(i, { type: e.target.value as CustomField['type'] })}>
                        <option value="text">Text</option>
                        <option value="date">Date</option>
                        <option value="textarea">Long text</option>
                        <option value="select">Dropdown</option>
                      </select>
                      <button onClick={() => removeField(i)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>✕</button>
                    </div>
                  ))}
                  <button onClick={addField} style={{ padding: '7px', borderRadius: 6, border: '1px dashed #E5E7EB', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#6B7280', fontFamily: 'inherit' }}>+ Add field</button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setEditing(null); setIsNew(false) }} style={{ flex: 1, padding: '8px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: '#374151' }}>Cancel</button>
                <button onClick={saveType} disabled={!formLabel.trim()} style={{ flex: 2, padding: '8px', borderRadius: 6, border: 'none', background: formLabel.trim() ? formColor : '#D1D5DB', color: '#fff', cursor: formLabel.trim() ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
                  {isNew ? 'Add type' : 'Save changes'}
                </button>
              </div>
            </div>
          )}

          {!isNew && !editing && (
            <button onClick={startNew} style={{ width: '100%', padding: '10px', borderRadius: 8, border: '2px dashed #6366F1', background: '#EEF2FF', color: '#4338CA', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
              + Add new task type
            </button>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #E5E7EB', display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px', borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: '#374151' }}>Cancel</button>
          <button onClick={() => { onSave(types); onClose() }} style={{ flex: 2, padding: '9px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>Save all types</button>
        </div>
      </div>
    </>
  )
}

// ── Task Panel (New + Edit) ───────────────────────────────────────────────────
function TaskPanel({ task, customTypes, onClose, onSave }: {
  task: BaseTask | null
  customTypes: CustomTaskTypeDef[]
  onClose: () => void
  onSave: (t: BaseTask) => void
}) {
  const allTypes = [...Object.keys(BUILTIN_TYPE_META), ...customTypes.map(t => t.key)]
  const [taskType, setTaskType] = useState(task?.taskType ?? 'prior-auth')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'open')
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'normal')
  const [patientName, setPatientName] = useState(task?.patientName ?? '')
  const [patientDob, setPatientDob] = useState(task?.patientDob ?? '')
  const [ecwAccountNumber, setEcwAccountNumber] = useState(task?.ecwAccountNumber ?? '')
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    if (!task) return {}
    const vals: Record<string, string> = {}
    const fields = getTypeFields(task.taskType, customTypes)
    fields.forEach(f => { if (task[f.key] !== undefined) vals[f.key] = String(task[f.key]) })
    if (task.customFields) Object.assign(vals, task.customFields)
    return vals
  })

  const currentFields = getTypeFields(taskType, customTypes)

  const handleSave = () => {
    if (!patientName.trim() || !patientDob || !ecwAccountNumber.trim()) return
    const assignedStaff = STAFF.find(s => s.id === assignedTo)
    const saved: BaseTask = {
      taskId: task?.taskId ?? `t${Date.now()}`,
      taskType, status, priority,
      patientName: patientName.trim(), patientDob, ecwAccountNumber: ecwAccountNumber.trim(),
      assignedTo: assignedTo || undefined, assignedName: assignedStaff?.name,
      notes: notes.trim(), dueDate: dueDate || undefined,
      updatedAt: new Date().toISOString(),
      customFields: fieldValues,
      ...fieldValues,  // spread so detail view can access
    }
    onSave(saved)
    onClose()
  }

  const panelStyle: React.CSSProperties = { position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', zIndex: 200, display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }
  const meta = getTypeMeta(taskType, customTypes)

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 199 }} />
      <div style={panelStyle}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F9FAFB' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#111827' }}>{task ? 'Edit Task' : 'New Task'}</div>
            {task && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{task.patientName} · {task.ecwAccountNumber}</div>}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6B7280' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* Patient */}
          <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 10 }}>PATIENT INFO</div>
            <Field label="Patient name"><input style={inputStyle} value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="Last, First" /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Date of birth"><input type="date" style={inputStyle} value={patientDob} onChange={e => setPatientDob(e.target.value)} /></Field>
              <Field label="ECW account #"><input style={inputStyle} value={ecwAccountNumber} onChange={e => setEcwAccountNumber(e.target.value)} placeholder="ECW-XXXXX" /></Field>
            </div>
          </div>

          {/* Task info */}
          <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 10 }}>TASK INFO</div>
            <Field label="Task type">
              <select style={inputStyle} value={taskType} onChange={e => { setTaskType(e.target.value); setFieldValues({}) }} disabled={!!task}>
                <optgroup label="Built-in">
                  {Object.entries(BUILTIN_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </optgroup>
                {customTypes.length > 0 && (
                  <optgroup label="Custom">
                    {customTypes.map(t => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}
                  </optgroup>
                )}
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Priority">
                <select style={inputStyle} value={priority} onChange={e => setPriority(e.target.value as Priority)}>
                  <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option>
                </select>
              </Field>
              <Field label="Status">
                <select style={inputStyle} value={status} onChange={e => setStatus(e.target.value as TaskStatus)}>
                  {STATUS_COLS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Assigned to">
                <select style={inputStyle} value={assignedTo} onChange={e => setAssignedTo(e.target.value)}>
                  <option value="">Unassigned</option>
                  {STAFF.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Due date"><input type="date" style={inputStyle} value={dueDate ?? ''} onChange={e => setDueDate(e.target.value)} /></Field>
            </div>
          </div>

          {/* Type-specific fields */}
          {currentFields.length > 0 && (
            <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 10 }}>
                {meta.icon} {meta.label.toUpperCase()} DETAILS
              </div>
              {currentFields.map(f => (
                <Field key={f.key} label={f.label}>
                  {f.type === 'select' ? (
                    <select style={inputStyle} value={fieldValues[f.key] ?? ''} onChange={e => setFieldValues(v => ({ ...v, [f.key]: e.target.value }))}>
                      <option value="">Select…</option>
                      {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={fieldValues[f.key] ?? ''} onChange={e => setFieldValues(v => ({ ...v, [f.key]: e.target.value })) } placeholder={f.placeholder} />
                  ) : (
                    <input type={f.type} style={inputStyle} value={fieldValues[f.key] ?? ''} onChange={e => setFieldValues(v => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} />
                  )}
                </Field>
              ))}
            </div>
          )}

          <Field label="Notes">
            <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any relevant notes…" />
          </Field>
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #E5E7EB', display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px', borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: '#374151' }}>Cancel</button>
          <button onClick={handleSave} disabled={!patientName.trim() || !patientDob || !ecwAccountNumber.trim()}
            style={{ flex: 2, padding: '9px', borderRadius: 7, border: 'none', background: (!patientName.trim() || !patientDob || !ecwAccountNumber.trim()) ? '#A5B4FC' : 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', cursor: (!patientName.trim() || !patientDob || !ecwAccountNumber.trim()) ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
            {task ? 'Save changes' : 'Create task'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Task card ─────────────────────────────────────────────────────────────────
function TaskCard({ task, customTypes, onClick }: { task: BaseTask; customTypes: CustomTaskTypeDef[]; onClick: (t: BaseTask) => void }) {
  const meta = getTypeMeta(task.taskType, customTypes)
  const pri = PRIORITY_BADGE[task.priority]
  const overdue = isOverdue(task.dueDate)
  const dueToday = isDueToday(task.dueDate)
  const denied = task.status === 'denied'
  return (
    <div onClick={() => onClick(task)} style={{ background: denied ? '#FFF5F5' : '#fff', border: `1px solid ${denied ? '#FECACA' : overdue ? '#FCA5A5' : '#E5E7EB'}`, borderLeft: `3px solid ${denied ? '#DC2626' : meta.color}`, borderRadius: 8, padding: '10px 12px', cursor: 'pointer', transition: 'box-shadow 0.15s, transform 0.1s', marginBottom: 7 }}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)' }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; (e.currentTarget as HTMLDivElement).style.transform = 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: '#111827', flex: 1, marginRight: 5 }}>{task.patientName}</span>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: pri.bg, color: pri.color, whiteSpace: 'nowrap' }}>{pri.label}</span>
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 4 }}>DOB: {formatDob(task.patientDob)} · {task.ecwAccountNumber}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, background: meta.bg, color: meta.color, padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>{meta.icon} {meta.label}</span>
        {denied && <span style={{ fontSize: 9, background: '#FEE2E2', color: '#991B1B', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>⛔ Denied</span>}
        {!denied && overdue && <span style={{ fontSize: 9, background: '#FEE2E2', color: '#991B1B', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>⚠ Overdue</span>}
        {!denied && dueToday && <span style={{ fontSize: 9, background: '#FEF3C7', color: '#92400E', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>Today</span>}
      </div>
      <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.4, marginBottom: 5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>{task.notes}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: '#9CA3AF' }}>{task.assignedName ?? 'Unassigned'}</span>
        <span style={{ fontSize: 10, color: '#9CA3AF' }}>{timeAgo(task.updatedAt)}</span>
      </div>
    </div>
  )
}

// ── Task detail modal ─────────────────────────────────────────────────────────
function TaskDetail({ task, customTypes, onClose, onEdit, onStatusChange }: {
  task: BaseTask; customTypes: CustomTaskTypeDef[]; onClose: () => void; onEdit: () => void; onStatusChange: (id: string, s: string) => void
}) {
  const meta = getTypeMeta(task.taskType, customTypes)
  const pri = PRIORITY_BADGE[task.priority]
  const overdue = isOverdue(task.dueDate)
  const fields = getTypeFields(task.taskType, customTypes)

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 530, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ background: meta.bg, padding: '16px 20px', borderBottom: `2px solid ${meta.color}25` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: meta.color, letterSpacing: '0.05em', marginBottom: 3 }}>{meta.icon} {meta.label.toUpperCase()}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#111827' }}>{task.patientName}</div>
              <div style={{ fontSize: 12, color: '#6B7280', marginTop: 3, display: 'flex', gap: 12 }}>
                <span>DOB: {formatDob(task.patientDob)}</span>
                <span style={{ color: '#374151', fontWeight: 600 }}>ECW: {task.ecwAccountNumber}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={onEdit} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid #6366F1', background: '#EEF2FF', color: '#4338CA', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>✏ Edit</button>
              <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#6B7280' }}>×</button>
            </div>
          </div>
        </div>
        <div style={{ padding: '16px 20px', maxHeight: '55vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: pri.bg, color: pri.color }}>{pri.label}</span>
            {task.status === 'denied' && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: '#FEE2E2', color: '#991B1B' }}>⛔ Denied</span>}
            {task.dueDate && <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: overdue ? '#FEE2E2' : '#F3F4F6', color: overdue ? '#991B1B' : '#374151' }}>Due: {task.dueDate}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 14 }}>
            {fields.map(f => {
              const val = task.customFields?.[f.key] ?? String(task[f.key] ?? '—')
              const isWide = f.type === 'textarea' || f.label.toLowerCase().includes('reason') || f.label.toLowerCase().includes('notes')
              const isDenialField = f.label.toLowerCase().includes('denial')
              return (
                <div key={f.key} style={{ gridColumn: isWide ? 'span 2' : 'span 1' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', marginBottom: 2 }}>{f.label.toUpperCase()}</div>
                  <div style={{ fontSize: 13, color: isDenialField ? '#991B1B' : '#111827', fontWeight: isDenialField ? 600 : 500, background: isDenialField ? '#FFF5F5' : 'transparent', padding: isDenialField ? '4px 7px' : 0, borderRadius: 4 }}>{val || '—'}</div>
                </div>
              )
            })}
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', marginBottom: 5 }}>NOTES</div>
            <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, background: '#F9FAFB', borderRadius: 6, padding: '8px 10px' }}>{task.notes}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9CA3AF' }}>
            <span>Assigned: <strong style={{ color: '#374151' }}>{task.assignedName ?? '—'}</strong></span>
            <span>Updated {timeAgo(task.updatedAt)}</span>
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#9CA3AF' }}>Move to:</span>
          {STATUS_COLS.filter(s => s.key !== task.status).map(s => (
            <button key={s.key} onClick={() => { onStatusChange(task.taskId, s.key); onClose() }}
              style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${s.key === 'denied' ? '#FECACA' : '#E5E7EB'}`, background: s.key === 'denied' ? '#FFF5F5' : '#fff', color: s.key === 'denied' ? '#DC2626' : '#374151' }}>
              → {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 18px', borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: '#111827' }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 1 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [tasks, setTasks] = useState<BaseTask[]>(MOCK_TASKS)
  const [customTypes, setCustomTypes] = useState<CustomTaskTypeDef[]>([])
  const [view, setView] = useState<'board' | 'list'>('board')
  const [filterType, setFilterType] = useState('all')
  const [filterStaff, setFilterStaff] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selected, setSelected] = useState<BaseTask | null>(null)
  const [panelTask, setPanelTask] = useState<BaseTask | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [showManageTypes, setShowManageTypes] = useState(false)
  const [search, setSearch] = useState('')

  const allTypeMeta = useMemo(() => {
    const result: Record<string, { label: string; color: string; bg: string; icon: string }> = { ...BUILTIN_TYPE_META }
    customTypes.forEach(t => { result[t.key] = { label: t.label, color: t.color, bg: t.bg, icon: t.icon } })
    return result
  }, [customTypes])

  const filtered = useMemo(() => tasks.filter(t => {
    if (filterType !== 'all' && t.taskType !== filterType) return false
    if (filterStaff !== 'all' && t.assignedTo !== filterStaff) return false
    if (filterStatus !== 'all' && t.status !== filterStatus) return false
    if (search && !t.patientName.toLowerCase().includes(search.toLowerCase()) && !t.notes.toLowerCase().includes(search.toLowerCase()) && !t.ecwAccountNumber.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [tasks, filterType, filterStaff, filterStatus, search])

  const stats = useMemo(() => ({
    open: tasks.filter(t => t.status === 'open').length,
    urgent: tasks.filter(t => t.priority === 'urgent' && !['completed', 'cancelled'].includes(t.status)).length,
    denied: tasks.filter(t => t.status === 'denied').length,
    overdue: tasks.filter(t => isOverdue(t.dueDate) && !['completed', 'cancelled', 'denied'].includes(t.status)).length,
  }), [tasks])

  const handleStatusChange = (taskId: string, newStatus: string) => {
    setTasks(prev => prev.map(t => t.taskId === taskId ? { ...t, status: newStatus as TaskStatus, updatedAt: new Date().toISOString() } : t))
  }
  const handleSave = (savedTask: BaseTask) => {
    setTasks(prev => {
      const exists = prev.find(t => t.taskId === savedTask.taskId)
      return exists ? prev.map(t => t.taskId === savedTask.taskId ? savedTask : t) : [savedTask, ...prev]
    })
  }

  const selBtn = (active: boolean): React.CSSProperties => ({ padding: '5px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: active ? '1px solid #6366F1' : '1px solid #E5E7EB', background: active ? '#EEF2FF' : '#fff', color: active ? '#4338CA' : '#374151', cursor: 'pointer', whiteSpace: 'nowrap' })

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Nav */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 12, height: 52, position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800 }}>✚</div>
          <span style={{ fontWeight: 800, fontSize: 15, color: '#111827', letterSpacing: '-0.02em' }}>OfficeTasks</span>
        </div>
        <div style={{ flex: 1 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, ECW #, or notes…" style={{ padding: '5px 11px', borderRadius: 7, border: '1px solid #E5E7EB', fontSize: 12, width: 240, outline: 'none', fontFamily: 'inherit', background: '#F9FAFB', color: '#111827' }} />
        <button onClick={() => { setPanelTask(null); setShowPanel(true) }} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>+ New Task</button>
        <button onClick={() => setShowManageTypes(true)} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>⚙ Types</button>
        <div style={{ display: 'flex', gap: 1, background: '#F3F4F6', borderRadius: 8, padding: 3 }}>
          {(['board', 'list'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '3px 11px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', background: view === v ? '#fff' : 'transparent', color: view === v ? '#111827' : '#6B7280', boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{v === 'board' ? '⠿ Board' : '☰ List'}</button>
          ))}
        </div>
        <button onClick={onLogout} style={{ fontSize: 12, padding: '5px 11px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', color: '#6B7280' }}>Sign out</button>
      </div>

      <div style={{ padding: '18px 20px', maxWidth: 1600, margin: '0 auto' }}>
        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
          <StatCard label="Open tasks" value={stats.open} sub="Needs action" color="#6366F1" />
          <StatCard label="Urgent" value={stats.urgent} sub="Immediate attention" color="#EF4444" />
          <StatCard label="Denied" value={stats.denied} sub="Requires follow-up" color="#DC2626" />
          <StatCard label="Overdue" value={stats.overdue} sub="Past due date" color="#F59E0B" />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.05em' }}>TYPE</span>
          <button onClick={() => setFilterType('all')} style={selBtn(filterType === 'all')}>All</button>
          {Object.entries(allTypeMeta).map(([k, v]) => (
            <button key={k} onClick={() => setFilterType(k)} style={selBtn(filterType === k)}>{v.icon} {v.label}</button>
          ))}
          <div style={{ width: 1, height: 18, background: '#E5E7EB', margin: '0 2px' }} />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '5px 9px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 12, fontFamily: 'inherit', background: '#fff', color: '#374151', cursor: 'pointer' }}>
            <option value="all">All statuses</option>
            {STATUS_COLS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select value={filterStaff} onChange={e => setFilterStaff(e.target.value)} style={{ padding: '5px 9px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 12, fontFamily: 'inherit', background: '#fff', color: '#374151', cursor: 'pointer' }}>
            <option value="all">All staff</option>
            {STAFF.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9CA3AF' }}>{filtered.length} task{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Board */}
        {view === 'board' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
            {STATUS_COLS.map(col => {
              const ct = filtered.filter(t => t.status === col.key)
              const hasDenied = col.key === 'denied' && ct.length > 0
              return (
                <div key={col.key}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: col.dot }} />
                    <span style={{ fontWeight: 700, fontSize: 11, color: col.key === 'denied' ? '#DC2626' : '#374151' }}>{col.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, background: hasDenied ? '#FEE2E2' : '#F3F4F6', borderRadius: 10, padding: '1px 6px', color: hasDenied ? '#991B1B' : '#9CA3AF' }}>{ct.length}</span>
                  </div>
                  {ct.length === 0
                    ? <div style={{ border: '2px dashed #E5E7EB', borderRadius: 8, padding: '14px 8px', textAlign: 'center', fontSize: 10, color: '#D1D5DB' }}>Empty</div>
                    : ct.map(t => <TaskCard key={t.taskId} task={t} customTypes={customTypes} onClick={setSelected} />)
                  }
                </div>
              )
            })}
          </div>
        )}

        {/* List */}
        {view === 'list' && (
          <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.3fr 1fr 1fr 1fr 1.2fr 65px', padding: '9px 14px', borderBottom: '1px solid #F3F4F6', fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.07em', background: '#F9FAFB' }}>
              {['PATIENT', 'ECW #', 'TYPE', 'STATUS', 'PRIORITY', 'DUE', 'ASSIGNED', 'UPDATED'].map(h => <span key={h}>{h}</span>)}
            </div>
            {filtered.length === 0 && <div style={{ padding: '28px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No tasks match your filters</div>}
            {filtered.map((t, i) => {
              const meta = getTypeMeta(t.taskType, customTypes)
              const pri = PRIORITY_BADGE[t.priority]
              const overdue = isOverdue(t.dueDate)
              const sc = STATUS_COLS.find(s => s.key === t.status)
              return (
                <div key={t.taskId} onClick={() => setSelected(t)} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.3fr 1fr 1fr 1fr 1.2fr 65px', padding: '10px 14px', borderBottom: i < filtered.length - 1 ? '1px solid #F9FAFB' : 'none', alignItems: 'center', cursor: 'pointer', background: t.status === 'denied' ? '#FFF5F5' : overdue ? '#FFFBEB' : '#fff' }}
                  onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = '#F9FAFB'}
                  onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = t.status === 'denied' ? '#FFF5F5' : overdue ? '#FFFBEB' : '#fff'}>
                  <div><div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>{t.patientName}</div><div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>DOB: {formatDob(t.patientDob)}</div></div>
                  <span style={{ fontSize: 11, color: '#6B7280', fontWeight: 500 }}>{t.ecwAccountNumber}</span>
                  <span style={{ fontSize: 11, background: meta.bg, color: meta.color, padding: '2px 7px', borderRadius: 4, fontWeight: 600, width: 'fit-content' }}>{meta.icon} {meta.label}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: sc?.dot }} /><span style={{ fontSize: 12, color: t.status === 'denied' ? '#DC2626' : '#374151', fontWeight: t.status === 'denied' ? 700 : 400 }}>{sc?.label}</span></div>
                  <span style={{ fontSize: 11, background: pri.bg, color: pri.color, padding: '2px 7px', borderRadius: 4, fontWeight: 600, width: 'fit-content' }}>{pri.label}</span>
                  <span style={{ fontSize: 12, color: overdue ? '#DC2626' : '#374151', fontWeight: overdue ? 700 : 400 }}>{t.dueDate ?? '—'}</span>
                  <span style={{ fontSize: 12, color: '#374151' }}>{t.assignedName ?? '—'}</span>
                  <span style={{ fontSize: 11, color: '#9CA3AF' }}>{timeAgo(t.updatedAt)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selected && (
        <TaskDetail
          task={selected} customTypes={customTypes}
          onClose={() => setSelected(null)}
          onEdit={() => { setPanelTask(selected); setShowPanel(true); setSelected(null) }}
          onStatusChange={handleStatusChange}
        />
      )}

      {showPanel && (
        <TaskPanel
          task={panelTask} customTypes={customTypes}
          onClose={() => setShowPanel(false)}
          onSave={handleSave}
        />
      )}

      {showManageTypes && (
        <ManageTypesPanel
          customTypes={customTypes}
          onClose={() => setShowManageTypes(false)}
          onSave={setCustomTypes}
        />
      )}
    </div>
  )
}

export default function App() {
  const { user, loading, logout, setUser } = useAuth()
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
      <div style={{ fontSize: 14, color: '#9CA3AF' }}>Loading…</div>
    </div>
  )
  if (!user) return <LoginPage onSuccess={() => window.location.reload()} />
  return <Dashboard onLogout={async () => { await logout(); setUser(null) }} />
}
