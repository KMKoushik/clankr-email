import { ORPCError, os } from '@orpc/server'

import { auth } from '#/lib/auth'

export interface ORPCContext {
  request: Request
}

export const orpc = os.$context<ORPCContext>()

export const protectedOrpc = orpc.use(async ({ context, next }) => {
  const session = await auth.api.getSession({
    headers: context.request.headers,
  })

  if (!session?.user) {
    throw new ORPCError('UNAUTHORIZED')
  }

  return next({
    context: {
      request: context.request,
      session,
    },
  })
})
