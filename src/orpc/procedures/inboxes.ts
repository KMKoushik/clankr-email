import { ORPCError } from '@orpc/server'
import { z } from 'zod'

import { db } from '#/db/client'
import {
  InboxAliasConflictError,
  InboxAliasValidationError,
  createInboxForUser,
  getInboxForUser,
  listInboxesForUser,
  serializeInbox,
  updateInboxAliasForUser,
} from '#/lib/email/inboxes'
import { protectedOrpc } from '#/orpc/context'

const inboxSchema = z.object({
  id: z.string(),
  userId: z.string(),
  defaultLocalPart: z.string(),
  customLocalPart: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export const inboxRouter = {
  create: protectedOrpc
    .route({
      method: 'POST',
      path: '/inboxes',
      summary: 'Create inbox',
    })
    .input(z.object({}).optional())
    .output(inboxSchema)
    .handler(async ({ context }) => {
      const inbox = await createInboxForUser(db, context.session.user.id)

      return serializeInbox(inbox)
    }),

  get: protectedOrpc
    .route({
      method: 'GET',
      path: '/inboxes/{inboxId}',
      summary: 'Get inbox',
    })
    .input(
      z.object({
        inboxId: z.string().min(1),
      }),
    )
    .output(inboxSchema)
    .handler(async ({ context, input }) => {
      const inbox = await getInboxForUser(db, context.session.user.id, input.inboxId)

      if (!inbox) {
        throw new ORPCError('NOT_FOUND', {
          message: 'Inbox not found.',
        })
      }

      return serializeInbox(inbox)
    }),

  list: protectedOrpc
    .route({
      method: 'GET',
      path: '/inboxes',
      summary: 'List inboxes',
    })
    .output(z.array(inboxSchema))
    .handler(async ({ context }) => {
      const inboxes = await listInboxesForUser(db, context.session.user.id)

      return inboxes.map(serializeInbox)
    }),

  updateAlias: protectedOrpc
    .route({
      method: 'PATCH',
      path: '/inboxes/{inboxId}/alias',
      summary: 'Update inbox alias',
    })
    .input(
      z.object({
        inboxId: z.string().min(1),
        alias: z.string().trim().min(1).max(32).nullable(),
      }),
    )
    .output(inboxSchema)
    .handler(async ({ context, input }) => {
      try {
        const inbox = await updateInboxAliasForUser(
          db,
          context.session.user.id,
          input.inboxId,
          input.alias,
        )

        if (!inbox) {
          throw new ORPCError('NOT_FOUND', {
            message: 'Inbox not found.',
          })
        }

        return serializeInbox(inbox)
      } catch (error) {
        if (error instanceof InboxAliasValidationError) {
          throw new ORPCError('BAD_REQUEST', {
            message: error.message,
          })
        }

        if (error instanceof InboxAliasConflictError) {
          throw new ORPCError('CONFLICT', {
            message: error.message,
          })
        }

        throw error
      }
    }),
}
