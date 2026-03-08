import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiKeys } from '#/db/schema'

const testState = vi.hoisted(() => ({
  harness: null as EmailTestHarness | null,
}))

vi.mock('#/lib/runtime', () => ({
  getDb() {
    if (!testState.harness) {
      throw new Error('Email test harness not initialized.')
    }

    return testState.harness.db
  },
}))

import {
  authenticateApiKey,
  createApiKeyForUser,
  listApiKeysForUser,
  revokeApiKeyForUser,
} from './api-keys'
import { createEmailTestHarness, createUserRecord, type EmailTestHarness } from './email/test-harness'

describe('api keys', () => {
  let harness: EmailTestHarness

  beforeEach(() => {
    harness = createEmailTestHarness()
    testState.harness = harness
  })

  afterEach(() => {
    harness.cleanup()
    testState.harness = null
  })

  it('creates and lists user api keys without exposing the stored hash', async () => {
    const userId = await createUserRecord(harness.db, {
      id: 'user_api_keys_01',
    })

    const created = await createApiKeyForUser({
      name: 'Server key',
      userId,
    })
    const storedKeys = await harness.db.select().from(apiKeys)
    const listedKeys = await listApiKeysForUser(userId)

    expect(created.apiKey).toMatch(/^ck\.ak_[a-z0-9]+\./)
    expect(storedKeys[0]?.keyHash).not.toBe(created.apiKey)
    expect(listedKeys).toMatchObject([
      {
        id: created.metadata.id,
        keyPrefix: created.metadata.keyPrefix,
        lastFour: created.metadata.lastFour,
        name: 'Server key',
        userId,
      },
    ])
  })

  it('authenticates valid api keys, updates last-used timestamps, and blocks revoked keys', async () => {
    const userId = await createUserRecord(harness.db, {
      id: 'user_api_keys_02',
    })

    const created = await createApiKeyForUser({
      name: 'Automation',
      userId,
    })

    const authenticated = await authenticateApiKey(created.apiKey)
    const [usedKey] = await harness.db
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.id, created.metadata.id))

    expect(authenticated).toMatchObject({
      id: created.metadata.id,
      userId,
    })
    expect(usedKey?.lastUsedAt).toBeInstanceOf(Date)

    await revokeApiKeyForUser(userId, created.metadata.id)

    await expect(authenticateApiKey(created.apiKey)).resolves.toBeNull()
  })
})
