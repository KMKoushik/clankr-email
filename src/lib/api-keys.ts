import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { apiKeys } from '#/db/schema'
import { getDb } from '#/lib/runtime'

import { createApiKeyId } from './email/ids'

const API_KEY_KIND = 'ck'
const API_KEY_SECRET_BYTES = 24

export const apiKeyNameSchema = z.string().trim().min(1).max(64)

export const apiKeyMetadataSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  lastFour: z.string(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})

export type ApiKeyMetadata = z.infer<typeof apiKeyMetadataSchema>

export class ApiKeyValidationError extends Error {}

function buildApiKeyPrefix(id: string) {
  return `${API_KEY_KIND}.${id}`
}

function buildRawApiKey(id: string, secret: string) {
  return `${buildApiKeyPrefix(id)}.${secret}`
}

function createApiKeySecret() {
  const bytes = new Uint8Array(API_KEY_SECRET_BYTES)

  crypto.getRandomValues(bytes)

  return toBase64Url(bytes)
}

export async function createApiKeyForUser(params: {
  userId: string
  name: string
  expiresAt?: string | null
}) {
  const database = getDb()
  const name = validateApiKeyName(params.name)
  const expiresAt = parseOptionalExpiry(params.expiresAt)
  const id = createApiKeyId()
  const secret = createApiKeySecret()
  const rawApiKey = buildRawApiKey(id, secret)
  const keyPrefix = buildApiKeyPrefix(id)
  const lastFour = secret.slice(-4)
  const now = new Date()

  await database.insert(apiKeys).values({
    id,
    userId: params.userId,
    name,
    keyHash: await hashApiKey(rawApiKey),
    keyPrefix,
    lastFour,
    lastUsedAt: null,
    expiresAt,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  })

  const [storedApiKey] = await database
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .limit(1)

  if (!storedApiKey) {
    throw new Error('Failed to create API key.')
  }

  return {
    apiKey: rawApiKey,
    metadata: serializeApiKey(storedApiKey),
  }
}

export async function listApiKeysForUser(userId: string) {
  const database = getDb()
  const rows = await database
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(asc(apiKeys.createdAt), asc(apiKeys.id))

  return rows.map(serializeApiKey)
}

export async function revokeApiKeyForUser(userId: string, apiKeyId: string) {
  const database = getDb()
  const now = new Date()

  const [existingApiKey] = await database
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.id, apiKeyId)))
    .limit(1)

  if (!existingApiKey) {
    return null
  }

  if (!existingApiKey.revokedAt) {
    await database
      .update(apiKeys)
      .set({
        revokedAt: now,
        updatedAt: now,
      })
      .where(eq(apiKeys.id, apiKeyId))
  }

  const [revokedApiKey] = await database
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, apiKeyId))
    .limit(1)

  return revokedApiKey ? serializeApiKey(revokedApiKey) : null
}

export async function authenticateApiKey(rawApiKey: string) {
  const parsedApiKey = parseRawApiKey(rawApiKey)

  if (!parsedApiKey) {
    return null
  }

  const database = getDb()
  const [storedApiKey] = await database
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.id, parsedApiKey.id),
        isNull(apiKeys.revokedAt),
      ),
    )
    .limit(1)

  if (!storedApiKey) {
    return null
  }

  if (storedApiKey.expiresAt && storedApiKey.expiresAt <= new Date()) {
    return null
  }

  const hashedApiKey = await hashApiKey(rawApiKey)

  if (hashedApiKey !== storedApiKey.keyHash) {
    return null
  }

  const now = new Date()

  await database
    .update(apiKeys)
    .set({
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(eq(apiKeys.id, storedApiKey.id))

  return {
    id: storedApiKey.id,
    name: storedApiKey.name,
    userId: storedApiKey.userId,
  }
}

export function serializeApiKey(apiKey: typeof apiKeys.$inferSelect): ApiKeyMetadata {
  return {
    id: apiKey.id,
    userId: apiKey.userId,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    lastFour: apiKey.lastFour,
    lastUsedAt: apiKey.lastUsedAt?.toISOString() ?? null,
    expiresAt: apiKey.expiresAt?.toISOString() ?? null,
    revokedAt: apiKey.revokedAt?.toISOString() ?? null,
    createdAt: apiKey.createdAt.toISOString(),
    updatedAt: apiKey.updatedAt.toISOString(),
  }
}

function validateApiKeyName(name: string) {
  const parsed = apiKeyNameSchema.safeParse(name)

  if (parsed.success) {
    return parsed.data
  }

  throw new ApiKeyValidationError(parsed.error.issues[0]?.message ?? 'Invalid API key name.')
}

function parseOptionalExpiry(expiresAt: string | null | undefined) {
  if (!expiresAt) {
    return null
  }

  const parsedDate = new Date(expiresAt)

  if (Number.isNaN(parsedDate.valueOf())) {
    throw new ApiKeyValidationError('API key expiry must be a valid datetime.')
  }

  if (parsedDate <= new Date()) {
    throw new ApiKeyValidationError('API key expiry must be in the future.')
  }

  return parsedDate
}

function parseRawApiKey(rawApiKey: string) {
  const [kind, id, ...secretParts] = rawApiKey.trim().split('.')
  const secret = secretParts.join('.')

  if (kind !== API_KEY_KIND || !id || !secret) {
    return null
  }

  return {
    id,
    secret,
  }
}

async function hashApiKey(rawApiKey: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(rawApiKey),
  )

  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}
