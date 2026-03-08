import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { emailMessages, emailThreads } from '#/db/schema'

import {
  MAX_OUTBOUND_BODY_BYTES,
  sendMessage,
  SendMessageOwnershipError,
  SendMessageValidationError,
} from './outbound'
import { createEmailTestHarness, createInboxRecord, createUserRecord, type EmailTestHarness } from './test-harness'

describe('outbound email pipeline', () => {
  let harness: EmailTestHarness

  beforeEach(() => {
    harness = createEmailTestHarness()
  })

  afterEach(() => {
    harness.cleanup()
  })

  it('sends an outbound message, persists it, and emits an accepted event', async () => {
    const userId = await createUserRecord(harness.db)
    const inboxId = await createInboxRecord(harness.db, userId, {
      customLocalPart: 'agent',
    })

    const result = await sendMessage(harness.db, harness.env, {
      userId,
      input: {
        inboxId,
        to: ['Customer@Example.com'],
        subject: 'Project update',
        text: 'Hello from Clankr',
      },
    })
    const [storedMessage] = await harness.db.select().from(emailMessages)
    const [storedThread] = await harness.db.select().from(emailThreads)

    expect(result).toMatchObject({
      inboxId,
      providerMessageId: 'test-email-1',
      status: 'accepted',
      errorCode: null,
      errorMessage: null,
    })
    expect(harness.email.sent).toHaveLength(1)
    expect(harness.email.sent[0]).toMatchObject({
      from: 'agent@clankr.email',
      to: ['customer@example.com'],
      subject: 'Project update',
      text: 'Hello from Clankr',
      headers: {
        'Message-ID': storedMessage?.internetMessageId,
      },
    })
    expect(storedMessage).toMatchObject({
      id: result.id,
      inboxId,
      threadId: result.threadId,
      direction: 'outbound',
      providerMessageId: 'test-email-1',
      fromEmail: 'agent@clankr.email',
      subject: 'Project update',
      textBody: 'Hello from Clankr',
      status: 'accepted',
    })
    expect(storedThread?.id).toBe(result.threadId)
    expect(harness.queue.sent[0]?.body).toMatchObject({
      type: 'message.sent.accepted',
      data: {
        inboxId,
        threadId: result.threadId,
        messageId: result.id,
        providerMessageId: 'test-email-1',
      },
    })
  })

  it('rejects sends from inboxes the user does not own', async () => {
    const ownerUserId = await createUserRecord(harness.db, {
      id: 'user_owner_01',
    })
    const otherUserId = await createUserRecord(harness.db, {
      id: 'user_other_01',
    })
    const inboxId = await createInboxRecord(harness.db, ownerUserId)

    await expect(
      sendMessage(harness.db, harness.env, {
        userId: otherUserId,
        input: {
          inboxId,
          to: ['customer@example.com'],
          subject: 'Unauthorized send',
          text: 'This should fail',
        },
      }),
    ).rejects.toBeInstanceOf(SendMessageOwnershipError)

    expect(harness.email.sent).toHaveLength(0)
    expect(await harness.db.select().from(emailMessages)).toHaveLength(0)
  })

  it('validates recipients and body limits before sending', async () => {
    const userId = await createUserRecord(harness.db)
    const inboxId = await createInboxRecord(harness.db, userId)

    await expect(
      sendMessage(harness.db, harness.env, {
        userId,
        input: {
          inboxId,
          to: ['not-an-email'],
          subject: 'Bad recipient',
          text: 'Hello',
        },
      }),
    ).rejects.toBeInstanceOf(SendMessageValidationError)

    await expect(
      sendMessage(harness.db, harness.env, {
        userId,
        input: {
          inboxId,
          to: ['customer@example.com'],
          subject: 'Too large',
          text: 'a'.repeat(MAX_OUTBOUND_BODY_BYTES + 1),
        },
      }),
    ).rejects.toThrow(`Message bodies must be ${MAX_OUTBOUND_BODY_BYTES} bytes or smaller.`)

    expect(harness.email.sent).toHaveLength(0)
    expect(await harness.db.select().from(emailMessages)).toHaveLength(0)
  })

  it('maps provider failures and persists a failed send result', async () => {
    const userId = await createUserRecord(harness.db)
    const inboxId = await createInboxRecord(harness.db, userId, {
      customLocalPart: 'agent',
    })

    harness.email.failWith(
      Object.assign(new Error('destination address not allowed'), {
        code: 'destination_address_not_allowed',
      }),
    )

    const result = await sendMessage(harness.db, harness.env, {
      userId,
      input: {
        inboxId,
        to: ['customer@example.com'],
        subject: 'Provider failure',
        text: 'Hello anyway',
      },
    })
    const [storedMessage] = await harness.db.select().from(emailMessages)

    expect(result).toMatchObject({
      inboxId,
      providerMessageId: null,
      status: 'failed',
      errorCode: 'recipient_not_allowed',
      errorMessage: 'The email provider rejected one or more recipient addresses.',
      sentAt: null,
    })
    expect(storedMessage).toMatchObject({
      id: result.id,
      status: 'failed',
      providerMessageId: null,
      errorCode: 'recipient_not_allowed',
      errorMessage: 'The email provider rejected one or more recipient addresses.',
      sentAt: null,
    })
    expect(harness.queue.sent[0]?.body).toMatchObject({
      type: 'message.sent.failed',
      data: {
        inboxId,
        threadId: result.threadId,
        messageId: result.id,
        errorCode: 'recipient_not_allowed',
      },
    })
  })

  it('reuses reply threads and sends reply headers', async () => {
    const userId = await createUserRecord(harness.db)
    const inboxId = await createInboxRecord(harness.db, userId, {
      customLocalPart: 'agent',
    })

    const firstResult = await sendMessage(harness.db, harness.env, {
      userId,
      input: {
        inboxId,
        to: ['customer@example.com'],
        subject: 'Hello there',
        text: 'First message',
      },
    })
    const [firstMessage] = await harness.db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, firstResult.id))

    const secondResult = await sendMessage(harness.db, harness.env, {
      userId,
      input: {
        inboxId,
        to: ['customer@example.com'],
        subject: 'Re: Hello there',
        text: 'Reply message',
        replyToThreadId: firstResult.threadId,
      },
    })
    const [secondMessage] = await harness.db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, secondResult.id))

    expect(secondResult.threadId).toBe(firstResult.threadId)
    expect(secondMessage?.threadId).toBe(firstResult.threadId)
    expect(harness.email.sent[1]).toMatchObject({
      headers: {
        'In-Reply-To': firstMessage?.internetMessageId,
        References: firstMessage?.internetMessageId,
      },
    })
  })
})
