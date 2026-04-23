import { useState, useEffect } from 'react'
import { getUser, logout } from '../api/auth'

export interface AuthUser {
  username: string
  userId: string
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getUser().then(u => {
      setUser(u ? { username: u.username, userId: u.userId } : null)
      setLoading(false)
    })
  }, [])

  const handleLogout = async () => {
    await logout()
    setUser(null)
  }

  return { user, loading, logout: handleLogout, setUser }
}
