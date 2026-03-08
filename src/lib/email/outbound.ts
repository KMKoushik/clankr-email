import { and, asc, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { getDb, getWorkerEnv } from '#/lib/runtime'
import type { AppDb } from '#/db/index'
import { emailMessages, emailThreads, inboxes } from '#/db/schema'

import {
  createMessageSentAcceptedEvent,
  createMessageSentFailedEvent,
} from './events'
import { createMessageId, createThreadId } from './ids'
import { getInboxForUser } from './inboxes'
import { INLINE_BODY_LIMIT_BYTES, normalizeThreadSubject } from './inbound'

export const MAX_OUTBOUND_RECIPIENTS = 50
export const MAX_OUTBOUND_BODY_BYTES = 128_000

const recipientSchema = z.string().trim().toLowerCase().email()

export const sendMessageInputSchema = z
  .object({
    inboxId: z.string().trim().min(1),
    to: z.array(recipientSchema).max(MAX_OUTBOUND_RECIPIENTS).default([]),
    cc: z.array(recipientSchema).max(MAX_OUTBOUND_RECIPIENTS).default([]),
    bcc: z.array(recipientSchema).max(MAX_OUTBOUND_RECIPIENTS).default([]),
    subject: z.string().default('').transform((value) => value.trim()),
    text: z.string().optional(),
    html: z.string().optional(),
    replyToThreadId: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const totalRecipients = new Set([...value.to, ...value.cc, ...value.bcc]).size

    if (totalRecipients === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one recipient is required.',
        path: ['to'],
      })
    }

    if (totalRecipients > MAX_OUTBOUND_RECIPIENTS) {
      ctx.addIssue({
        code: 'custom',
        message: `A message can have at most ${MAX_OUTBOUND_RECIPIENTS} recipients.`,
        path: ['to'],
      })
    }

    if (!hasMessageBody(value.text, value.html)) {
      ctx.addIssue({
        code: 'custom',
        message: 'A text or HTML body is required.',
        path: ['text'],
      })
    }

    if (getBodySizeBytes(value.text, value.html) > MAX_OUTBOUND_BODY_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `Message bodies must be ${MAX_OUTBOUND_BODY_BYTES} bytes or smaller.`,
        path: ['text'],
      })
    }
  })

type ThreadDatabase = Pick<AppDb, 'insert' | 'select' | 'update'>

export type SendMessageInput = z.input<typeof sendMessageInputSchema>

export const sendMessageResultSchema = z.object({
  id: z.string(),
  inboxId: z.string(),
  threadId: z.string(),
  providerMessageId: z.string().nullable(),
  status: z.enum(['accepted', 'failed']),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
})

export type SendMessageResult = z.infer<typeof sendMessageResultSchema>

type SendMessageStatusUpdate = {
  providerMessageId: string | null
  status: SendMessageResult['status']
  errorCode: string | null
  errorMessage: string | null
  sentAt: Date | null
}

type ReplyContext = {
  threadId: string
  inReplyTo: string | null
  references: string[]
}

type PendingOutboundMessage = {
  id: string
  inboxId: string
  threadId: string
  internetMessageId: string
}

export class SendMessageValidationError extends Error {}

export class SendMessageOwnershipError extends Error {}

export class SendMessageThreadNotFoundError extends Error {}

export async function sendMessage(params: {
  userId: string
  input: SendMessageInput
}): Promise<SendMessageResult> {
  const database = getDb()
  const env = getWorkerEnv() as Pick<Env, 'EMAIL' | 'EMAIL_EVENTS' | 'EMAIL_STORAGE'>
  const input = validateSendMessageInput(params.input)
  const inbox = await getInboxForUser(params.userId, input.inboxId)

  if (!inbox || !inbox.isActive) {
    throw new SendMessageOwnershipError('Inbox not found.')
  }

  const fromEmail = getInboxEmailAddress(inbox)
  const messageId = createMessageId()
  const internetMessageId = createInternetMessageId(messageId, fromEmail)
  const sentAt = new Date()
  const bodyStorage = buildBodyStorage(messageId, input.text, input.html)
  const participantHash = await createParticipantHash([
    fromEmail,
    ...input.to,
    ...input.cc,
  ])
  const replyContext = input.replyToThreadId
    ? await getReplyContext(input.inboxId, input.replyToThreadId)
    : null

  if (input.replyToThreadId && !replyContext) {
    throw new SendMessageThreadNotFoundError('Thread not found.')
  }

  if (bodyStorage.oversizedBodyR2Key) {
    await env.EMAIL_STORAGE.put(
      bodyStorage.oversizedBodyR2Key,
      JSON.stringify({
        htmlBody: input.html ?? null,
        textBody: input.text ?? null,
      }),
    )
  }

  const threadId = await ensureThread(database, {
    inboxId: input.inboxId,
    participantHash,
    replyContext,
    sentAt,
    subject: input.subject,
  })

  await database.insert(emailMessages).values({
    id: messageId,
    inboxId: input.inboxId,
    threadId,
    direction: 'outbound',
    providerMessageId: null,
    internetMessageId,
    fromEmail,
    toEmailsJson: JSON.stringify(input.to),
    ccEmailsJson: JSON.stringify(input.cc),
    bccEmailsJson: JSON.stringify(input.bcc),
    subject: input.subject,
    snippet: createSnippet(input.text, input.html),
    textBody: bodyStorage.textBody,
    htmlBody: bodyStorage.htmlBody,
    bodyStorageMode: bodyStorage.mode,
    rawMimeR2Key: null,
    oversizedBodyR2Key: bodyStorage.oversizedBodyR2Key,
    bodySizeBytes: bodyStorage.bodySizeBytes,
    status: 'pending',
    errorCode: null,
    errorMessage: null,
    sentAt: null,
    receivedAt: null,
  })

  const pendingMessage = {
    id: messageId,
    inboxId: input.inboxId,
    threadId,
    internetMessageId,
  }

  let statusUpdate: SendMessageStatusUpdate

  try {
    const result = await env.EMAIL.send({
      from: fromEmail,
      to: input.to,
      cc: input.cc.length > 0 ? input.cc : undefined,
      bcc: input.bcc.length > 0 ? input.bcc : undefined,
      subject: input.subject,
      text: input.text,
      html: input.html,
        headers: buildOutboundHeaders(pendingMessage.internetMessageId, replyContext),
      })

    statusUpdate = {
      providerMessageId: result.messageId,
      status: 'accepted',
      errorCode: null,
      errorMessage: null,
      sentAt,
    }
  } catch (error) {
    console.error('outbound_email_provider_rejected', {
      error: serializeProviderError(error),
      fromEmail,
      inboxId: input.inboxId,
      messageId,
      subject: input.subject,
      to: input.to,
    })

    const mappedError = mapSendProviderError(error)

    statusUpdate = {
      providerMessageId: null,
      status: 'failed',
      errorCode: mappedError.code,
      errorMessage: mappedError.message,
      sentAt: null,
    }
  }

  await updateOutboundMessageStatus(database, pendingMessage.id, statusUpdate)

  await emitSendEvent(env, pendingMessage, statusUpdate)

  return {
    id: pendingMessage.id,
    inboxId: pendingMessage.inboxId,
    threadId: pendingMessage.threadId,
    providerMessageId: statusUpdate.providerMessageId,
    status: statusUpdate.status,
    errorCode: statusUpdate.errorCode,
    errorMessage: statusUpdate.errorMessage,
    sentAt: statusUpdate.sentAt?.toISOString() ?? null,
  }
}

function validateSendMessageInput(input: SendMessageInput) {
  const parsed = sendMessageInputSchema.safeParse(input)

  if (parsed.success) {
    return parsed.data
  }

  throw new SendMessageValidationError(parsed.error.issues[0]?.message ?? 'Invalid message payload.')
}

async function getReplyContext(inboxId: string, threadId: string) {
  const database = getDb()
  const [thread] = await database
    .select({
      id: emailThreads.id,
    })
    .from(emailThreads)
    .where(and(eq(emailThreads.id, threadId), eq(emailThreads.inboxId, inboxId)))
    .limit(1)

  if (!thread) {
    return null
  }

  const threadMessages = await database
    .select({
      direction: emailMessages.direction,
      internetMessageId: emailMessages.internetMessageId,
      status: emailMessages.status,
    })
    .from(emailMessages)
    .where(and(eq(emailMessages.threadId, threadId), eq(emailMessages.inboxId, inboxId)))
    .orderBy(asc(emailMessages.createdAt), asc(emailMessages.id))

  const references = threadMessages
    .filter((message) => message.direction === 'inbound' || message.status === 'accepted')
    .map((message) => message.internetMessageId)
    .filter((value): value is string => Boolean(value))

  return {
    threadId: thread.id,
    inReplyTo: references.at(-1) ?? null,
    references,
  }
}

async function findExistingThreadId(
  database: ThreadDatabase,
  params: {
    inboxId: string
    participantHash: string
    subjectNormalized: string
  },
) {
  const [thread] = await database
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.inboxId, params.inboxId),
        eq(emailThreads.participantHash, params.participantHash),
        eq(emailThreads.subjectNormalized, params.subjectNormalized),
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt), desc(emailThreads.createdAt))
    .limit(1)

  return thread?.id ?? null
}

function buildOutboundHeaders(
  internetMessageId: string,
  replyContext: ReplyContext | null,
) {
  const headers: Record<string, string> = {
    'Message-ID': internetMessageId,
  }

  if (replyContext?.inReplyTo) {
    headers['In-Reply-To'] = replyContext.inReplyTo
  }

  if (replyContext && replyContext.references.length > 0) {
    headers.References = replyContext.references.join(' ')
  }

  return headers
}

async function ensureThread(
  database: ThreadDatabase,
  params: {
    inboxId: string
    participantHash: string
    replyContext: ReplyContext | null
    sentAt: Date
    subject: string
  },
) {
  const threadId = params.replyContext?.threadId
    ?? (await findExistingThreadId(database, {
      inboxId: params.inboxId,
      participantHash: params.participantHash,
      subjectNormalized: normalizeThreadSubject(params.subject),
    }))
    ?? createThreadId()

  const [existingThread] = await database
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(eq(emailThreads.id, threadId))
    .limit(1)

  if (existingThread) {
    await database
      .update(emailThreads)
      .set({ lastMessageAt: params.sentAt })
      .where(eq(emailThreads.id, threadId))
  } else {
    await database.insert(emailThreads).values({
      id: threadId,
      inboxId: params.inboxId,
      subjectNormalized: normalizeThreadSubject(params.subject),
      participantHash: params.participantHash,
      lastMessageAt: params.sentAt,
    })
  }

  return threadId
}

async function updateOutboundMessageStatus(
  database: AppDb,
  messageId: string,
  statusUpdate: SendMessageStatusUpdate,
) {
  await database
    .update(emailMessages)
    .set({
      providerMessageId: statusUpdate.providerMessageId,
      status: statusUpdate.status,
      errorCode: statusUpdate.errorCode,
      errorMessage: statusUpdate.errorMessage,
      sentAt: statusUpdate.sentAt,
    })
    .where(eq(emailMessages.id, messageId))
}

async function emitSendEvent(
  env: Pick<Env, 'EMAIL_EVENTS'>,
  pendingMessage: PendingOutboundMessage,
  statusUpdate: SendMessageStatusUpdate,
) {
  try {
    if (statusUpdate.status === 'accepted' && statusUpdate.providerMessageId) {
      await env.EMAIL_EVENTS.send(
        createMessageSentAcceptedEvent({
          inboxId: pendingMessage.inboxId,
          threadId: pendingMessage.threadId,
          messageId: pendingMessage.id,
          providerMessageId: statusUpdate.providerMessageId,
        }),
      )

      return
    }

    if (statusUpdate.status === 'failed' && statusUpdate.errorCode) {
      await env.EMAIL_EVENTS.send(
        createMessageSentFailedEvent({
          inboxId: pendingMessage.inboxId,
          threadId: pendingMessage.threadId,
          messageId: pendingMessage.id,
          errorCode: statusUpdate.errorCode,
        }),
      )
    }
  } catch (error) {
    console.error('Failed to emit outbound email event.', {
      error,
      messageId: pendingMessage.id,
      status: statusUpdate.status,
    })
  }
}

function getInboxEmailAddress(inbox: typeof inboxes.$inferSelect) {
  const localPart = inbox.customLocalPart ?? inbox.defaultLocalPart

  return `${localPart}@clankr.email`
}

function createInternetMessageId(messageId: string, fromEmail: string) {
  const [, domain = 'clankr.email'] = fromEmail.split('@')

  return `<${messageId}@${domain}>`
}

function hasMessageBody(textBody: string | undefined, htmlBody: string | undefined) {
  return Boolean(textBody?.trim() || htmlBody?.trim())
}

function getBodySizeBytes(textBody: string | undefined, htmlBody: string | undefined) {
  return new TextEncoder().encode(
    JSON.stringify({
      htmlBody: htmlBody ?? null,
      textBody: textBody ?? null,
    }),
  ).byteLength
}

function buildBodyStorage(messageId: string, textBody: string | undefined, htmlBody: string | undefined) {
  const nextTextBody = textBody ?? null
  const nextHtmlBody = htmlBody ?? null
  const bodySizeBytes = getBodySizeBytes(textBody, htmlBody)

  if (bodySizeBytes > INLINE_BODY_LIMIT_BYTES) {
    return {
      mode: 'oversized' as const,
      textBody: null,
      htmlBody: null,
      oversizedBodyR2Key: `bodies/${messageId}.json`,
      bodySizeBytes,
    }
  }

  return {
    mode: 'inline' as const,
    textBody: nextTextBody,
    htmlBody: nextHtmlBody,
    oversizedBodyR2Key: null,
    bodySizeBytes,
  }
}

function createSnippet(textBody: string | undefined, htmlBody: string | undefined) {
  const source = (textBody ?? htmlBody ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

  return source.slice(0, 160)
}

async function createParticipantHash(addresses: string[]) {
  const participants = [...new Set(addresses.map((address) => address.trim().toLowerCase()).filter(Boolean))]
    .sort()
    .join('|')

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(participants),
  )

  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function mapSendProviderError(error: unknown) {
  const rawCode = normalizeErrorCode(error)

  if (rawCode.includes('sender') || rawCode.includes('from')) {
    return {
      code: 'sender_not_allowed',
      message: 'The email provider rejected the sender address.',
    }
  }

  if (rawCode.includes('recipient') || rawCode.includes('destination') || rawCode.includes('to')) {
    return {
      code: 'recipient_not_allowed',
      message: 'The email provider rejected one or more recipient addresses.',
    }
  }

  return {
    code: 'provider_error',
    message: 'The email provider failed to accept the message.',
  }
}

function normalizeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') {
    return ''
  }

  const maybeCode = 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'name' in error && typeof error.name === 'string'
      ? error.name
      : 'message' in error && typeof error.message === 'string'
        ? error.message
        : ''

  return maybeCode.trim().toLowerCase()
}

function serializeProviderError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      cause: error.cause ? serializeProviderError(error.cause) : undefined,
      message: error.message,
      name: error.name,
      stack: error.stack,
      ...(hasStringCode(error) ? { code: error.code } : {}),
    }
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>

    return {
      ...record,
      ...(typeof record.cause !== 'undefined' ? { cause: serializeProviderError(record.cause) } : {}),
    }
  }

  return error
}

function hasStringCode(error: Error): error is Error & { code: string } {
  return 'code' in error && typeof error.code === 'string'
}
