import { useState } from 'react'
import { login } from '../api/auth'

interface Props {
  onSuccess: () => void
}

export default function LoginPage({ onSuccess }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: 8,
    border: '1px solid #E5E7EB', fontSize: 14, outline: 'none',
    fontFamily: 'inherit', color: '#111827', background: '#F9FAFB',
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 400, boxShadow: '0 4px 24px rgba(0,0,0,0.06)', border: '1px solid #E5E7EB' }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#6366F1,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 800 }}>✚</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: '#111827', letterSpacing: '-0.02em' }}>OfficeTasks</div>
            <div style={{ fontSize: 12, color: '#9CA3AF' }}>Medical office task tracker</div>
          </div>
        </div>

        <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 6 }}>Sign in</div>
        <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 28 }}>Use your staff email and password</div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6, letterSpacing: '0.04em' }}>EMAIL</label>
            <input
              type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@yourpractice.com"
              style={inp}
              onFocus={e => e.target.style.borderColor = '#6366F1'}
              onBlur={e => e.target.style.borderColor = '#E5E7EB'}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6, letterSpacing: '0.04em' }}>PASSWORD</label>
            <input
              type="password" required value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••••••"
              style={inp}
              onFocus={e => e.target.style.borderColor = '#6366F1'}
              onBlur={e => e.target.style.borderColor = '#E5E7EB'}
            />
          </div>

          {error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#DC2626' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} style={{
            marginTop: 8, padding: '11px', borderRadius: 8, border: 'none',
            background: loading ? '#A5B4FC' : 'linear-gradient(135deg,#6366F1,#8B5CF6)',
            color: '#fff', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'opacity 0.15s',
          }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div style={{ marginTop: 24, padding: '14px', background: '#F9FAFB', borderRadius: 8, fontSize: 12, color: '#6B7280', textAlign: 'center' }}>
          Access is restricted to authorized staff.<br />Contact your administrator to create an account.
        </div>
      </div>
    </div>
  )
}
