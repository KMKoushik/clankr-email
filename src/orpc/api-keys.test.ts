import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  getWorkerEnv() {
    if (!testState.harness) {
      throw new Error('Email test harness not initialized.')
    }

    return testState.harness.env
  },
}))

vi.mock('#/lib/auth', () => ({
  auth: {
    api: {
      async getSession({ headers }: { headers: Headers }) {
        const userId = headers.get('x-test-user-id')

        if (!userId) {
          return null
        }

        return {
          session: {
            id: `session_${userId}`,
          },
          user: {
            id: userId,
          },
        }
      },
    },
  },
}))

import { router } from '#/orpc/router'

import { createEmailTestHarness, createInboxRecord, createUserRecord, type EmailTestHarness } from '#/lib/email/test-harness'

const openApiHandler = new OpenAPIHandler(router)

describe('oRPC api key auth', () => {
  let harness: EmailTestHarness

  beforeEach(() => {
    harness = createEmailTestHarness()
    testState.harness = harness
  })

  afterEach(() => {
    harness.cleanup()
    testState.harness = null
  })

  it('creates an api key and uses it to access protected inbox APIs', async () => {
    const userId = await createUserRecord(harness.db, {
      id: 'user_orpc_key_01',
    })
    const inboxId = await createInboxRecord(harness.db, userId, {
      id: 'in_orpc_key_01',
    })

    const createResponse = await sendOpenApiRequest(
      new Request('https://clankr.test/api/api-keys', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-user-id': userId,
        },
        body: JSON.stringify({
          name: 'Server key',
        }),
      }),
    )

    expect(createResponse.status).toBe(200)

    const createdKey = await createResponse.json() as {
      apiKey: string
      metadata: {
        id: string
      }
    }
    const inboxResponse = await sendOpenApiRequest(
      new Request('https://clankr.test/api/inboxes', {
        headers: {
          authorization: `Bearer ${createdKey.apiKey}`,
        },
      }),
    )

    expect(inboxResponse.status).toBe(200)
    await expect(inboxResponse.json()).resolves.toMatchObject([
      {
        id: inboxId,
        userId,
      },
    ])

    const revokeResponse = await sendOpenApiRequest(
      new Request(`https://clankr.test/api/api-keys/${createdKey.metadata.id}/revoke`, {
        method: 'POST',
        headers: {
          'x-test-user-id': userId,
        },
      }),
    )

    expect(revokeResponse.status).toBe(200)

    const unauthorizedResponse = await sendOpenApiRequest(
      new Request('https://clankr.test/api/inboxes', {
        headers: {
          authorization: `Bearer ${createdKey.apiKey}`,
        },
      }),
    )

    expect(unauthorizedResponse.status).toBe(401)
  })
})

async function sendOpenApiRequest(request: Request) {
  const { matched, response } = await openApiHandler.handle(request, {
    context: {
      request,
    },
    prefix: '/api',
  })

  if (!matched) {
    throw new Error(`No procedure matched ${request.method} ${request.url}`)
  }

  return response
}
