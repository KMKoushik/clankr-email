import { createFileRoute } from '@tanstack/react-router'

import { deleteWebhookSubscription } from '#/lib/email'
import { badRequest, json, unauthorized } from '#/lib/http'
import { getAuthSession } from '#/lib/session'

export const Route = createFileRoute('/api/webhooks/subscriptions/$subscriptionId')({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        const session = await getAuthSession(request)
        if (!session) {
          return unauthorized()
        }

        try {
          await deleteWebhookSubscription(session.user.id, params.subscriptionId)
          return json({ ok: true })
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to delete webhook subscription'
          return badRequest(message)
        }
      },
    },
  },
})
