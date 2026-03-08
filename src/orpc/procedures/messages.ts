import { ORPCError } from '@orpc/server'
import {
  sendMessage,
  sendMessageInputSchema,
  sendMessageResultSchema,
  sendSignedInUserTestEmail,
  sendTestEmailInputSchema,
  sendTestEmailResultSchema,
  SendMessageOwnershipError,
  SendMessageThreadNotFoundError,
  SendMessageValidationError,
} from '#/lib/email/outbound'
import {
  getMessageForUser as getMessageForUserRead,
  getMessageInputSchema as getMessageReadInputSchema,
  messageDetailSchema as messageReadDetailSchema,
} from '#/lib/email/read'
import { protectedOrpc } from '#/orpc/context'

export const messageRouter = {
  get: protectedOrpc
    .route({
      method: 'GET',
      path: '/messages/{messageId}',
      summary: 'Get message',
    })
    .input(getMessageReadInputSchema)
    .output(messageReadDetailSchema)
    .handler(async ({ context, input }) => {
      const message = await getMessageForUserRead(context.session.user.id, input.messageId)

      if (!message) {
        throw new ORPCError('NOT_FOUND', {
          message: 'Message not found.',
        })
      }

      return message
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

  sendTest: protectedOrpc
    .route({
      method: 'POST',
      path: '/messages/send-test',
      summary: 'Send dashboard test email',
    })
    .input(sendTestEmailInputSchema)
    .output(sendTestEmailResultSchema)
    .handler(async ({ context, input }) => {
      return sendSignedInUserTestEmail({
        headerMode: input.headerMode,
        inboxId: input.inboxId,
        userId: context.session.user.id,
        toEmail: context.session.user.email,
      })
    }),
}
