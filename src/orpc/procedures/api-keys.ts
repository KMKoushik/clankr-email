import { ORPCError } from '@orpc/server'
import { z } from 'zod'

import {
  apiKeyMetadataSchema,
  ApiKeyValidationError,
  createApiKeyForUser,
  listApiKeysForUser,
  revokeApiKeyForUser,
} from '#/lib/api-keys'
import { protectedOrpc } from '#/orpc/context'

const apiKeyCreateInputSchema = z.object({
  expiresAt: z.string().datetime().nullable().optional(),
  name: z.string().trim().min(1).max(64),
})

const apiKeyCreateResultSchema = z.object({
  apiKey: z.string(),
  metadata: apiKeyMetadataSchema,
})

export const apiKeyRouter = {
  create: protectedOrpc
    .route({
      method: 'POST',
      path: '/api-keys',
      summary: 'Create API key',
    })
    .input(apiKeyCreateInputSchema)
    .output(apiKeyCreateResultSchema)
    .handler(async ({ context, input }) => {
      try {
        return await createApiKeyForUser({
          userId: context.userId,
          ...input,
        })
      } catch (error) {
        if (error instanceof ApiKeyValidationError) {
          throw new ORPCError('BAD_REQUEST', {
            message: error.message,
          })
        }

        throw error
      }
    }),

  list: protectedOrpc
    .route({
      method: 'GET',
      path: '/api-keys',
      summary: 'List API keys',
    })
    .output(z.array(apiKeyMetadataSchema))
    .handler(({ context }) => listApiKeysForUser(context.userId)),

  revoke: protectedOrpc
    .route({
      method: 'POST',
      path: '/api-keys/{apiKeyId}/revoke',
      summary: 'Revoke API key',
    })
    .input(z.object({
      apiKeyId: z.string().trim().min(1),
    }))
    .output(apiKeyMetadataSchema)
    .handler(async ({ context, input }) => {
      const apiKey = await revokeApiKeyForUser(context.userId, input.apiKeyId)

      if (!apiKey) {
        throw new ORPCError('NOT_FOUND', {
          message: 'API key not found.',
        })
      }

      return apiKey
    }),
}
