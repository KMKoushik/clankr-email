import { createFileRoute } from '@tanstack/react-router'

import { listThreadsForInbox } from '#/lib/email'
import { badRequest, json, unauthorized } from '#/lib/http'
import { getAuthSession } from '#/lib/session'

export const Route = createFileRoute('/api/inboxes/$inboxId/threads')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await getAuthSession(request)
        if (!session) {
          return unauthorized()
        }

        const url = new URL(request.url)
        const rawLimit = Number(url.searchParams.get('limit') ?? '50')
        if (!Number.isFinite(rawLimit)) {
          return badRequest('limit must be a valid number')
        }

        try {
          const threads = await listThreadsForInbox(
            session.user.id,
            params.inboxId,
            rawLimit,
          )
          return json({ threads })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to list threads'
          return badRequest(message)
        }
      },
    },
  },
})
