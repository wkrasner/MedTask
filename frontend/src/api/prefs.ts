import { apiFetch } from './client'
import { NotificationPref, ApiResponse } from '../../../backend/shared/types'

export async function getAllPrefs(): Promise<NotificationPref[]> {
  const result = await apiFetch<ApiResponse<NotificationPref[]>>('/prefs')
  return result.data ?? []
}

export async function getUserPrefs(userId: string): Promise<NotificationPref | null> {
  const result = await apiFetch<ApiResponse<NotificationPref>>(`/prefs/${userId}`)
  return result.data ?? null
}

export async function saveUserPrefs(userId: string, prefs: Partial<NotificationPref>): Promise<NotificationPref> {
  const result = await apiFetch<ApiResponse<NotificationPref>>(`/prefs/${userId}`, {
    method: 'PUT',
    body: JSON.stringify(prefs),
  })
  if (!result.success || !result.data) throw new Error(result.error ?? 'Failed to save preferences')
  return result.data
}
