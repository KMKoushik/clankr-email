import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emailMessages, emailThreads } from '#/db/schema'

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

import {
  EmailReadOwnershipError,
  getMessageForUser,
  listThreadMessagesForUser,
  listThreadsByInboxForUser,
} from './read'
import { createEmailTestHarness, createInboxRecord, createUserRecord, type EmailTestHarness } from './test-harness'

describe('email read layer', () => {
  let harness: EmailTestHarness

  beforeEach(() => {
    harness = createEmailTestHarness()
    testState.harness = harness
  })

  afterEach(() => {
    harness.cleanup()
    testState.harness = null
  })

  it('lists inbox threads in last-message order with cursor pagination', async () => {
    const userId = await createUserRecord(harness.db, {
      id: 'user_threads_01',
    })
    const inboxId = await createInboxRecord(harness.db, userId, {
      id: 'in_threads_01',
    })

    await insertThreadWithMessage({
      createdAt: '2026-03-08T10:00:00.000Z',
      harness,
      inboxId,
      messageId: 'em_threads_01',
      snippet: 'First thread preview',
      subject: 'First thread',
      threadId: 'th_threads_01',
    })
    await insertThreadWithMessage({
      createdAt: '2026-03-08T11:00:00.000Z',
      harness,
      inboxId,
      messageId: 'em_threads_02',
      snippet: 'Second thread preview',
      subject: 'Second thread',
      threadId: 'th_threads_02',
    })
    await insertThreadWithMessage({
      createdAt: '2026-03-08T12:00:00.000Z',
      harness,
      inboxId,
      messageId: 'em_threads_03',
      snippet: 'Third thread preview',
      subject: 'Third thread',
      threadId: 'th_threads_03',
    })

    const firstPage = await listThreadsByInboxForUser({
      inboxId,
      limit: 2,
      userId,
    })

    expect(firstPage.threads.map((thread) => thread.id)).toEqual([
      'th_threads_03',
      'th_threads_02',
    ])
    expect(firstPage.threads[0]).toMatchObject({
      latestMessage: {
        id: 'em_threads_03',
        snippet: 'Third thread preview',
      },
      messageCount: 1,
      subject: 'Third thread',
    })
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondPage = await listThreadsByInboxForUser({
      cursor: firstPage.nextCursor ?? undefined,
      inboxId,
      limit: 2,
      userId,
    })

    expect(secondPage.threads.map((thread) => thread.id)).toEqual(['th_threads_01'])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('enforces inbox ownership when listing threads', async () => {
    const ownerUserId = await createUserRecord(harness.db, {
      id: 'user_owner_threads',
    })
    const otherUserId = await createUserRecord(harness.db, {
      id: 'user_other_threads',
    })
    const inboxId = await createInboxRecord(harness.db, ownerUserId, {
      id: 'in_owner_threads',
    })

    await expect(
      listThreadsByInboxForUser({
        inboxId,
        userId: otherUserId,
      }),
    ).rejects.toBeInstanceOf(EmailReadOwnershipError)
  })

  it('lists thread messages oldest-first with cursor pagination', async () => {
    const userId = await createUserRecord(harness.db, {
      id: 'user_messages_01',
    })
    const inboxId = await createInboxRecord(harness.db, userId, {
      id: 'in_messages_01',
    })

    await insertThreadRecord(harness, {
      createdAt: '2026-03-08T09:00:00.000Z',
      inboxId,
      lastMessageAt: '2026-03-08T12:00:00.000Z',
      threadId: 'th_messages_01',
    })
    await insertMessageRecord(harness, {
      createdAt: '2026-03-08T10:00:00.000Z',
      inboxId,
      messageId: 'em_messages_01',
      snippet: 'Message one',
      subject: 'Thread subject',
      threadId: 'th_messages_01',
    })
    await insertMessageRecord(harness, {
      createdAt: '2026-03-08T11:00:00.000Z',
      inboxId,
      messageId: 'em_messages_02',
      snippet: 'Message two',
      subject: 'Thread subject',
      threadId: 'th_messages_01',
    })
    await insertMessageRecord(harness, {
      createdAt: '2026-03-08T12:00:00.000Z',
      inboxId,
      messageId: 'em_messages_03',
      snippet: 'Message three',
      subject: 'Thread subject',
      threadId: 'th_messages_01',
    })

    const firstPage = await listThreadMessagesForUser({
      inboxId,
      limit: 2,
      threadId: 'th_messages_01',
      userId,
    })

    expect(firstPage.messages.map((message) => message.id)).toEqual([
      'em_messages_01',
      'em_messages_02',
    ])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondPage = await listThreadMessagesForUser({
      cursor: firstPage.nextCursor ?? undefined,
      inboxId,
      limit: 2,
      threadId: 'th_messages_01',
      userId,
    })

    expect(secondPage.messages.map((message) => message.id)).toEqual(['em_messages_03'])
    expect(secondPage.nextCursor).toBeNull()
  })

  it('returns inline message bodies from D1', async () => {
    const userId = await createUserRecord(harness.db, {
      id: 'user_inline_01',
    })
    const inboxId = await createInboxRecord(harness.db, userId, {
      id: 'in_inline_01',
    })

    await insertThreadRecord(harness, {
      createdAt: '2026-03-08T10:00:00.000Z',
      inboxId,
      lastMessageAt: '2026-03-08T10:00:00.000Z',
      threadId: 'th_inline_01',
    })
    await insertMessageRecord(harness, {
      createdAt: '2026-03-08T10:00:00.000Z',
      htmlBody: '<p>Hello inline</p>',
      inboxId,
      messageId: 'em_inline_01',
      subject: 'Inline body',
      textBody: 'Hello inline',
      threadId: 'th_inline_01',
      toEmails: ['reader@example.com'],
    })

    const message = await getMessageForUser({
      messageId: 'em_inline_01',
      userId,
    })

    expect(message).toMatchObject({
      bodySource: 'inline',
      htmlBody: '<p>Hello inline</p>',
      textBody: 'Hello inline',
      toEmails: ['reader@example.com'],
    })
  })

  it('falls back to R2 for oversized message bodies', async () => {
    const userId = await createUserRecord(harness.db, {
      id: 'user_r2_01',
    })
    const inboxId = await createInboxRecord(harness.db, userId, {
      id: 'in_r2_01',
    })

    await insertThreadRecord(harness, {
      createdAt: '2026-03-08T10:00:00.000Z',
      inboxId,
      lastMessageAt: '2026-03-08T10:00:00.000Z',
      threadId: 'th_r2_01',
    })
    await harness.storage.put(
      'bodies/em_r2_01.json',
      JSON.stringify({
        htmlBody: '<p>Stored in R2</p>',
        textBody: 'Stored in R2',
      }),
    )
    await insertMessageRecord(harness, {
      bodyStorageMode: 'oversized',
      createdAt: '2026-03-08T10:00:00.000Z',
      htmlBody: null,
      inboxId,
      messageId: 'em_r2_01',
      oversizedBodyR2Key: 'bodies/em_r2_01.json',
      subject: 'Oversized body',
      textBody: null,
      threadId: 'th_r2_01',
    })

    const message = await getMessageForUser({
      messageId: 'em_r2_01',
      userId,
    })

    expect(message).toMatchObject({
      bodySource: 'r2',
      htmlBody: '<p>Stored in R2</p>',
      textBody: 'Stored in R2',
    })
  })
})

async function insertThreadWithMessage(params: {
  createdAt: string
  harness: EmailTestHarness
  inboxId: string
  messageId: string
  snippet: string
  subject: string
  threadId: string
}) {
  await insertThreadRecord(params.harness, {
    createdAt: params.createdAt,
    inboxId: params.inboxId,
    lastMessageAt: params.createdAt,
    threadId: params.threadId,
  })
  await insertMessageRecord(params.harness, {
    createdAt: params.createdAt,
    inboxId: params.inboxId,
    messageId: params.messageId,
    snippet: params.snippet,
    subject: params.subject,
    threadId: params.threadId,
  })
}

async function insertThreadRecord(
  harness: EmailTestHarness,
  params: {
    createdAt: string
    inboxId: string
    lastMessageAt: string
    threadId: string
  },
) {
  const createdAt = new Date(params.createdAt)

  await harness.db.insert(emailThreads).values({
    id: params.threadId,
    inboxId: params.inboxId,
    subjectNormalized: 'thread-subject',
    participantHash: `participants-${params.threadId}`,
    lastMessageAt: new Date(params.lastMessageAt),
    createdAt,
    updatedAt: createdAt,
  })
}

async function insertMessageRecord(
  harness: EmailTestHarness,
  params: {
    bodyStorageMode?: 'inline' | 'oversized'
    createdAt: string
    htmlBody?: string | null
    inboxId: string
    messageId: string
    oversizedBodyR2Key?: string | null
    snippet?: string
    subject: string
    textBody?: string | null
    threadId: string
    toEmails?: string[]
  },
) {
  const createdAt = new Date(params.createdAt)

  await harness.db.insert(emailMessages).values({
    id: params.messageId,
    inboxId: params.inboxId,
    threadId: params.threadId,
    direction: 'inbound',
    providerMessageId: null,
    internetMessageId: `<${params.messageId}@example.com>`,
    fromEmail: 'sender@example.com',
    toEmailsJson: JSON.stringify(params.toEmails ?? ['agent@clankr.email']),
    ccEmailsJson: '[]',
    bccEmailsJson: '[]',
    subject: params.subject,
    snippet: params.snippet ?? params.subject,
    textBody: params.textBody ?? 'Hello world',
    htmlBody: params.htmlBody ?? null,
    bodyStorageMode: params.bodyStorageMode ?? 'inline',
    rawMimeR2Key: null,
    oversizedBodyR2Key: params.oversizedBodyR2Key ?? null,
    bodySizeBytes: 128,
    status: 'received',
    errorCode: null,
    errorMessage: null,
    sentAt: null,
    receivedAt: createdAt,
    createdAt,
  })
}
