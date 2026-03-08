import { and, asc, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { emailMessages, emailThreads } from '#/db/schema'
import { getDb, getWorkerEnv } from '#/lib/runtime'

import { getInboxForUser } from './inboxes'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

const paginationSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})

export const threadListInputSchema = paginationSchema.extend({
  inboxId: z.string().trim().min(1),
})

export const threadMessageListInputSchema = paginationSchema.extend({
  inboxId: z.string().trim().min(1),
  threadId: z.string().trim().min(1),
})

export const messageDetailInputSchema = z.object({
  messageId: z.string().trim().min(1),
})

const messageStatusSchema = z.enum(['pending', 'received', 'accepted', 'failed', 'rejected'])

export const threadListItemSchema = z.object({
  id: z.string(),
  inboxId: z.string(),
  subject: z.string(),
  subjectNormalized: z.string(),
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  latestMessage: z.object({
    id: z.string(),
    direction: z.enum(['inbound', 'outbound']),
    fromEmail: z.string(),
    subject: z.string(),
    snippet: z.string(),
    status: messageStatusSchema,
    sentAt: z.string().datetime().nullable(),
    receivedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  }).nullable(),
})

export const threadListResultSchema = z.object({
  nextCursor: z.string().nullable(),
  threads: z.array(threadListItemSchema),
})

export const messageListItemSchema = z.object({
  id: z.string(),
  inboxId: z.string(),
  threadId: z.string(),
  direction: z.enum(['inbound', 'outbound']),
  providerMessageId: z.string().nullable(),
  internetMessageId: z.string().nullable(),
  fromEmail: z.string(),
  toEmails: z.array(z.string()),
  ccEmails: z.array(z.string()),
  bccEmails: z.array(z.string()),
  subject: z.string(),
  snippet: z.string(),
  bodyStorageMode: z.enum(['inline', 'oversized']),
  bodySizeBytes: z.number().int().nullable(),
  status: messageStatusSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  receivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

export const threadMessageListResultSchema = z.object({
  nextCursor: z.string().nullable(),
  messages: z.array(messageListItemSchema),
})

export const messageDetailSchema = messageListItemSchema.extend({
  textBody: z.string().nullable(),
  htmlBody: z.string().nullable(),
  bodySource: z.enum(['inline', 'r2', 'missing']),
  hasRawMime: z.boolean(),
})

export class EmailReadValidationError extends Error {}

export class EmailReadOwnershipError extends Error {}

export class EmailThreadNotFoundError extends Error {}

export class EmailMessageNotFoundError extends Error {}

const ownedThreadListInputSchema = threadListInputSchema.extend({
  userId: z.string().trim().min(1),
})

const ownedThreadMessageListInputSchema = threadMessageListInputSchema.extend({
  userId: z.string().trim().min(1),
})

const ownedMessageDetailInputSchema = messageDetailInputSchema.extend({
  userId: z.string().trim().min(1),
})

export async function listThreadsByInboxForUser(params: z.input<typeof ownedThreadListInputSchema>) {
  const input = validateThreadListInput(params)
  const inbox = await getInboxForUser(input.userId, input.inboxId)

  if (!inbox || !inbox.isActive) {
    throw new EmailReadOwnershipError('Inbox not found.')
  }

  const database = getDb()
  const cursor = decodeCursor(input.cursor, threadCursorSchema)
  const whereClause = cursor
    ? and(
        eq(emailThreads.inboxId, input.inboxId),
        or(
          lt(emailThreads.lastMessageAt, cursor.lastMessageAt),
          and(eq(emailThreads.lastMessageAt, cursor.lastMessageAt), lt(emailThreads.id, cursor.id)),
        ),
      )
    : eq(emailThreads.inboxId, input.inboxId)

  const rows = await database
    .select()
    .from(emailThreads)
    .where(whereClause)
    .orderBy(desc(emailThreads.lastMessageAt), desc(emailThreads.id))
    .limit(input.limit + 1)

  const pageRows = rows.slice(0, input.limit)
  const threadIds = pageRows.map((row) => row.id)

  const [messageCounts, latestMessages] = await Promise.all([
    threadIds.length > 0
      ? database
          .select({
            threadId: emailMessages.threadId,
            count: sql<number>`count(*)`,
          })
          .from(emailMessages)
          .where(inArray(emailMessages.threadId, threadIds))
          .groupBy(emailMessages.threadId)
      : Promise.resolve([]),
    threadIds.length > 0
      ? database
          .select({
            id: emailMessages.id,
            threadId: emailMessages.threadId,
            direction: emailMessages.direction,
            fromEmail: emailMessages.fromEmail,
            subject: emailMessages.subject,
            snippet: emailMessages.snippet,
            status: emailMessages.status,
            sentAt: emailMessages.sentAt,
            receivedAt: emailMessages.receivedAt,
            createdAt: emailMessages.createdAt,
          })
          .from(emailMessages)
          .where(inArray(emailMessages.threadId, threadIds))
          .orderBy(desc(emailMessages.createdAt), desc(emailMessages.id))
      : Promise.resolve([]),
  ])

  const countByThreadId = new Map(messageCounts.map((row) => [row.threadId, Number(row.count)]))
  const latestMessageByThreadId = new Map<string, (typeof latestMessages)[number]>()

  for (const message of latestMessages) {
    if (!latestMessageByThreadId.has(message.threadId)) {
      latestMessageByThreadId.set(message.threadId, message)
    }
  }

  return {
    nextCursor: rows.length > input.limit
      ? encodeCursor({
          id: pageRows.at(-1)?.id ?? '',
          lastMessageAt: pageRows.at(-1)?.lastMessageAt.toISOString() ?? '',
        })
      : null,
    threads: pageRows.map((thread) => {
      const latestMessage = latestMessageByThreadId.get(thread.id)

      return {
        id: thread.id,
        inboxId: thread.inboxId,
        subject: latestMessage?.subject ?? thread.subjectNormalized,
        subjectNormalized: thread.subjectNormalized,
        messageCount: countByThreadId.get(thread.id) ?? 0,
        lastMessageAt: thread.lastMessageAt.toISOString(),
        createdAt: thread.createdAt.toISOString(),
        updatedAt: thread.updatedAt.toISOString(),
        latestMessage: latestMessage
          ? {
              id: latestMessage.id,
              direction: latestMessage.direction as 'inbound' | 'outbound',
              fromEmail: latestMessage.fromEmail,
              subject: latestMessage.subject,
              snippet: latestMessage.snippet,
              status: latestMessage.status as z.infer<typeof messageStatusSchema>,
              sentAt: latestMessage.sentAt?.toISOString() ?? null,
              receivedAt: latestMessage.receivedAt?.toISOString() ?? null,
              createdAt: latestMessage.createdAt.toISOString(),
            }
          : null,
      }
    }),
  }
}

export async function listThreadMessagesForUser(params: z.input<typeof ownedThreadMessageListInputSchema>) {
  const input = validateThreadMessageListInput(params)
  const thread = await getOwnedThread(input.userId, input.inboxId, input.threadId)

  if (!thread) {
    throw new EmailThreadNotFoundError('Thread not found.')
  }

  const database = getDb()
  const cursor = decodeCursor(input.cursor, messageCursorSchema)
  const whereClause = cursor
    ? and(
        eq(emailMessages.inboxId, input.inboxId),
        eq(emailMessages.threadId, input.threadId),
        or(
          gt(emailMessages.createdAt, cursor.createdAt),
          and(eq(emailMessages.createdAt, cursor.createdAt), gt(emailMessages.id, cursor.id)),
        ),
      )
    : and(eq(emailMessages.inboxId, input.inboxId), eq(emailMessages.threadId, input.threadId))

  const rows = await database
    .select()
    .from(emailMessages)
    .where(whereClause)
    .orderBy(asc(emailMessages.createdAt), asc(emailMessages.id))
    .limit(input.limit + 1)

  const pageRows = rows.slice(0, input.limit)

  return {
    nextCursor: rows.length > input.limit
      ? encodeCursor({
          createdAt: pageRows.at(-1)?.createdAt.toISOString() ?? '',
          id: pageRows.at(-1)?.id ?? '',
        })
      : null,
    messages: pageRows.map(serializeMessageListItem),
  }
}

export async function getMessageForUser(params: z.input<typeof ownedMessageDetailInputSchema>) {
  const input = validateMessageDetailInput(params)
  const database = getDb()
  const [message] = await database
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.id, input.messageId))
    .limit(1)

  if (!message) {
    throw new EmailMessageNotFoundError('Message not found.')
  }

  const inbox = await getInboxForUser(input.userId, message.inboxId)

  if (!inbox || !inbox.isActive) {
    throw new EmailMessageNotFoundError('Message not found.')
  }

  const body = await loadMessageBody(message)

  return {
    ...serializeMessageListItem(message),
    textBody: body.textBody,
    htmlBody: body.htmlBody,
    bodySource: body.source,
    hasRawMime: Boolean(message.rawMimeR2Key),
  }
}

const threadCursorSchema = z.object({
  id: z.string().min(1),
  lastMessageAt: z.string().datetime().transform((value) => new Date(value)),
})

const messageCursorSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().datetime().transform((value) => new Date(value)),
})

function validateThreadListInput(input: z.input<typeof ownedThreadListInputSchema>) {
  const parsed = ownedThreadListInputSchema.safeParse(input)

  if (parsed.success) {
    return parsed.data
  }

  throw new EmailReadValidationError(parsed.error.issues[0]?.message ?? 'Invalid thread list input.')
}

function validateThreadMessageListInput(input: z.input<typeof ownedThreadMessageListInputSchema>) {
  const parsed = ownedThreadMessageListInputSchema.safeParse(input)

  if (parsed.success) {
    return parsed.data
  }

  throw new EmailReadValidationError(parsed.error.issues[0]?.message ?? 'Invalid thread message list input.')
}

function validateMessageDetailInput(input: z.input<typeof ownedMessageDetailInputSchema>) {
  const parsed = ownedMessageDetailInputSchema.safeParse(input)

  if (parsed.success) {
    return parsed.data
  }

  throw new EmailReadValidationError(parsed.error.issues[0]?.message ?? 'Invalid message detail input.')
}

async function getOwnedThread(userId: string, inboxId: string, threadId: string) {
  const inbox = await getInboxForUser(userId, inboxId)

  if (!inbox || !inbox.isActive) {
    return null
  }

  const [thread] = await getDb()
    .select()
    .from(emailThreads)
    .where(and(eq(emailThreads.inboxId, inboxId), eq(emailThreads.id, threadId)))
    .limit(1)

  return thread ?? null
}

async function loadMessageBody(message: typeof emailMessages.$inferSelect) {
  if (message.bodyStorageMode === 'inline') {
    return {
      textBody: message.textBody,
      htmlBody: message.htmlBody,
      source: 'inline' as const,
    }
  }

  if (!message.oversizedBodyR2Key) {
    return {
      textBody: null,
      htmlBody: null,
      source: 'missing' as const,
    }
  }

  const env = getWorkerEnv() as Pick<Env, 'EMAIL_STORAGE'>
  const bodyObject = await env.EMAIL_STORAGE.get(message.oversizedBodyR2Key)

  if (!bodyObject) {
    return {
      textBody: null,
      htmlBody: null,
      source: 'missing' as const,
    }
  }

  try {
    const parsedBody = oversizedBodySchema.parse(JSON.parse(await bodyObject.text()))

    return {
      textBody: parsedBody.textBody,
      htmlBody: parsedBody.htmlBody,
      source: 'r2' as const,
    }
  } catch {
    return {
      textBody: null,
      htmlBody: null,
      source: 'missing' as const,
    }
  }
}

const oversizedBodySchema = z.object({
  textBody: z.string().nullable(),
  htmlBody: z.string().nullable(),
})

function serializeMessageListItem(message: typeof emailMessages.$inferSelect) {
  return {
    id: message.id,
    inboxId: message.inboxId,
    threadId: message.threadId,
    direction: message.direction as 'inbound' | 'outbound',
    providerMessageId: message.providerMessageId,
    internetMessageId: message.internetMessageId,
    fromEmail: message.fromEmail,
    toEmails: parseAddressList(message.toEmailsJson),
    ccEmails: parseAddressList(message.ccEmailsJson),
    bccEmails: parseAddressList(message.bccEmailsJson),
    subject: message.subject,
    snippet: message.snippet,
    bodyStorageMode: message.bodyStorageMode as 'inline' | 'oversized',
    bodySizeBytes: message.bodySizeBytes ?? null,
    status: message.status as z.infer<typeof messageStatusSchema>,
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
    sentAt: message.sentAt?.toISOString() ?? null,
    receivedAt: message.receivedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  }
}

function parseAddressList(value: string) {
  try {
    const parsed = JSON.parse(value)

    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function decodeCursor<T>(cursor: string | undefined, schema: z.ZodType<T>) {
  if (!cursor) {
    return null
  }

  try {
    return schema.parse(JSON.parse(atob(cursor)))
  } catch {
    throw new EmailReadValidationError('Invalid pagination cursor.')
  }
}

function encodeCursor(value: Record<string, string>) {
  return btoa(JSON.stringify(value))
}
