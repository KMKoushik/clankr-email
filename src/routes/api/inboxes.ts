import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { createInboxForUser, listInboxesForUser } from '#/lib/email'
import { badRequest, json, unauthorized } from '#/lib/http'
import { getAuthSession } from '#/lib/session'

const createInboxInput = z.object({
  customName: z.string().min(3).max(64).optional(),
})

export const Route = createFileRoute('/api/inboxes')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await getAuthSession(request)
        if (!session) {
          return unauthorized()
        }

        const inboxes = await listInboxesForUser(session.user.id)
        return json({ inboxes })
      },

      POST: async ({ request }) => {
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

        const parsed = createInboxInput.safeParse(body)
        if (!parsed.success) {
          return badRequest('Invalid request body', parsed.error.flatten())
        }

        try {
          const inbox = await createInboxForUser(session.user.id, parsed.data.customName)
          return json({ inbox }, { status: 201 })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to create inbox'
          return badRequest(message)
        }
      },
    },
  },
})
