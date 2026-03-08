import { ORPCError } from '@orpc/server'
import {
  sendMessage,
  sendMessageInputSchema,
  sendMessageResultSchema,
  SendMessageOwnershipError,
  SendMessageThreadNotFoundError,
  SendMessageValidationError,
} from '#/lib/email/outbound'
import {
  EmailMessageNotFoundError,
  EmailReadValidationError,
  getMessageForUser,
  messageDetailInputSchema,
  messageDetailSchema,
} from '#/lib/email/read'
import { protectedOrpc } from '#/orpc/context'

export const messageRouter = {
  get: protectedOrpc
    .route({
      method: 'GET',
      path: '/messages/{messageId}',
      summary: 'Get message detail',
    })
    .input(messageDetailInputSchema)
    .output(messageDetailSchema)
    .handler(async ({ context, input }) => {
      try {
        return await getMessageForUser({
          userId: context.userId,
          ...input,
        })
      } catch (error) {
        if (error instanceof EmailReadValidationError) {
          throw new ORPCError('BAD_REQUEST', {
            message: error.message,
          })
        }

        if (error instanceof EmailMessageNotFoundError) {
          throw new ORPCError('NOT_FOUND', {
            message: error.message,
          })
        }

        throw error
      }
    }),

  send: protectedOrpc
    .route({
      method: 'POST',
      path: '/messages/send',
      summary: 'Send message',
    })
    .input(sendMessageInputSchema)
    .output(sendMessageResultSchema)
    .handler(async ({ context, input }) => {
      try {
        return await sendMessage({
          userId: context.userId,
          input,
        })
      } catch (error) {
        if (error instanceof SendMessageValidationError) {
          throw new ORPCError('BAD_REQUEST', {
            message: error.message,
          })
        }

        if (error instanceof SendMessageOwnershipError || error instanceof SendMessageThreadNotFoundError) {
          throw new ORPCError('NOT_FOUND', {
            message: error.message,
          })
        }

        throw error
      }
    }),
}
