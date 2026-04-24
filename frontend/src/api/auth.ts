import { Amplify } from 'aws-amplify'
import { signIn, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth'

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: 'us-east-1_rUUpPPAqG',
      userPoolClientId: '3cja6d55tltoap89q3tr5unqgb',
      loginWith: { email: true },
      passwordFormat: {
        minLength: 12,
        requireNumbers: true,
        requireSpecialCharacters: true,
        requireUppercase: true,
        requireLowercase: true,
      },
    },
  },
})

export async function login(email: string, password: string) {
  try {
    return await signIn({ username: email, password })
  } catch (err) { throw err }
}

export async function logout() {
  try { await signOut() } catch (err) { throw err }
}

export async function getUser() {
  try { return await getCurrentUser() } catch { return null }
}

export async function getIdToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession()
    return session.tokens?.idToken?.toString() ?? null
  } catch { return null }
}
