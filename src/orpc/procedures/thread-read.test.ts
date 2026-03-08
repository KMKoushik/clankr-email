import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emailMessages, emailThreads } from '#/db/schema'

const testState = vi.hoisted(() => ({
  harness: null as EmailTestHarness | null,
  userId: 'user_test_01',
}))

vi.mock('#/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: {
          id: testState.userId,
        },
      })),
    },
  },
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

import { router } from '#/orpc/router'

import { createMessageId, createThreadId } from '#/lib/email/ids'
import { createEmailTestHarness, createInboxRecord, createUserRecord, type EmailTestHarness } from '#/lib/email/test-harness'

const apiHandler = new OpenAPIHandler(router)

describe('thread and message read procedures', () => {
  let harness: EmailTestHarness

  beforeEach(() => {
    harness = createEmailTestHarness()
    testState.harness = harness
    testState.userId = 'user_test_01'
  })

  afterEach(() => {
    harness.cleanup()
    testState.harness = null
  })

  it('lists inbox threads in descending activity order with pagination', async () => {
    const userId = await createUserRecord(harness.db, {
      id: testState.userId,
    })
    const inboxId = await createInboxRecord(harness.db, userId, {
      customLocalPart: 'agent',
    })

    const olderThread = await insertThread(harness, {
      inboxId,
      lastMessageAt: new Date('2026-03-08T09:00:00.000Z'),
      messageSubject: 'Oldest thread',
      messageSnippet: 'oldest',
      messageCreatedAt: new Date('2026-03-08T09:00:00.000Z'),
    })
    const middleThread = await insertThread(harness, {
      inboxId,
      lastMessageAt: new Date('2026-03-08T10:00:00.000Z'),
      messageSubject: 'Middle thread',
      messageSnippet: 'middle',
      messageCreatedAt: new Date('2026-03-08T10:00:00.000Z'),
    })
    const newestThread = await insertThread(harness, {
      inboxId,
      lastMessageAt: new Date('2026-03-08T11:00:00.000Z'),
      messageSubject: 'Newest thread',
      messageSnippet: 'newest',
      messageCreatedAt: new Date('2026-03-08T11:00:00.000Z'),
    })

    await insertMessage(harness, {
      inboxId,
      threadId: newestThread.id,
      subject: 'Newest follow-up',
      snippet: 'second newest',
      createdAt: new Date('2026-03-08T11:05:00.000Z'),
    })

    const firstPage = await requestJson(`/api/inboxes/${inboxId}/threads?limit=2`)

    expect(firstPage.response.status).toBe(200)
    expect(firstPage.json).toMatchObject({
      items: [
        {
          id: newestThread.id,
          subject: 'Newest follow-up',
          snippet: 'second newest',
          messageCount: 2,
        },
        {
          id: middleThread.id,
          subject: 'Middle thread',
          snippet: 'middle',
          messageCount: 1,
        },
      ],
      nextCursor: {
        id: middleThread.id,
        lastMessageAt: '2026-03-08T10:00:00.000Z',
      },
    })

    const secondPage = await requestJson(
      `/api/inboxes/${inboxId}/threads?limit=2&cursorLastMessageAt=${encodeURIComponent(firstPage.json.nextCursor.lastMessageAt)}&cursorThreadId=${firstPage.json.nextCursor.id}`,
    )

    expect(secondPage.response.status).toBe(200)
    expect(secondPage.json).toMatchObject({
      items: [
        {
          id: olderThread.id,
          subject: 'Oldest thread',
          snippet: 'oldest',
          messageCount: 1,
        },
      ],
      nextCursor: null,
    })
  })

  it('lists thread messages in ascending created order with pagination', async () => {
    const userId = await createUserRecord(harness.db, {
      id: testState.userId,
    })
    const inboxId = await createInboxRecord(harness.db, userId)
    const threadId = createThreadId()

    await harness.db.insert(emailThreads).values({
      id: threadId,
      inboxId,
      subjectNormalized: 'hello thread',
      participantHash: 'participants',
      lastMessageAt: new Date('2026-03-08T11:00:00.000Z'),
      createdAt: new Date('2026-03-08T09:00:00.000Z'),
      updatedAt: new Date('2026-03-08T11:00:00.000Z'),
    })

    const firstMessage = await insertMessage(harness, {
      inboxId,
      threadId,
      subject: 'First',
      snippet: 'one',
      createdAt: new Date('2026-03-08T09:00:00.000Z'),
      direction: 'inbound',
      receivedAt: new Date('2026-03-08T09:00:00.000Z'),
      status: 'received',
    })
    const secondMessage = await insertMessage(harness, {
      inboxId,
      threadId,
      subject: 'Second',
      snippet: 'two',
      createdAt: new Date('2026-03-08T10:00:00.000Z'),
      direction: 'outbound',
      sentAt: new Date('2026-03-08T10:00:00.000Z'),
      status: 'accepted',
    })
    const thirdMessage = await insertMessage(harness, {
      inboxId,
      threadId,
      subject: 'Third',
      snippet: 'three',
      createdAt: new Date('2026-03-08T11:00:00.000Z'),
      direction: 'inbound',
      receivedAt: new Date('2026-03-08T11:00:00.000Z'),
      status: 'received',
    })

    const firstPage = await requestJson(`/api/threads/${threadId}/messages?limit=2`)

    expect(firstPage.response.status).toBe(200)
    expect(firstPage.json).toMatchObject({
      items: [
        {
          id: firstMessage.id,
          subject: 'First',
          snippet: 'one',
          direction: 'inbound',
        },
        {
          id: secondMessage.id,
          subject: 'Second',
          snippet: 'two',
          direction: 'outbound',
        },
      ],
      nextCursor: {
        id: secondMessage.id,
      },
    })

    const secondPage = await requestJson(
      `/api/threads/${threadId}/messages?limit=2&cursorMessageId=${firstPage.json.nextCursor.id}`,
    )

    expect(secondPage.response.status).toBe(200)
    expect(secondPage.json).toMatchObject({
      items: [
        {
          id: thirdMessage.id,
          subject: 'Third',
          snippet: 'three',
        },
      ],
      nextCursor: null,
    })
  })

  it('enforces ownership on thread and message reads', async () => {
    const ownerUserId = await createUserRecord(harness.db, {
      id: 'user_owner_01',
    })
    const otherUserId = await createUserRecord(harness.db, {
      id: testState.userId,
    })
    const ownerInboxId = await createInboxRecord(harness.db, ownerUserId)
    await createInboxRecord(harness.db, otherUserId)
    const ownerThread = await insertThread(harness, {
      inboxId: ownerInboxId,
      lastMessageAt: new Date('2026-03-08T09:00:00.000Z'),
      messageSubject: 'Owner thread',
      messageSnippet: 'hidden',
      messageCreatedAt: new Date('2026-03-08T09:00:00.000Z'),
    })

    expect((await requestJson(`/api/inboxes/${ownerInboxId}/threads`)).response.status).toBe(404)
    expect((await requestJson(`/api/threads/${ownerThread.id}/messages`)).response.status).toBe(404)
    expect((await requestJson(`/api/messages/${ownerThread.messageId}`)).response.status).toBe(404)
  })

  it('reads inline message bodies from D1', async () => {
    const userId = await createUserRecord(harness.db, {
      id: testState.userId,
    })
    const inboxId = await createInboxRecord(harness.db, userId)
    const thread = await insertThread(harness, {
      inboxId,
      lastMessageAt: new Date('2026-03-08T09:00:00.000Z'),
      messageSubject: 'Inline body',
      messageSnippet: 'body preview',
      messageCreatedAt: new Date('2026-03-08T09:00:00.000Z'),
      textBody: 'hello from d1',
      htmlBody: '<p>hello from d1</p>',
    })

    const result = await requestJson(`/api/messages/${thread.messageId}`)

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      id: thread.messageId,
      bodyFetchStrategy: 'inline',
      textBody: 'hello from d1',
      htmlBody: '<p>hello from d1</p>',
      bodyStorageMode: 'inline',
    })
  })

  it('falls back to R2 for oversized message bodies', async () => {
    const userId = await createUserRecord(harness.db, {
      id: testState.userId,
    })
    const inboxId = await createInboxRecord(harness.db, userId)
    const oversizedText = 'oversized body from r2'
    const oversizedHtml = '<p>oversized body from r2</p>'
    const thread = await insertThread(harness, {
      inboxId,
      lastMessageAt: new Date('2026-03-08T09:00:00.000Z'),
      messageSubject: 'Oversized body',
      messageSnippet: 'oversized preview',
      messageCreatedAt: new Date('2026-03-08T09:00:00.000Z'),
      bodyStorageMode: 'oversized',
      oversizedBodyR2Key: 'bodies/test-message.json',
      textBody: null,
      htmlBody: null,
    })

    await harness.storage.put(
      'bodies/test-message.json',
      JSON.stringify({
        textBody: oversizedText,
        htmlBody: oversizedHtml,
      }),
    )

    const result = await requestJson(`/api/messages/${thread.messageId}`)

    expect(result.response.status).toBe(200)
    expect(result.json).toMatchObject({
      id: thread.messageId,
      bodyFetchStrategy: 'r2',
      textBody: oversizedText,
      htmlBody: oversizedHtml,
      bodyStorageMode: 'oversized',
      oversizedBodyR2Key: 'bodies/test-message.json',
    })
  })
})

async function requestJson(path: string) {
  const request = new Request(`http://localhost${path}`)
  const result = await apiHandler.handle(request, {
    context: {
      request,
    },
    prefix: '/api',
  })

  if (!result.matched) {
    throw new Error(`Request did not match any route: ${path}`)
  }

  return {
    response: result.response,
    json: await result.response.json() as any,
  }
}

async function insertThread(
  harness: EmailTestHarness,
  params: {
    inboxId: string
    lastMessageAt: Date
    messageSubject: string
    messageSnippet: string
    messageCreatedAt: Date
    bodyStorageMode?: 'inline' | 'oversized'
    htmlBody?: string | null
    oversizedBodyR2Key?: string | null
    textBody?: string | null
  },
) {
  const threadId = createThreadId()

  await harness.db.insert(emailThreads).values({
    id: threadId,
    inboxId: params.inboxId,
    subjectNormalized: params.messageSubject.toLowerCase(),
    participantHash: `participants-${threadId}`,
    lastMessageAt: params.lastMessageAt,
    createdAt: params.messageCreatedAt,
    updatedAt: params.lastMessageAt,
  })

  const message = await insertMessage(harness, {
    inboxId: params.inboxId,
    threadId,
    subject: params.messageSubject,
    snippet: params.messageSnippet,
    createdAt: params.messageCreatedAt,
    bodyStorageMode: params.bodyStorageMode,
    htmlBody: params.htmlBody,
    oversizedBodyR2Key: params.oversizedBodyR2Key,
    textBody: params.textBody,
  })

  return {
    id: threadId,
    messageId: message.id,
  }
}

async function insertMessage(
  harness: EmailTestHarness,
  params: {
    inboxId: string
    threadId: string
    subject: string
    snippet: string
    createdAt: Date
    bodyStorageMode?: 'inline' | 'oversized'
    direction?: 'inbound' | 'outbound'
    htmlBody?: string | null
    oversizedBodyR2Key?: string | null
    receivedAt?: Date | null
    sentAt?: Date | null
    status?: 'accepted' | 'received' | 'failed' | 'pending' | 'rejected'
    textBody?: string | null
  },
) {
  const messageId = createMessageId()

  await harness.db.insert(emailMessages).values({
    id: messageId,
    inboxId: params.inboxId,
    threadId: params.threadId,
    direction: params.direction ?? 'inbound',
    providerMessageId: null,
    internetMessageId: `<${messageId}@clankr.email>`,
    fromEmail: 'sender@example.com',
    toEmailsJson: JSON.stringify(['agent@clankr.email']),
    ccEmailsJson: JSON.stringify([]),
    bccEmailsJson: JSON.stringify([]),
    subject: params.subject,
    snippet: params.snippet,
    textBody: params.textBody ?? 'inline text',
    htmlBody: params.htmlBody ?? null,
    bodyStorageMode: params.bodyStorageMode ?? 'inline',
    rawMimeR2Key: null,
    oversizedBodyR2Key: params.oversizedBodyR2Key ?? null,
    bodySizeBytes: 128,
    status: params.status ?? 'received',
    errorCode: null,
    errorMessage: null,
    sentAt: params.sentAt ?? null,
    receivedAt: params.receivedAt ?? params.createdAt,
    createdAt: params.createdAt,
  })

  return {
    id: messageId,
    createdAt: params.createdAt,
  }
}
