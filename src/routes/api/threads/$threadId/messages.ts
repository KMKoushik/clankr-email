import { createFileRoute } from '@tanstack/react-router'

import { listMessagesForThread } from '#/lib/email'
import { badRequest, json, unauthorized } from '#/lib/http'
import { getAuthSession } from '#/lib/session'

export const Route = createFileRoute('/api/threads/$threadId/messages')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await getAuthSession(request)
        if (!session) {
          return unauthorized()
        }

        const url = new URL(request.url)
        const rawLimit = Number(url.searchParams.get('limit') ?? '100')
        if (!Number.isFinite(rawLimit)) {
          return badRequest('limit must be a valid number')
        }

        try {
          const messages = await listMessagesForThread(
            session.user.id,
            params.threadId,
            rawLimit,
          )
          return json({ messages })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to list messages'
          return badRequest(message)
        }
      },
    },
  },
})
