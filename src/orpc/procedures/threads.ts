import { ORPCError } from '@orpc/server'

import {
  EmailReadOwnershipError,
  EmailReadValidationError,
  EmailThreadNotFoundError,
  listThreadMessagesForUser,
  listThreadsByInboxForUser,
  threadListInputSchema,
  threadListResultSchema,
  threadMessageListInputSchema,
  threadMessageListResultSchema,
} from '#/lib/email/read'
import { protectedOrpc } from '#/orpc/context'

export const threadRouter = {
  listByInbox: protectedOrpc
    .route({
      method: 'GET',
      path: '/inboxes/{inboxId}/threads',
      summary: 'List inbox threads',
    })
    .input(threadListInputSchema)
    .output(threadListResultSchema)
    .handler(async ({ context, input }) => {
      try {
        return await listThreadsByInboxForUser({
          userId: context.userId,
          ...input,
        })
      } catch (error) {
        if (error instanceof EmailReadValidationError) {
          throw new ORPCError('BAD_REQUEST', {
            message: error.message,
          })
        }

        if (error instanceof EmailReadOwnershipError) {
          throw new ORPCError('NOT_FOUND', {
            message: error.message,
          })
        }

        throw error
      }
    }),

  listMessages: protectedOrpc
    .route({
      method: 'GET',
      path: '/threads/{threadId}/messages',
      summary: 'List thread messages',
    })
    .input(threadMessageListInputSchema.omit({ threadId: true }).extend({
      threadId: threadMessageListInputSchema.shape.threadId,
    }))
    .output(threadMessageListResultSchema)
    .handler(async ({ context, input }) => {
      try {
        return await listThreadMessagesForUser({
          userId: context.userId,
          ...input,
        })
      } catch (error) {
        if (error instanceof EmailReadValidationError) {
          throw new ORPCError('BAD_REQUEST', {
            message: error.message,
          })
        }

        if (error instanceof EmailThreadNotFoundError || error instanceof EmailReadOwnershipError) {
          throw new ORPCError('NOT_FOUND', {
            message: error.message,
          })
        }

        throw error
      }
    }),
}
