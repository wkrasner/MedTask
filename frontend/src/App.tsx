import { useState, useMemo, useEffect, useCallback } from 'react'
import { useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import { getCurrentUserInfo } from './api/client'
import { useTasks, createTask, updateTask, addActivityEntry } from './api/tasks'
import { apiFetch } from './api/client'

async function loadCustomTypes(): Promise<CustomTaskTypeDef[]> {
  try {
    const result = await apiFetch<{ success: boolean; data: CustomTaskTypeDef[] }>('/config/task-types')
    return result.data ?? []
  } catch { return [] }
}

async function saveCustomTypes(types: CustomTaskTypeDef[]): Promise<void> {
  await apiFetch('/config/task-types', {
    method: 'PUT',
    body: JSON.stringify({ types }),
  })
}
import { getAllPrefs, saveUserPrefs } from './api/prefs'
import type { Task, ActivityEntry, NotificationPref, AlertType } from '../../backend/shared/types'

// ── Local types ───────────────────────────────────────────────────────────────
type TaskStatus = 'open' | 'in-progress' | 'pending' | 'completed' | 'denied' | 'cancelled'
type Priority = 'urgent' | 'high' | 'normal' | 'low'

interface CustomTaskTypeDef {
  key: string; label: string; icon: string; color: string; bg: string
  fields: Array<{ key: string; label: string; type: string; options?: string[]; placeholder?: string }>
}

interface CurrentUser { userId: string; email: string; name: string }

// ── Constants ─────────────────────────────────────────────────────────────────
const BUILTIN_TYPE_META: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  'prior-auth':      { label: 'Prior Auth',      color: '#7C3AED', bg: '#EDE9FE', icon: '🔐' },
  'prescription':    { label: 'Prescription',    color: '#0369A1', bg: '#E0F2FE', icon: '💊' },
  'return-call':     { label: 'Return Call',     color: '#B45309', bg: '#FEF3C7', icon: '📞' },
  'scheduling':      { label: 'Scheduling',      color: '#065F46', bg: '#D1FAE5', icon: '📅' },
  'records-request': { label: 'Records Request', color: '#9D174D', bg: '#FCE7F3', icon: '📋' },
  'referral':        { label: 'Referral',        color: '#1E40AF', bg: '#DBEAFE', icon: '🏥' },
}

const BUILTIN_FIELDS: Record<string, Array<{ key: string; label: string; type: string; options?: string[]; placeholder?: string }>> = {
  'prior-auth': [{ key: 'insuranceName', label: 'Insurance name', type: 'text' }, { key: 'medicationOrProcedure', label: 'Medication or procedure', type: 'text' }, { key: 'authNumber', label: 'Auth number', type: 'text' }, { key: 'appealDeadline', label: 'Appeal deadline', type: 'date' }, { key: 'denialReason', label: 'Denial reason', type: 'text' }],
  'prescription': [{ key: 'medicationName', label: 'Medication name', type: 'text' }, { key: 'dosage', label: 'Dosage', type: 'text' }, { key: 'pharmacy', label: 'Pharmacy', type: 'text' }, { key: 'sentToPharmacy', label: 'Sent to pharmacy', type: 'select', options: ['No', 'Yes'] }],
  'return-call': [{ key: 'callbackNumber', label: 'Callback number', type: 'text' }, { key: 'reasonForCall', label: 'Reason for call', type: 'text' }],
  'scheduling': [{ key: 'appointmentType', label: 'Appointment type', type: 'text' }, { key: 'requestedProvider', label: 'Requested provider', type: 'text' }, { key: 'requestedDateRange', label: 'Requested date range', type: 'text' }, { key: 'confirmationNumber', label: 'Confirmation #', type: 'text' }],
  'records-request': [{ key: 'requestingProviderName', label: 'Requesting provider', type: 'text' }, { key: 'requestingProviderFax', label: 'Fax number', type: 'text' }, { key: 'recordTypes', label: 'Record types needed', type: 'text' }, { key: 'recordsDateRange', label: 'Date range', type: 'text' }, { key: 'authorizationOnFile', label: 'Authorization on file', type: 'select', options: ['Yes', 'No'] }],
  'referral': [{ key: 'referredToProvider', label: 'Referred to provider', type: 'text' }, { key: 'referredToSpecialty', label: 'Specialty', type: 'text' }, { key: 'referralReason', label: 'Referral reason', type: 'text' }, { key: 'urgency', label: 'Urgency', type: 'select', options: ['Routine', 'Urgent', 'Stat'] }, { key: 'insuranceAuthRequired', label: 'Insurance auth required', type: 'select', options: ['Yes', 'No'] }],
}

const STATUS_COLS = [
  { key: 'open', label: 'Open', dot: '#EF4444' },
  { key: 'in-progress', label: 'In Progress', dot: '#F59E0B' },
  { key: 'pending', label: 'Pending', dot: '#3B82F6' },
  { key: 'completed', label: 'Completed', dot: '#10B981' },
  { key: 'denied', label: 'Denied', dot: '#DC2626' },
  { key: 'cancelled', label: 'Cancelled', dot: '#9CA3AF' },
] as const

const PRIORITY_BADGE = {
  urgent: { bg: '#FEE2E2', color: '#991B1B', label: 'Urgent' },
  high:   { bg: '#FEF3C7', color: '#92400E', label: 'High' },
  normal: { bg: '#F3F4F6', color: '#374151', label: 'Normal' },
  low:    { bg: '#F0FDF4', color: '#166534', label: 'Low' },
} as const

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  task_created_urgent: '🚨 New urgent task created',
  task_status_changed: '🔄 Any status change',
  task_denied:         '⛔ Task denied',
  task_overdue:        '⏰ Daily overdue summary',
}

const COLOR_PALETTE = [
  { color: '#7C3AED', bg: '#EDE9FE' }, { color: '#0369A1', bg: '#E0F2FE' },
  { color: '#B45309', bg: '#FEF3C7' }, { color: '#065F46', bg: '#D1FAE5' },
  { color: '#9D174D', bg: '#FCE7F3' }, { color: '#1E40AF', bg: '#DBEAFE' },
  { color: '#991B1B', bg: '#FEE2E2' }, { color: '#374151', bg: '#F3F4F6' },
  { color: '#0F6E56', bg: '#E1F5EE' }, { color: '#92400E', bg: '#FEF3C7' },
]

const ICON_OPTIONS = ['🧪','📊','💉','🩺','🩹','📝','📬','🔔','📋','💼','🏃','🩻','💊','🧬','📞','📅','🏥','🔐','⚕️','🧾']

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
function daysSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return '1 day'
  return `${days} days`
}
function formatDob(dob: string) {
  if (!dob) return '—'
  const [y, m, d] = dob.split('-')
  return `${m}/${d}/${y}`
}
function formatActivityTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}
const today = new Date().toISOString().slice(0, 10)
const isOverdue = (d?: string | null) => !!d && d < today
const isDueToday = (d?: string | null) => d === today

function getTypeMeta(taskType: string, customTypes: CustomTaskTypeDef[]) {
  if (BUILTIN_TYPE_META[taskType]) return BUILTIN_TYPE_META[taskType]
  const c = customTypes.find(t => t.key === taskType)
  return c ? { label: c.label, color: c.color, bg: c.bg, icon: c.icon } : { label: taskType, color: '#374151', bg: '#F3F4F6', icon: '📋' }
}
function getTypeFields(taskType: string, customTypes: CustomTaskTypeDef[]) {
  if (BUILTIN_FIELDS[taskType]) return BUILTIN_FIELDS[taskType]
  return customTypes.find(t => t.key === taskType)?.fields ?? []
}

const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid #E5E7EB', fontSize: 13, fontFamily: 'inherit', color: '#111827', background: '#fff', outline: 'none' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 4 }
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 12 }}><label style={labelStyle}>{label.toUpperCase()}</label>{children}</div>
}


// ── Manage Task Types Panel ───────────────────────────────────────────────────
function ManageTypesPanel({ customTypes, onClose, onSave }: {
  customTypes: CustomTaskTypeDef[]
  onClose: () => void
  onSave: (types: CustomTaskTypeDef[]) => void
}) {
  const [types, setTypes] = useState<CustomTaskTypeDef[]>(customTypes)
  const [isNew, setIsNew] = useState(false)
  const [editing, setEditing] = useState<CustomTaskTypeDef | null>(null)
  const [formLabel, setFormLabel] = useState('')
  const [formIcon, setFormIcon] = useState('📋')
  const [formColor, setFormColor] = useState(COLOR_PALETTE[0].color)
  const [formBg, setFormBg] = useState(COLOR_PALETTE[0].bg)
  const [formFields, setFormFields] = useState<Array<{ key: string; label: string; type: string }>>([])

  const startNew = () => { setIsNew(true); setEditing(null); setFormLabel(''); setFormIcon('📋'); setFormColor(COLOR_PALETTE[0].color); setFormBg(COLOR_PALETTE[0].bg); setFormFields([]) }
  const startEdit = (t: CustomTaskTypeDef) => { setIsNew(false); setEditing(t); setFormLabel(t.label); setFormIcon(t.icon); setFormColor(t.color); setFormBg(t.bg); setFormFields([...t.fields]) }
  const cancelForm = () => { setIsNew(false); setEditing(null) }

  const saveType = () => {
    if (!formLabel.trim()) return
    const key = editing ? editing.key : formLabel.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    const newType: CustomTaskTypeDef = { key, label: formLabel.trim(), icon: formIcon, color: formColor, bg: formBg, fields: formFields }
    if (editing) setTypes(prev => prev.map(t => t.key === editing.key ? newType : t))
    else setTypes(prev => [...prev, newType])
    cancelForm()
  }

  const deleteType = (key: string) => setTypes(prev => prev.filter(t => t.key !== key))
  const addField = () => setFormFields(prev => [...prev, { key: `field${prev.length}`, label: '', type: 'text' }])
  const updateField = (i: number, label: string, type: string) => setFormFields(prev => prev.map((f, idx) => idx === i ? { ...f, key: label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''), label, type, options: type === 'select' ? ((f as any).options ?? []) : undefined } : f))
  const removeField = (i: number) => setFormFields(prev => prev.filter((_, idx) => idx !== i))

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 199 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', zIndex: 200, display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F9FAFB' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#111827' }}>⚙ Task Types</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Add custom task categories for your practice</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6B7280' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {/* Built-in types */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.05em', marginBottom: 10 }}>BUILT-IN TYPES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(BUILTIN_TYPE_META).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: v.bg, border: `1px solid ${v.color}30` }}>
                  <span style={{ fontSize: 16 }}>{v.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: v.color }}>{v.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: v.color, opacity: 0.6 }}>Built-in</span>
                </div>
              ))}
            </div>
          </div>

          {/* Custom types */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.05em', marginBottom: 10 }}>CUSTOM TYPES</div>
            {types.length === 0 && !isNew && (
              <div style={{ border: '2px dashed #E5E7EB', borderRadius: 8, padding: 20, textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>No custom types yet</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {types.map(t => (
                <div key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: t.bg, border: `1px solid ${t.color}30` }}>
                  <span style={{ fontSize: 16 }}>{t.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: t.color }}>{t.label}</div>
                    <div style={{ fontSize: 11, color: t.color, opacity: 0.6 }}>{t.fields.length} custom field{t.fields.length !== 1 ? 's' : ''}</div>
                  </div>
                  <button onClick={() => startEdit(t)} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, border: `1px solid ${t.color}50`, background: '#fff', color: t.color, cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button>
                  <button onClick={() => deleteType(t.key)} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, border: '1px solid #FECACA', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
                </div>
              ))}
            </div>
          </div>

          {/* Editor */}
          {(isNew || editing) && (
            <div style={{ background: '#F9FAFB', borderRadius: 10, padding: 16, marginBottom: 16, border: '1px solid #E5E7EB' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 14 }}>{isNew ? 'New task type' : `Editing: ${editing?.label}`}</div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>TYPE NAME</label>
                <input style={inputStyle} value={formLabel} onChange={e => setFormLabel(e.target.value)} placeholder="e.g. Lab Order" />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>ICON</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {ICON_OPTIONS.map(ico => (
                    <button key={ico} onClick={() => setFormIcon(ico)} style={{ width: 36, height: 36, fontSize: 18, border: `2px solid ${formIcon === ico ? formColor : '#E5E7EB'}`, borderRadius: 8, background: formIcon === ico ? formBg : '#fff', cursor: 'pointer' }}>{ico}</button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>COLOR</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {COLOR_PALETTE.map(p => (
                    <button key={p.color} onClick={() => { setFormColor(p.color); setFormBg(p.bg) }} style={{ width: 28, height: 28, borderRadius: '50%', background: p.color, border: `3px solid ${formColor === p.color ? '#111827' : 'transparent'}`, cursor: 'pointer' }} />
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: formBg, marginBottom: 14 }}>
                <span style={{ fontSize: 16 }}>{formIcon}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: formColor }}>{formLabel || 'Preview'}</span>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>CUSTOM FIELDS</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {formFields.map((f, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: '#fff', borderRadius: 8, border: '1px solid #E5E7EB' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px auto', gap: 6 }}>
                        <input style={inputStyle} value={f.label} onChange={e => updateField(i, e.target.value, f.type)} placeholder="Field name" />
                        <select style={inputStyle} value={f.type} onChange={e => updateField(i, f.label, e.target.value)}>
                          <option value="text">Text</option>
                          <option value="date">Date</option>
                          <option value="textarea">Long text</option>
                          <option value="select">Dropdown</option>
                        </select>
                        <button onClick={() => removeField(i)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FFF5F5', color: '#DC2626', cursor: 'pointer', fontFamily: 'inherit' }}>✕</button>
                      </div>
                      {f.type === 'select' && (
                        <div>
                          <label style={{ ...labelStyle, marginBottom: 4 }}>DROPDOWN OPTIONS (one per line)</label>
                          <textarea
                            style={{ ...inputStyle, minHeight: 70, resize: 'vertical', fontSize: 12 }}
                            value={(f as any).optionsText ?? (f as any).options?.join('\n') ?? ''}
                            onChange={e => {
                              const text = e.target.value
                              const options = text.split('\n').map((o: string) => o.trim()).filter(Boolean)
                              setFormFields(prev => prev.map((field, idx) => idx === i ? { ...field, optionsText: text, options } : field))
                            }}
                            placeholder={'Option 1\nOption 2\nOption 3'}
                          />
                          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Enter each option on a new line</div>
                        </div>
                      )}
                    </div>
                  ))}
                  <button onClick={addField} style={{ padding: 7, borderRadius: 6, border: '1px dashed #E5E7EB', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#6B7280', fontFamily: 'inherit' }}>+ Add field</button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={cancelForm} style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: '#374151' }}>Cancel</button>
                <button onClick={saveType} disabled={!formLabel.trim()} style={{ flex: 2, padding: 8, borderRadius: 6, border: 'none', background: formLabel.trim() ? formColor : '#D1D5DB', color: '#fff', cursor: formLabel.trim() ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
                  {isNew ? 'Add type' : 'Save changes'}
                </button>
              </div>
            </div>
          )}

          {!isNew && !editing && (
            <button onClick={startNew} style={{ width: '100%', padding: 10, borderRadius: 8, border: '2px dashed #6366F1', background: '#EEF2FF', color: '#4338CA', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
              + Add new task type
            </button>
          )}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid #E5E7EB', display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 9, borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: '#374151' }}>Cancel</button>
          <button onClick={() => { onSave(types); onClose() }} style={{ flex: 2, padding: 9, borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>Save all types</button>
        </div>
      </div>
    </>
  )
}

// ── Notifications Settings Panel ──────────────────────────────────────────────
function NotificationsPanel({ currentUser, onClose }: { currentUser: CurrentUser; onClose: () => void }) {
  const [prefs, setPrefs] = useState<NotificationPref[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<NotificationPref>>({})

  useEffect(() => {
    getAllPrefs().then(p => { setPrefs(p); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  const startEdit = (pref: NotificationPref) => {
    setEditingId(pref.userId)
    setEditForm({ ...pref })
  }

  const cancelEdit = () => { setEditingId(null); setEditForm({}) }

  const handleSave = async (userId: string) => {
    setSaving(userId)
    try {
      const saved = await saveUserPrefs(userId, editForm)
      setPrefs(prev => prev.map(p => p.userId === userId ? saved : p))
      setEditingId(null)
    } catch (e) {
      alert('Failed to save: ' + (e as Error).message)
    } finally {
      setSaving(null)
    }
  }

  const toggleAlertType = (type: AlertType) => {
    const current = editForm.alertTypes ?? []
    setEditForm(f => ({
      ...f,
      alertTypes: current.includes(type) ? current.filter(t => t !== type) : [...current, type],
    }))
  }

  const canEdit = (pref: NotificationPref) => pref.userId === currentUser.userId

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 199 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 520, background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', zIndex: 200, display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F9FAFB' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#111827' }}>🔔 Notification Settings</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>Manage email and SMS alerts per staff member</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6B7280' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#9CA3AF', padding: 40 }}>Loading staff…</div>
          ) : prefs.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#9CA3AF', padding: 40 }}>No staff found in Cognito</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {prefs.map(pref => {
                const isEditing = editingId === pref.userId
                const isMe = pref.userId === currentUser.userId
                const editable = canEdit(pref)

                return (
                  <div key={pref.userId} style={{ border: `1px solid ${isMe ? '#6366F1' : '#E5E7EB'}`, borderRadius: 10, overflow: 'hidden' }}>
                    {/* Staff header */}
                    <div style={{ padding: '12px 14px', background: isMe ? '#EEF2FF' : '#F9FAFB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: isMe ? '#6366F1' : '#E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: isMe ? '#fff' : '#374151' }}>
                          {pref.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>{pref.name} {isMe && <span style={{ fontSize: 10, color: '#6366F1', fontWeight: 600 }}>(you)</span>}</div>
                          <div style={{ fontSize: 11, color: '#9CA3AF' }}>{pref.email}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {!isEditing && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            {pref.emailEnabled && <span style={{ fontSize: 10, background: '#D1FAE5', color: '#065F46', padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>✉ Email</span>}
                            {pref.smsEnabled && <span style={{ fontSize: 10, background: '#DBEAFE', color: '#1E40AF', padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>📱 SMS</span>}
                          </div>
                        )}
                        {editable && !isEditing && (
                          <button onClick={() => startEdit(pref)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: '#374151' }}>Edit</button>
                        )}
                        {!editable && <span style={{ fontSize: 11, color: '#D1D5DB' }}>Edit your own only</span>}
                      </div>
                    </div>

                    {/* Edit form */}
                    {isEditing && (
                      <div style={{ padding: '14px 14px', borderTop: '1px solid #E5E7EB' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                          <Field label="Display name">
                            <input style={inputStyle} value={editForm.name ?? ''} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                          </Field>
                          <Field label="Phone (for SMS)">
                            <input style={inputStyle} value={editForm.phone ?? ''} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1XXXXXXXXXX" />
                          </Field>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#374151', padding: '8px 12px', borderRadius: 8, border: '1px solid #E5E7EB', background: editForm.emailEnabled ? '#D1FAE5' : '#fff' }}>
                            <input type="checkbox" checked={editForm.emailEnabled ?? false} onChange={e => setEditForm(f => ({ ...f, emailEnabled: e.target.checked }))} />
                            ✉️ Email alerts
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#374151', padding: '8px 12px', borderRadius: 8, border: '1px solid #E5E7EB', background: editForm.smsEnabled ? '#DBEAFE' : '#fff' }}>
                            <input type="checkbox" checked={editForm.smsEnabled ?? false} onChange={e => setEditForm(f => ({ ...f, smsEnabled: e.target.checked }))} />
                            📱 SMS alerts
                          </label>
                        </div>

                        <div style={{ marginBottom: 14 }}>
                          <label style={labelStyle}>ALERT TYPES</label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {(Object.entries(ALERT_TYPE_LABELS) as [AlertType, string][]).map(([type, label]) => (
                              <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: '#374151', padding: '7px 10px', borderRadius: 7, border: '1px solid #E5E7EB', background: (editForm.alertTypes ?? []).includes(type) ? '#EEF2FF' : '#fff' }}>
                                <input type="checkbox" checked={(editForm.alertTypes ?? []).includes(type)} onChange={() => toggleAlertType(type)} />
                                {label}
                              </label>
                            ))}
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={cancelEdit} style={{ flex: 1, padding: '8px', borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: '#374151' }}>Cancel</button>
                          <button onClick={() => handleSave(pref.userId)} disabled={saving === pref.userId} style={{ flex: 2, padding: '8px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
                            {saving === pref.userId ? 'Saving…' : 'Save preferences'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Summary when not editing */}
                    {!isEditing && (pref.emailEnabled || pref.smsEnabled) && pref.alertTypes.length > 0 && (
                      <div style={{ padding: '8px 14px', borderTop: '1px solid #F3F4F6', fontSize: 11, color: '#6B7280' }}>
                        {pref.alertTypes.map(t => ALERT_TYPE_LABELS[t]).join(' · ')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Task Panel ────────────────────────────────────────────────────────────────
function TaskPanel({ task, customTypes, currentUser, onClose, onSave }: {
  task: Task | null; customTypes: CustomTaskTypeDef[]
  currentUser: CurrentUser; onClose: () => void; onSave: (t: Task) => void
}) {
  const [taskType, setTaskType] = useState(task?.taskType ?? 'prior-auth')
  const [status, setStatus] = useState<TaskStatus>((task?.status as TaskStatus) ?? 'open')
  const [priority, setPriority] = useState<Priority>((task?.priority as Priority) ?? 'normal')
  const [patientName, setPatientName] = useState(task?.patientName ?? '')
  const [patientDob, setPatientDob] = useState(task?.patientDob ?? '')
  const [ecwAccountNumber, setEcwAccountNumber] = useState(task?.ecwAccountNumber ?? '')
  const [assignedTo, setAssignedTo] = useState(task?.assignedTo ?? '')
  const [assignedName, setAssignedName] = useState(task?.assignedName ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() => {
    if (!task) return {}
    const vals: Record<string, string> = {}
    const fields = getTypeFields(task.taskType, customTypes)
    fields.forEach(f => {
      // Check customFields first, then task object directly
      const v = task.customFields?.[f.key] ?? task[f.key]
      if (v !== undefined && v !== null) {
        vals[f.key] = v === true ? 'Yes' : v === false ? 'No' : String(v)
      }
    })
    if (task.customFields) Object.assign(vals, task.customFields)
    return vals
  })
  const [saving, setSaving] = useState(false)

  const currentFields = getTypeFields(taskType, customTypes)
  const meta = getTypeMeta(taskType, customTypes)

  // Staff list for assignment - we'd normally load from API but keep simple for now
  const staffOptions = [
    { id: currentUser.userId, name: currentUser.name },
  ]

  const handleSave = async () => {
    if (!patientName.trim() || !patientDob || !ecwAccountNumber.trim()) return
    setSaving(true)
    try {
      const payload: Partial<Task> = {
        taskType, status, priority,
        patientName: patientName.trim(), patientDob,
        ecwAccountNumber: ecwAccountNumber.trim(),
        assignedTo: assignedTo || undefined,
        assignedName: assignedName || undefined,
        notes: notes.trim(),
        dueDate: dueDate || undefined,
        createdBy: task?.createdBy ?? currentUser.userId,
        customFields: fieldValues,
        activityLog: task?.activityLog ?? [],
        ...fieldValues,
      }
      let saved: Task
      if (task?.taskId) {
        saved = await updateTask(task.taskId, payload)
      } else {
        saved = await createTask(payload)
      }
      onSave(saved)
      onClose()
    } catch (e) {
      alert('Failed to save: ' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const disabled = !patientName.trim() || !patientDob || !ecwAccountNumber.trim() || saving

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 199 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', zIndex: 200, display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans', sans-serif" }}>
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
              <select style={inputStyle} value={taskType} onChange={e => { setTaskType(e.target.value); setFieldValues({}) }}>
                <optgroup label="Built-in">
                  {Object.entries(BUILTIN_TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </optgroup>
                {customTypes.length > 0 && <optgroup label="Custom">{customTypes.map(t => <option key={t.key} value={t.key}>{t.icon} {t.label}</option>)}</optgroup>}
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
                <input style={inputStyle} value={assignedName} onChange={e => setAssignedName(e.target.value)} placeholder="Staff name" />
              </Field>
              <Field label="Due date"><input type="date" style={inputStyle} value={dueDate ?? ''} onChange={e => setDueDate(e.target.value)} /></Field>
            </div>
          </div>

          {/* Type-specific fields */}
          {currentFields.length > 0 && (
            <div style={{ background: '#F9FAFB', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6B7280', letterSpacing: '0.05em', marginBottom: 10 }}>{meta.icon} {meta.label.toUpperCase()} DETAILS</div>
              {currentFields.map(f => (
                <Field key={f.key} label={f.label}>
                  {f.type === 'select' ? (
                    <select style={inputStyle} value={fieldValues[f.key] ?? ''} onChange={e => setFieldValues(v => ({ ...v, [f.key]: e.target.value }))}>
                      <option value="">Select…</option>
                      {f.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={fieldValues[f.key] ?? ''} onChange={e => setFieldValues(v => ({ ...v, [f.key]: e.target.value }))} placeholder={f.placeholder} />
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
          <button onClick={handleSave} disabled={disabled} style={{ flex: 2, padding: '9px', borderRadius: 7, border: 'none', background: disabled ? '#A5B4FC' : 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, fontFamily: 'inherit' }}>
            {saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Task Card (draggable) ─────────────────────────────────────────────────────
function TaskCard({ task, customTypes, onClick, onDragStart }: {
  task: Task; customTypes: CustomTaskTypeDef[]
  onClick: (t: Task) => void
  onDragStart?: (e: React.DragEvent, taskId: string) => void
}) {
  const meta = getTypeMeta(task.taskType, customTypes)
  const pri = PRIORITY_BADGE[task.priority as Priority]
  const overdue = isOverdue(task.dueDate)
  const dueToday = isDueToday(task.dueDate)
  const denied = task.status === 'denied'
  const [dragging, setDragging] = useState(false)

  const handleDragStart = (e: React.DragEvent) => {
    setDragging(true)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('taskId', task.taskId)
    onDragStart?.(e, task.taskId)
  }

  const handleDragEnd = () => setDragging(false)

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={() => !dragging && onClick(task)}
      style={{
        background: denied ? '#FFF5F5' : '#fff',
        border: `1px solid ${denied ? '#FECACA' : overdue ? '#FCA5A5' : '#E5E7EB'}`,
        borderLeft: `3px solid ${denied ? '#DC2626' : meta.color}`,
        borderRadius: 8, padding: '10px 12px',
        cursor: dragging ? 'grabbing' : 'grab',
        transition: 'box-shadow 0.15s, transform 0.15s, opacity 0.15s',
        marginBottom: 7,
        opacity: dragging ? 0.45 : 1,
        transform: dragging ? 'scale(0.97)' : 'none',
        userSelect: 'none',
      }}
      onMouseEnter={e => { if (!dragging) { (e.currentTarget as HTMLDivElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)' } }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; (e.currentTarget as HTMLDivElement).style.transform = dragging ? 'scale(0.97)' : 'none' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: '#111827', flex: 1, marginRight: 5 }}>{task.patientName}</span>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: pri?.bg, color: pri?.color, whiteSpace: 'nowrap' }}>{pri?.label}</span>
      </div>
      <div style={{ fontSize: 10, color: '#9CA3AF', marginBottom: 4 }}>DOB: {formatDob(task.patientDob)} · {task.ecwAccountNumber}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, background: meta.bg, color: meta.color, padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>{meta.icon} {meta.label}</span>
        {denied && <span style={{ fontSize: 9, background: '#FEE2E2', color: '#991B1B', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>⛔ Denied</span>}
        {!denied && overdue && <span style={{ fontSize: 9, background: '#FEE2E2', color: '#991B1B', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>⚠ Overdue</span>}
        {!denied && dueToday && <span style={{ fontSize: 9, background: '#FEF3C7', color: '#92400E', padding: '1px 5px', borderRadius: 3, fontWeight: 700 }}>Today</span>}
      </div>
      <div style={{ fontSize: 11, color: '#6B7280', lineHeight: 1.4, marginBottom: 5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' } as React.CSSProperties}>{task.notes}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#9CA3AF' }}>{task.assignedName ?? 'Unassigned'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, background: '#F3F4F6', color: '#6B7280', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
            🕐 {daysSince(task.createdAt ?? task.updatedAt)}
          </span>
          <span style={{ fontSize: 10, color: '#9CA3AF' }}>{timeAgo(task.updatedAt)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Task Detail Modal ─────────────────────────────────────────────────────────
function TaskDetail({ task, customTypes, currentUser, onClose, onEdit, onStatusChange, onAddActivity }: {
  task: Task; customTypes: CustomTaskTypeDef[]; currentUser: CurrentUser
  onClose: () => void; onEdit: () => void
  onStatusChange: (id: string, s: string) => void
  onAddActivity: (taskId: string, entry: ActivityEntry) => void
}) {
  const meta = getTypeMeta(task.taskType, customTypes)
  const pri = PRIORITY_BADGE[task.priority as Priority]
  const overdue = isOverdue(task.dueDate)
  const fields = getTypeFields(task.taskType, customTypes)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const log = task.activityLog ?? []

  const handleAddNote = async () => {
    if (!newNote.trim() || savingNote) return
    setSavingNote(true)
    try {
      const entry = await addActivityEntry(task.taskId, {
        text: newNote.trim(),
        staffId: currentUser.userId,
        staffName: currentUser.name,
      })
      onAddActivity(task.taskId, entry)
      setNewNote('')
    } catch (e) {
      alert('Failed to save note: ' + (e as Error).message)
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose() }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', overflow: 'hidden', fontFamily: "'DM Sans', sans-serif", display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>

        {/* Header */}
        <div style={{ background: meta.bg, padding: '16px 20px', borderBottom: `2px solid ${meta.color}25`, flexShrink: 0 }}>
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

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* Task details */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: pri?.bg, color: pri?.color }}>{pri?.label}</span>
              {task.status === 'denied' && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: '#FEE2E2', color: '#991B1B' }}>⛔ Denied</span>}
              {task.dueDate && <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, background: overdue ? '#FEE2E2' : '#F3F4F6', color: overdue ? '#991B1B' : '#374151' }}>Due: {task.dueDate}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginBottom: 14 }}>
              {fields.map(f => {
                // Look in customFields first, then directly on task object
                const rawVal = task.customFields?.[f.key] ?? task[f.key]
                const val = rawVal === null || rawVal === undefined ? '—'
                  : rawVal === false ? 'No'
                  : rawVal === true ? 'Yes ✓'
                  : String(rawVal)
                const isWide = f.type === 'textarea' || f.label.toLowerCase().includes('reason') || f.label.toLowerCase().includes('referral reason')
                const isDenial = f.label.toLowerCase().includes('denial')
                return (
                  <div key={f.key} style={{ gridColumn: isWide ? 'span 2' : 'span 1' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', marginBottom: 2 }}>{f.label.toUpperCase()}</div>
                    <div style={{ fontSize: 13, color: isDenial ? '#991B1B' : '#111827', fontWeight: isDenial ? 600 : 500, background: isDenial ? '#FFF5F5' : 'transparent', padding: isDenial ? '4px 7px' : 0, borderRadius: 4 }}>{val || '—'}</div>
                  </div>
                )
              })}
            </div>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', marginBottom: 5 }}>DESCRIPTION</div>
              <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, background: '#F9FAFB', borderRadius: 6, padding: '8px 10px' }}>{task.notes || '—'}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9CA3AF' }}>
              <span>Assigned: <strong style={{ color: '#374151' }}>{task.assignedName ?? '—'}</strong></span>
              <span>Updated {timeAgo(task.updatedAt)}</span>
            </div>
          </div>

          {/* Activity log */}
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', marginBottom: 12 }}>
              ACTIVITY LOG {log.length > 0 && <span style={{ background: '#F3F4F6', borderRadius: 10, padding: '1px 6px', marginLeft: 4, color: '#6B7280' }}>{log.length}</span>}
            </div>
            {log.length === 0 ? (
              <div style={{ fontSize: 12, color: '#D1D5DB', textAlign: 'center', padding: '16px 0', borderTop: '1px dashed #E5E7EB' }}>No activity yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {[...log].reverse().map((entry, i) => (
                  <div key={entry.id} style={{ display: 'flex', gap: 10, paddingBottom: 14, paddingTop: i === 0 ? 0 : 14, borderTop: i === 0 ? 'none' : '1px solid #F3F4F6' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#EEF2FF', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#4338CA', flexShrink: 0 }}>
                      {entry.staffName.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>{entry.staffName}</span>
                        <span style={{ fontSize: 11, color: '#9CA3AF' }}>{formatActivityTime(entry.timestamp)}</span>
                      </div>
                      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, background: '#F9FAFB', borderRadius: 6, padding: '7px 10px' }}>{entry.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add note */}
            <div style={{ marginTop: 14, borderTop: '1px solid #F3F4F6', paddingTop: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF', letterSpacing: '0.06em', marginBottom: 8 }}>ADD NOTE AS {currentUser.name.toUpperCase()}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <textarea value={newNote} onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAddNote() }}
                  placeholder="Type a note… (Ctrl+Enter to save)"
                  style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, fontFamily: 'inherit', color: '#111827', resize: 'none', minHeight: 64, outline: 'none', lineHeight: 1.5 }} />
                <button onClick={handleAddNote} disabled={!newNote.trim() || savingNote}
                  style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: newNote.trim() && !savingNote ? 'linear-gradient(135deg,#6366F1,#8B5CF6)' : '#E5E7EB', color: newNote.trim() && !savingNote ? '#fff' : '#9CA3AF', cursor: newNote.trim() && !savingNote ? 'pointer' : 'not-allowed', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  {savingNote ? '…' : 'Add note'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Status footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid #F3F4F6', display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
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
function Dashboard({ currentUser, onLogout }: { currentUser: CurrentUser; onLogout: () => void }) {
  const { tasks, setTasks, loading, error, refresh } = useTasks()
  const [customTypes, setCustomTypes] = useState<CustomTaskTypeDef[]>([])

  // Load custom types from DynamoDB on mount
  useEffect(() => {
    loadCustomTypes().then(types => {
      if (types.length > 0) setCustomTypes(types)
    }).catch(console.error)
  }, [])
  const [view, setView] = useState<'board' | 'list'>('board')
  const [filterType, setFilterType] = useState('all')
  const [filterStaff, setFilterStaff] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selected, setSelected] = useState<Task | null>(null)
  const [panelTask, setPanelTask] = useState<Task | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [showManageTypes, setShowManageTypes] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [search, setSearch] = useState('')
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)

  const allTypeMeta = useMemo(() => {
    const result = { ...BUILTIN_TYPE_META }
    customTypes.forEach(t => { (result as any)[t.key] = { label: t.label, color: t.color, bg: t.bg, icon: t.icon } })
    return result
  }, [customTypes])

  const filtered = useMemo(() => tasks.filter(t => {
    if (filterType !== 'all' && t.taskType !== filterType) return false
    if (filterStaff !== 'all' && t.assignedTo !== filterStaff) return false
    if (filterStatus !== 'all' && t.status !== filterStatus) return false
    if (search && !t.patientName.toLowerCase().includes(search.toLowerCase()) &&
        !t.notes.toLowerCase().includes(search.toLowerCase()) &&
        !(t.ecwAccountNumber ?? '').toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [tasks, filterType, filterStaff, filterStatus, search])

  const stats = useMemo(() => ({
    open: tasks.filter(t => t.status === 'open').length,
    urgent: tasks.filter(t => t.priority === 'urgent' && !['completed', 'cancelled'].includes(t.status)).length,
    denied: tasks.filter(t => t.status === 'denied').length,
    overdue: tasks.filter(t => isOverdue(t.dueDate) && !['completed', 'cancelled', 'denied'].includes(t.status)).length,
  }), [tasks])

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    try {
      const updated = await updateTask(taskId, { status: newStatus as TaskStatus })
      setTasks(prev => prev.map(t => t.taskId === taskId ? updated : t))
    } catch (e) {
      console.error('Status change failed', e)
      refresh()
    }
  }

  const handleSave = (savedTask: Task) => {
    setTasks(prev => {
      const exists = prev.find(t => t.taskId === savedTask.taskId)
      return exists ? prev.map(t => t.taskId === savedTask.taskId ? savedTask : t) : [savedTask, ...prev]
    })
  }

  const handleAddActivity = (taskId: string, entry: ActivityEntry) => {
    setTasks(prev => prev.map(t => t.taskId === taskId
      ? { ...t, activityLog: [...(t.activityLog ?? []), entry], updatedAt: new Date().toISOString() }
      : t
    ))
    setSelected(prev => prev?.taskId === taskId
      ? { ...prev, activityLog: [...(prev.activityLog ?? []), entry], updatedAt: new Date().toISOString() }
      : prev
    )
  }

  const handleDragStart = (_e: React.DragEvent, taskId: string) => {
    setDraggingTaskId(taskId)
  }

  const handleDragOver = (e: React.DragEvent, colKey: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(colKey)
  }

  const handleDragLeave = () => {
    setDragOverCol(null)
  }

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('taskId')
    setDragOverCol(null)
    setDraggingTaskId(null)
    if (!taskId) return
    const task = tasks.find(t => t.taskId === taskId)
    if (!task || task.status === newStatus) return
    await handleStatusChange(taskId, newStatus)
  }

  const selBtn = (active: boolean): React.CSSProperties => ({ padding: '5px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: active ? '1px solid #6366F1' : '1px solid #E5E7EB', background: active ? '#EEF2FF' : '#fff', color: active ? '#4338CA' : '#374151', cursor: 'pointer', whiteSpace: 'nowrap' })

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}><div style={{ fontSize: 14, color: '#9CA3AF' }}>Loading tasks…</div></div>
  if (error) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}><div style={{ fontSize: 14, color: '#DC2626' }}>Error: {error} <button onClick={refresh} style={{ marginLeft: 8, fontSize: 12, cursor: 'pointer' }}>Retry</button></div></div>

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', fontFamily: "'DM Sans', sans-serif" }}>
      {/* Nav */}
      <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB', padding: '0 20px', display: 'flex', alignItems: 'center', gap: 10, height: 52, position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800 }}>✚</div>
          <span style={{ fontWeight: 800, fontSize: 15, color: '#111827', letterSpacing: '-0.02em' }}>OfficeTasks</span>
        </div>
        <div style={{ flex: 1 }} />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient, ECW #, or notes…" style={{ padding: '5px 11px', borderRadius: 7, border: '1px solid #E5E7EB', fontSize: 12, width: 230, outline: 'none', fontFamily: 'inherit', background: '#F9FAFB', color: '#111827' }} />
        <button onClick={() => { setPanelTask(null); setShowPanel(true) }} style={{ padding: '7px 14px', borderRadius: 7, border: 'none', background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>+ New Task</button>
        <button onClick={() => setShowManageTypes(true)} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>⚙ Types</button>
        <button onClick={() => setShowNotifications(true)} style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #E5E7EB', background: '#fff', color: '#374151', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>🔔 Notifications</button>
        <div style={{ display: 'flex', gap: 1, background: '#F3F4F6', borderRadius: 8, padding: 3 }}>
          {(['board', 'list'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '3px 11px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', background: view === v ? '#fff' : 'transparent', color: view === v ? '#111827' : '#6B7280', boxShadow: view === v ? '0 1px 3px rgba(0,0,0,0.08)' : 'none' }}>{v === 'board' ? '⠿ Board' : '☰ List'}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap' }}>{currentUser.name}</div>
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
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#9CA3AF' }}>{filtered.length} task{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Board */}
        {view === 'board' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
            {STATUS_COLS.map(col => {
              const ct = filtered.filter(t => t.status === col.key)
              const hasDenied = col.key === 'denied' && ct.length > 0
              const isOver = dragOverCol === col.key
              const isDraggingFromThis = draggingTaskId ? tasks.find(t => t.taskId === draggingTaskId)?.status === col.key : false
              return (
                <div key={col.key}
                  onDragOver={e => handleDragOver(e, col.key)}
                  onDragLeave={handleDragLeave}
                  onDrop={e => handleDrop(e, col.key)}
                  style={{ transition: 'background 0.15s', borderRadius: 10, padding: isOver ? '6px' : '0px', background: isOver ? `${col.dot}18` : 'transparent', border: isOver ? `2px dashed ${col.dot}` : '2px solid transparent' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: col.dot }} />
                    <span style={{ fontWeight: 700, fontSize: 11, color: col.key === 'denied' ? '#DC2626' : '#374151' }}>{col.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, background: hasDenied ? '#FEE2E2' : '#F3F4F6', borderRadius: 10, padding: '1px 6px', color: hasDenied ? '#991B1B' : '#9CA3AF' }}>{ct.length}</span>
                  </div>
                  {ct.length === 0
                    ? <div style={{ border: `2px dashed ${isOver ? col.dot : '#E5E7EB'}`, borderRadius: 8, padding: '20px 8px', textAlign: 'center', fontSize: 10, color: isOver ? col.dot : '#D1D5DB', transition: 'all 0.15s' }}>
                        {isOver ? `Drop here` : 'Empty'}
                      </div>
                    : ct.map(t => (
                        <TaskCard
                          key={t.taskId} task={t} customTypes={customTypes}
                          onClick={setSelected}
                          onDragStart={handleDragStart}
                        />
                      ))
                  }
                  {/* Drop zone at bottom of non-empty columns */}
                  {ct.length > 0 && isOver && (
                    <div style={{ border: `2px dashed ${col.dot}`, borderRadius: 8, padding: '10px 8px', textAlign: 'center', fontSize: 10, color: col.dot, marginTop: 6 }}>
                      Drop here
                    </div>
                  )}
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
            {filtered.length === 0 && <div style={{ padding: '28px', textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>No tasks found</div>}
            {filtered.map((t, i) => {
              const meta = getTypeMeta(t.taskType, customTypes)
              const pri = PRIORITY_BADGE[t.priority as Priority]
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
                  <span style={{ fontSize: 11, background: pri?.bg, color: pri?.color, padding: '2px 7px', borderRadius: 4, fontWeight: 600, width: 'fit-content' }}>{pri?.label}</span>
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
        <TaskDetail task={selected} customTypes={customTypes} currentUser={currentUser}
          onClose={() => setSelected(null)}
          onEdit={() => { setPanelTask(selected); setShowPanel(true); setSelected(null) }}
          onStatusChange={handleStatusChange}
          onAddActivity={handleAddActivity}
        />
      )}

      {showPanel && (
        <TaskPanel task={panelTask} customTypes={customTypes} currentUser={currentUser}
          onClose={() => setShowPanel(false)}
          onSave={handleSave}
        />
      )}

      {showManageTypes && (
        <ManageTypesPanel
          customTypes={customTypes}
          onClose={() => setShowManageTypes(false)}
          onSave={async (types) => {
            setCustomTypes(types)
            await saveCustomTypes(types).catch(console.error)
          }}
        />
      )}

      {showNotifications && (
        <NotificationsPanel currentUser={currentUser} onClose={() => setShowNotifications(false)} />
      )}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const { user, loading: authLoading, logout, setUser } = useAuth()
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [userLoading, setUserLoading] = useState(false)

  useEffect(() => {
    if (user && !currentUser) {
      setUserLoading(true)
      getCurrentUserInfo()
        .then(setCurrentUser)
        .catch(console.error)
        .finally(() => setUserLoading(false))
    }
  }, [user])

  if (authLoading || userLoading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC' }}>
      <div style={{ fontSize: 14, color: '#9CA3AF' }}>Loading…</div>
    </div>
  )

  if (!user || !currentUser) return <LoginPage onSuccess={() => window.location.reload()} />

  return <Dashboard currentUser={currentUser} onLogout={async () => { await logout(); setUser(null) }} />
}
