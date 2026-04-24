import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from './client'
import { Task, ActivityEntry, ApiResponse } from '../../../backend/shared/types'

// ── List all tasks ────────────────────────────────────────────────────────────
export function useTasks(filters: { status?: string; taskType?: string; assignedTo?: string } = {}) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch all statuses in parallel when no status filter
      if (!filters.status) {
        const statuses = ['open', 'in-progress', 'pending', 'completed', 'denied', 'cancelled']
        const results = await Promise.all(
          statuses.map(s => apiFetch<ApiResponse<Task[]>>(`/tasks?status=${s}&limit=200`))
        )
        const all = results.flatMap(r => r.data ?? [])
          .sort((a, b) => b.updatedAt > a.updatedAt ? 1 : -1)
        setTasks(all)
      } else {
        const qs = new URLSearchParams(filters as Record<string, string>).toString()
        const result = await apiFetch<ApiResponse<Task[]>>(`/tasks?${qs}`)
        setTasks(result.data ?? [])
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [JSON.stringify(filters)])

  useEffect(() => { load() }, [load])

  return { tasks, setTasks, loading, error, refresh: load }
}

// ── Create task ───────────────────────────────────────────────────────────────
export async function createTask(task: Partial<Task>): Promise<Task> {
  const result = await apiFetch<ApiResponse<Task>>('/tasks', {
    method: 'POST',
    body: JSON.stringify(task),
  })
  if (!result.success || !result.data) throw new Error(result.error ?? 'Failed to create task')
  return result.data
}

// ── Update task ───────────────────────────────────────────────────────────────
export async function updateTask(taskId: string, updates: Partial<Task>): Promise<Task> {
  const result = await apiFetch<ApiResponse<Task>>(`/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
  if (!result.success || !result.data) throw new Error(result.error ?? 'Failed to update task')
  return result.data
}

// ── Delete task ───────────────────────────────────────────────────────────────
export async function deleteTask(taskId: string): Promise<void> {
  await apiFetch(`/tasks/${taskId}`, { method: 'DELETE' })
}

// ── Add activity log entry ────────────────────────────────────────────────────
export async function addActivityEntry(taskId: string, entry: Pick<ActivityEntry, 'text' | 'staffId' | 'staffName'>): Promise<ActivityEntry> {
  const result = await apiFetch<ApiResponse<ActivityEntry>>(`/tasks/${taskId}/activity`, {
    method: 'POST',
    body: JSON.stringify(entry),
  })
  if (!result.success || !result.data) throw new Error(result.error ?? 'Failed to add note')
  return result.data
}
