import { ORPCError, os } from '@orpc/server'

import { authenticateApiKey } from '#/lib/api-keys'
import { auth } from '#/lib/auth'

export interface ORPCContext {
  request: Request
}

export const orpc = os.$context<ORPCContext>()

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>

type ProtectedORPCContext = ORPCContext & {
  apiKeyId: string | null
  authType: 'apiKey' | 'session'
  session: AuthSession | null
  userId: string
}

export const protectedOrpc = orpc.use(async ({ context, next }) => {
  const apiKey = extractApiKey(context.request)

  if (apiKey) {
    const authenticatedApiKey = await authenticateApiKey(apiKey)

    if (!authenticatedApiKey) {
      throw new ORPCError('UNAUTHORIZED')
    }

    const nextContext: ProtectedORPCContext = {
      request: context.request,
      authType: 'apiKey',
      apiKeyId: authenticatedApiKey.id,
      session: null,
      userId: authenticatedApiKey.userId,
    }

    return next({
      context: nextContext,
    })
  }

  const session = await auth.api.getSession({
    headers: context.request.headers,
  })

  if (!session?.user) {
    throw new ORPCError('UNAUTHORIZED')
  }

  const nextContext: ProtectedORPCContext = {
    apiKeyId: null,
    authType: 'session',
    request: context.request,
    session,
    userId: session.user.id,
  }

  return next({
    context: nextContext,
  })
})

function extractApiKey(request: Request) {
  const authorization = request.headers.get('authorization')
  const bearerToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : authorization?.startsWith('bearer ')
      ? authorization.slice('bearer '.length).trim()
      : null

  return bearerToken || request.headers.get('x-api-key')?.trim() || null
}
