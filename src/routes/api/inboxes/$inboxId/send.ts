import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { sendEmailFromInbox } from '#/lib/email'
import { badRequest, json, unauthorized } from '#/lib/http'
import { getAuthSession } from '#/lib/session'

const sendEmailInput = z
  .object({
    to: z.string().email(),
    subject: z.string().min(1).max(998),
    text: z.string().min(1).optional(),
    html: z.string().min(1).optional(),
  })
  .refine((value) => Boolean(value.text || value.html), {
    message: 'Either text or html content is required',
    path: ['text'],
  })

export const Route = createFileRoute('/api/inboxes/$inboxId/send')({
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

        const parsed = sendEmailInput.safeParse(body)
        if (!parsed.success) {
          return badRequest('Invalid request body', parsed.error.flatten())
        }

        try {
          const result = await sendEmailFromInbox({
            userId: session.user.id,
            inboxId: params.inboxId,
            to: parsed.data.to,
            subject: parsed.data.subject,
            text: parsed.data.text,
            html: parsed.data.html,
          })

          return json({ result }, { status: 201 })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to send email'
          return badRequest(message)
        }
      },
    },
  },
})
