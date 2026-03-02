import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { claimAliasForInbox } from '#/lib/email'
import { badRequest, json, unauthorized } from '#/lib/http'
import { getAuthSession } from '#/lib/session'

const claimAliasInput = z.object({
  customName: z.string().min(3).max(64),
})

export const Route = createFileRoute('/api/inboxes/$inboxId/aliases')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const session = await getAuthSession(request)
        if (!session) {
          return unauthorized()
        }

        let body: unknown
        try {
          body = await request.json()
        } catch {
          return badRequest('Invalid JSON body')
        }

        const parsed = claimAliasInput.safeParse(body)
        if (!parsed.success) {
          return badRequest('Invalid request body', parsed.error.flatten())
        }

        try {
          const alias = await claimAliasForInbox(
            session.user.id,
            params.inboxId,
            parsed.data.customName,
          )

          return json({ alias }, { status: 201 })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to claim alias'
          return badRequest(message)
        }
      },
    },
  },
})
