import { Amplify } from 'aws-amplify'
import { signIn, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth'

// Configured from environment variables injected at build time by GitHub Actions
Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
      loginWith: {
        email: true,
      },
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
  return signIn({ username: email, password })
}

export async function logout() {
  return signOut()
}

export async function getUser() {
  try {
    return await getCurrentUser()
  } catch {
    return null
  }
}

export async function getIdToken(): Promise<string | null> {
  try {
    const session = await fetchAuthSession()
    return session.tokens?.idToken?.toString() ?? null
  } catch {
    return null
  }
}
