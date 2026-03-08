import { ORPCError } from '@orpc/server'

import {
  listMessagesInputSchema,
  listMessagesResultSchema,
  listThreadMessagesForUser,
  listThreadsByInboxForUser,
  listThreadsByInboxInputSchema,
  listThreadsByInboxResultSchema,
} from '#/lib/email/read'
import { protectedOrpc } from '#/orpc/context'

export const threadRouter = {
  listByInbox: protectedOrpc
    .route({
      method: 'GET',
      path: '/inboxes/{inboxId}/threads',
      summary: 'List inbox threads',
    })
    .input(listThreadsByInboxInputSchema)
    .output(listThreadsByInboxResultSchema)
    .handler(async ({ context, input }) => {
      const result = await listThreadsByInboxForUser(context.session.user.id, input)

      if (!result) {
        throw new ORPCError('NOT_FOUND', {
          message: 'Inbox not found.',
        })
      }

      return result
    }),

  listMessages: protectedOrpc
    .route({
      method: 'GET',
      path: '/threads/{threadId}/messages',
      summary: 'List thread messages',
    })
    .input(listMessagesInputSchema)
    .output(listMessagesResultSchema)
    .handler(async ({ context, input }) => {
      const result = await listThreadMessagesForUser(context.session.user.id, input)

      if (!result) {
        throw new ORPCError('NOT_FOUND', {
          message: 'Thread not found.',
        })
      }

      return result
    }),
}
