import { ORPCError } from '@orpc/server'
import {
  sendMessage,
  sendMessageInputSchema,
  sendMessageResultSchema,
  SendMessageOwnershipError,
  SendMessageThreadNotFoundError,
  SendMessageValidationError,
} from '#/lib/email/outbound'
import { protectedOrpc } from '#/orpc/context'

export const messageRouter = {
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
          userId: context.session.user.id,
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
