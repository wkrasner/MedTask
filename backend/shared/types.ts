// ── Task types ────────────────────────────────────────────────────────────────
export type TaskStatus = 'open' | 'in-progress' | 'pending' | 'completed' | 'denied' | 'cancelled'
export type Priority = 'urgent' | 'high' | 'normal' | 'low'

export interface ActivityEntry {
  id: string
  text: string
  staffId: string
  staffName: string
  timestamp: string
}

export interface Task {
  taskId: string
  taskType: string
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
  createdAt: string
  createdBy: string
  activityLog?: ActivityEntry[]
  customFields?: Record<string, string>
  [key: string]: unknown
}

// ── Notification prefs ────────────────────────────────────────────────────────
export type AlertType =
  | 'task_created_urgent'
  | 'task_status_changed'
  | 'task_denied'
  | 'task_overdue'

export interface NotificationPref {
  userId: string          // Cognito sub
  name: string
  email: string
  emailEnabled: boolean
  smsEnabled: boolean
  phone?: string          // E.164 format e.g. +16315550000
  alertTypes: AlertType[]
  updatedAt: string
}

// ── API shapes ────────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  pagination?: {
    nextKey?: string
    count: number
  }
}

export interface ListTasksQuery {
  taskType?: string
  status?: TaskStatus
  assignedTo?: string
  limit?: number
  lastKey?: string
}
