import { desc } from 'drizzle-orm'
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

import { handleInboundEmail, INLINE_BODY_LIMIT_BYTES } from './inbound'
import { createInboundWorkerMessage, createMimeFixture } from './test-fixtures'
import { createEmailTestHarness, createInboxRecord, createUserRecord, type EmailTestHarness } from './test-harness'

describe('inbound email pipeline', () => {
  let harness: EmailTestHarness

  beforeEach(() => {
    harness = createEmailTestHarness()
    testState.harness = harness
  })

  afterEach(() => {
    harness.cleanup()
    testState.harness = null
  })

  it('rejects unknown inboxes', async () => {
    const { message, getRejectedReason } = createInboundWorkerMessage({
      raw: createMimeFixture(),
      to: 'missing@clankr.email',
    })

    const result = await handleInboundEmail(message)

    expect(result).toEqual({
      status: 'rejected',
      reason: 'unknown-inbox',
    })
    expect(getRejectedReason()).toBe('Unknown inbox')
  })

  it('stores inbound email metadata, raw MIME, and a queue event', async () => {
    const userId = await createUserRecord(harness.db)
    const inboxId = await createInboxRecord(harness.db, userId, {
      customLocalPart: 'agent',
    })
    const rawMime = createMimeFixture({
      htmlBody: '<p>Hello <strong>world</strong></p>',
      messageId: '<store-1@example.com>',
      subject: 'Store me',
      textBody: 'Hello world',
      to: 'Agent <agent@clankr.email>',
    })
    const { message } = createInboundWorkerMessage({
      raw: rawMime,
      to: 'agent@clankr.email',
    })

    const result = await handleInboundEmail(message)
    const [storedMessage] = await harness.db.select().from(emailMessages)

    expect(result.status).toBe('accepted')
    expect(result).toMatchObject({ inboxId })
    expect(storedMessage?.subject).toBe('Store me')
    expect(storedMessage?.textBody?.trim()).toBe('Hello world')
    expect(storedMessage?.htmlBody).toContain('<strong>world</strong>')
    expect(storedMessage?.bodyStorageMode).toBe('inline')
    expect(await (await harness.storage.get(storedMessage!.rawMimeR2Key!))?.text()).toBe(rawMime)
    expect(harness.queue.sent).toHaveLength(1)
    expect(harness.queue.sent[0]?.body).toMatchObject({
      type: 'message.received',
      data: {
        inboxId,
        messageId: storedMessage?.id,
        threadId: storedMessage?.threadId,
      },
    })
  })

  it('threads replies by in-reply-to even when fallback participants differ', async () => {
    const userId = await createUserRecord(harness.db)
    await createInboxRecord(harness.db, userId, {
      customLocalPart: 'agent',
    })

    const firstMessage = createInboundWorkerMessage({
      raw: createMimeFixture({
        from: 'Sender <sender@example.com>',
        messageId: '<thread-root@example.com>',
        subject: 'Original thread',
        to: 'Agent <agent@clankr.email>',
      }),
      to: 'agent@clankr.email',
    })
    const secondMessage = createInboundWorkerMessage({
      raw: createMimeFixture({
        from: 'Different Sender <different@example.com>',
        inReplyTo: '<thread-root@example.com>',
        messageId: '<thread-reply@example.com>',
        references: ['<thread-root@example.com>'],
        subject: 'Re: Original thread',
        to: 'Agent <agent@clankr.email>',
      }),
      to: 'agent@clankr.email',
    })

    const firstResult = await handleInboundEmail(firstMessage.message)
    const secondResult = await handleInboundEmail(secondMessage.message)

    expect(firstResult.status).toBe('accepted')
    if (firstResult.status !== 'accepted') {
      throw new Error('Expected the first inbound message to be accepted')
    }
    expect(secondResult).toMatchObject({
      status: 'accepted',
      threadId: firstResult.threadId,
    })
  })

  it('falls back to normalized subject and participant hash threading', async () => {
    const userId = await createUserRecord(harness.db)
    await createInboxRecord(harness.db, userId, {
      customLocalPart: 'agent',
    })

    await handleInboundEmail(
      createInboundWorkerMessage({
        raw: createMimeFixture({
          messageId: '<fallback-1@example.com>',
          subject: 'Project Update',
          to: 'Agent <agent@clankr.email>',
        }).trim(),
        to: 'agent@clankr.email',
      }).message,
    )

    const secondResult = await handleInboundEmail(
      createInboundWorkerMessage({
        raw: createMimeFixture({
          messageId: '<fallback-2@example.com>',
          subject: 'Re: Project Update',
          to: 'Agent <agent@clankr.email>',
        }).trim(),
        to: 'agent@clankr.email',
      }).message,
    )

    const threads = await harness.db.select().from(emailThreads).orderBy(desc(emailThreads.createdAt))

    expect(secondResult.status).toBe('accepted')
    expect(threads).toHaveLength(1)
  })

  it('deduplicates inbound messages by internet message id', async () => {
    const userId = await createUserRecord(harness.db)
    await createInboxRecord(harness.db, userId, {
      customLocalPart: 'agent',
    })

    const rawMime = createMimeFixture({
      messageId: '<duplicate@example.com>',
      to: 'Agent <agent@clankr.email>',
    })

    const firstResult = await handleInboundEmail(
      createInboundWorkerMessage({
        raw: rawMime,
        to: 'agent@clankr.email',
      }).message,
    )
    const secondResult = await handleInboundEmail(
      createInboundWorkerMessage({
        raw: rawMime,
        to: 'agent@clankr.email',
      }).message,
    )
    const messages = await harness.db.select().from(emailMessages)

    expect(firstResult.status).toBe('accepted')
    if (firstResult.status !== 'accepted') {
      throw new Error('Expected the first inbound message to be accepted')
    }
    expect(secondResult).toEqual({
      status: 'duplicate',
      inboxId: firstResult.inboxId,
      messageId: firstResult.messageId,
      threadId: firstResult.threadId,
    })
    expect(messages).toHaveLength(1)
  })

  it('spills oversized bodies to R2', async () => {
    const userId = await createUserRecord(harness.db)
    await createInboxRecord(harness.db, userId, {
      customLocalPart: 'agent',
    })

    const oversizedText = 'a'.repeat(INLINE_BODY_LIMIT_BYTES + 128)

    await handleInboundEmail(
      createInboundWorkerMessage({
        raw: createMimeFixture({
          messageId: '<oversized@example.com>',
          textBody: oversizedText,
          to: 'Agent <agent@clankr.email>',
        }),
        to: 'agent@clankr.email',
      }).message,
    )

    const [storedMessage] = await harness.db.select().from(emailMessages)

    expect(storedMessage?.bodyStorageMode).toBe('oversized')
    expect(storedMessage?.textBody).toBeNull()
    expect(storedMessage?.oversizedBodyR2Key).toBeTruthy()
    expect(await (await harness.storage.get(storedMessage!.oversizedBodyR2Key!))?.text()).toContain(oversizedText)
  })
})
