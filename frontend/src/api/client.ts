import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth'

const API_BASE = import.meta.env.VITE_API_URL as string

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const session = await fetchAuthSession()
  const token = session.tokens?.idToken?.toString()

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }

  return res.json()
}

// Get current user info from Cognito
export async function getCurrentUserInfo(): Promise<{ userId: string; email: string; name: string }> {
  const user = await getCurrentUser()
  const session = await fetchAuthSession()
  const idToken = session.tokens?.idToken?.payload

  return {
    userId: user.userId,
    email: (idToken?.email as string) ?? user.username,
    name: (idToken?.name as string) ?? (idToken?.email as string) ?? user.username,
  }
}
