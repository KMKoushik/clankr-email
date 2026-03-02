import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import {
  createWebhookSubscription,
  listWebhookSubscriptions,
  type EmailEventType,
} from '#/lib/email'
import { badRequest, json, unauthorized } from '#/lib/http'
import { getAuthSession } from '#/lib/session'

const allowedEvents: EmailEventType[] = [
  'message.received',
  'thread.updated',
  'message.sent',
  'message.failed',
  'message.bounced',
]

const createSubscriptionInput = z.object({
  url: z.string().url(),
  inboxId: z.string().min(1).optional(),
  events: z.array(z.enum(allowedEvents)).min(1).optional(),
})

export const Route = createFileRoute('/api/webhooks/subscriptions')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await getAuthSession(request)
        if (!session) {
          return unauthorized()
        }

        const subscriptions = await listWebhookSubscriptions(session.user.id)
        return json({ subscriptions })
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

        const parsed = createSubscriptionInput.safeParse(body)
        if (!parsed.success) {
          return badRequest('Invalid request body', parsed.error.flatten())
        }

        try {
          const subscription = await createWebhookSubscription({
            userId: session.user.id,
            targetUrl: parsed.data.url,
            inboxId: parsed.data.inboxId,
            events: parsed.data.events,
          })

          return json({ subscription }, { status: 201 })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to create webhook subscription'
          return badRequest(message)
        }
      },
    },
  },
})
