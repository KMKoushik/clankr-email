import { auth } from '#/lib/auth'

interface AuthSession {
  user: {
    id: string
    email: string
    name: string
  }
}

export async function getAuthSession(request: Request): Promise<AuthSession | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return null
  }

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
    },
  }
}
