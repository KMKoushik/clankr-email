import { and, asc, desc, eq, gt, inArray, lt, or } from 'drizzle-orm'
import { z } from 'zod'

import { emailMessages, emailThreads } from '#/db/schema'
import { getDb, getWorkerEnv } from '#/lib/runtime'

import { getInboxForUser } from './inboxes'

const MESSAGE_DIRECTION_VALUES = ['inbound', 'outbound'] as const
const MESSAGE_STATUS_VALUES = ['pending', 'received', 'accepted', 'failed', 'rejected'] as const
const BODY_STORAGE_MODE_VALUES = ['inline', 'oversized'] as const

const DEFAULT_THREAD_PAGE_SIZE = 25
const MAX_THREAD_PAGE_SIZE = 100
const DEFAULT_MESSAGE_PAGE_SIZE = 50
const MAX_MESSAGE_PAGE_SIZE = 100

const messageDirectionSchema = z.enum(MESSAGE_DIRECTION_VALUES)
const messageStatusSchema = z.enum(MESSAGE_STATUS_VALUES)
const bodyStorageModeSchema = z.enum(BODY_STORAGE_MODE_VALUES)

export const threadListCursorSchema = z.object({
  id: z.string(),
  lastMessageAt: z.string().datetime(),
})

export const messageListCursorSchema = z.object({
  id: z.string(),
})

export const listThreadsByInboxInputSchema = z
  .object({
    inboxId: z.string().trim().min(1),
    limit: z.coerce.number().int().min(1).max(MAX_THREAD_PAGE_SIZE).default(DEFAULT_THREAD_PAGE_SIZE),
    cursorLastMessageAt: z.string().datetime().optional(),
    cursorThreadId: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const hasCursorLastMessageAt = Boolean(value.cursorLastMessageAt)
    const hasCursorThreadId = Boolean(value.cursorThreadId)

    if (hasCursorLastMessageAt !== hasCursorThreadId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Thread pagination requires both cursorLastMessageAt and cursorThreadId.',
        path: hasCursorLastMessageAt ? ['cursorThreadId'] : ['cursorLastMessageAt'],
      })
    }
  })

export const threadSummarySchema = z.object({
  id: z.string(),
  inboxId: z.string(),
  latestMessageDirection: messageDirectionSchema.nullable(),
  latestMessageId: z.string().nullable(),
  createdAt: z.string().datetime(),
  fromEmail: z.string().nullable(),
  lastMessageAt: z.string().datetime(),
  messageCount: z.number().int().nonnegative(),
  snippet: z.string().nullable(),
  subject: z.string().nullable(),
  updatedAt: z.string().datetime(),
})

export const listThreadsByInboxResultSchema = z.object({
  items: z.array(threadSummarySchema),
  nextCursor: threadListCursorSchema.nullable(),
})

export const listMessagesInputSchema = z
  .object({
    threadId: z.string().trim().min(1),
    limit: z.coerce.number().int().min(1).max(MAX_MESSAGE_PAGE_SIZE).default(DEFAULT_MESSAGE_PAGE_SIZE),
    cursorMessageId: z.string().trim().min(1).optional(),
  })

export const messageSummarySchema = z.object({
  id: z.string(),
  inboxId: z.string(),
  threadId: z.string(),
  direction: messageDirectionSchema,
  fromEmail: z.string(),
  toEmails: z.array(z.string()),
  ccEmails: z.array(z.string()),
  bccEmails: z.array(z.string()),
  subject: z.string(),
  snippet: z.string(),
  bodyStorageMode: bodyStorageModeSchema,
  bodySizeBytes: z.number().int().nullable(),
  status: messageStatusSchema,
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  sentAt: z.string().datetime().nullable(),
  receivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
})

export const listMessagesResultSchema = z.object({
  items: z.array(messageSummarySchema),
  nextCursor: messageListCursorSchema.nullable(),
})

export const getMessageInputSchema = z.object({
  messageId: z.string().trim().min(1),
})

export const messageDetailSchema = messageSummarySchema.extend({
  internetMessageId: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  rawMimeR2Key: z.string().nullable(),
  oversizedBodyR2Key: z.string().nullable(),
  textBody: z.string().nullable(),
  htmlBody: z.string().nullable(),
  bodyFetchStrategy: z.enum(['inline', 'r2']),
})

type ListThreadsByInboxInput = z.infer<typeof listThreadsByInboxInputSchema>
type ListMessagesInput = z.infer<typeof listMessagesInputSchema>

type MessageRecord = typeof emailMessages.$inferSelect

export async function listThreadsByInboxForUser(userId: string, input: ListThreadsByInboxInput) {
  const inbox = await getInboxForUser(userId, input.inboxId)

  if (!inbox) {
    return null
  }

  const database = getDb()
  const cursorLastMessageAt = input.cursorLastMessageAt ? new Date(input.cursorLastMessageAt) : null

  const whereClause = cursorLastMessageAt && input.cursorThreadId
    ? and(
        eq(emailThreads.inboxId, input.inboxId),
        or(
          lt(emailThreads.lastMessageAt, cursorLastMessageAt),
          and(
            eq(emailThreads.lastMessageAt, cursorLastMessageAt),
            lt(emailThreads.id, input.cursorThreadId),
          ),
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
  const hasMore = rows.length > input.limit

  if (pageRows.length === 0) {
    return {
      items: [],
      nextCursor: null,
    }
  }

  const threadIds = pageRows.map((row) => row.id)
  const threadMessages = await database
    .select({
      createdAt: emailMessages.createdAt,
      direction: emailMessages.direction,
      fromEmail: emailMessages.fromEmail,
      id: emailMessages.id,
      snippet: emailMessages.snippet,
      subject: emailMessages.subject,
      threadId: emailMessages.threadId,
    })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.inboxId, input.inboxId),
        inArray(emailMessages.threadId, threadIds),
      ),
    )
    .orderBy(desc(emailMessages.createdAt), desc(emailMessages.id))

  const latestMessageByThreadId = new Map<string, (typeof threadMessages)[number]>()
  const messageCountByThreadId = new Map<string, number>()

  for (const message of threadMessages) {
    messageCountByThreadId.set(message.threadId, (messageCountByThreadId.get(message.threadId) ?? 0) + 1)

    if (!latestMessageByThreadId.has(message.threadId)) {
      latestMessageByThreadId.set(message.threadId, message)
    }
  }

  return {
    items: pageRows.map((row) => {
      const latestMessage = latestMessageByThreadId.get(row.id) ?? null

      return {
        id: row.id,
        inboxId: row.inboxId,
        latestMessageDirection: latestMessage ? parseMessageDirection(latestMessage.direction) : null,
        latestMessageId: latestMessage?.id ?? null,
        createdAt: row.createdAt.toISOString(),
        fromEmail: latestMessage?.fromEmail ?? null,
        lastMessageAt: row.lastMessageAt.toISOString(),
        messageCount: messageCountByThreadId.get(row.id) ?? 0,
        snippet: latestMessage?.snippet ?? null,
        subject: latestMessage?.subject ?? null,
        updatedAt: row.updatedAt.toISOString(),
      }
    }),
    nextCursor: hasMore
      ? {
          id: pageRows.at(-1)!.id,
          lastMessageAt: pageRows.at(-1)!.lastMessageAt.toISOString(),
        }
      : null,
  }
}

export async function listThreadMessagesForUser(userId: string, input: ListMessagesInput) {
  const database = getDb()
  const [thread] = await database
    .select({
      id: emailThreads.id,
      inboxId: emailThreads.inboxId,
    })
    .from(emailThreads)
    .where(eq(emailThreads.id, input.threadId))
    .limit(1)

  if (!thread) {
    return null
  }

  const inbox = await getInboxForUser(userId, thread.inboxId)

  if (!inbox) {
    return null
  }

  const whereClause = input.cursorMessageId
    ? and(
        eq(emailMessages.threadId, input.threadId),
        eq(emailMessages.inboxId, thread.inboxId),
        gt(emailMessages.id, input.cursorMessageId),
      )
    : and(
        eq(emailMessages.threadId, input.threadId),
        eq(emailMessages.inboxId, thread.inboxId),
      )

  const rows = await database
    .select()
    .from(emailMessages)
    .where(whereClause)
    .orderBy(asc(emailMessages.id))
    .limit(input.limit + 1)

  const pageRows = rows.slice(0, input.limit)
  const hasMore = rows.length > input.limit

  return {
    items: pageRows.map(serializeMessageSummary),
    nextCursor: hasMore
      ? {
          id: pageRows.at(-1)!.id,
        }
      : null,
  }
}

export async function getMessageForUser(userId: string, messageId: string) {
  const database = getDb()
  const [message] = await database
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.id, messageId))
    .limit(1)

  if (!message) {
    return null
  }

  const inbox = await getInboxForUser(userId, message.inboxId)

  if (!inbox) {
    return null
  }

  const body = await resolveMessageBody(message)

  return {
    ...serializeMessageSummary(message),
    internetMessageId: message.internetMessageId,
    providerMessageId: message.providerMessageId,
    rawMimeR2Key: message.rawMimeR2Key,
    oversizedBodyR2Key: message.oversizedBodyR2Key,
    textBody: body.textBody,
    htmlBody: body.htmlBody,
    bodyFetchStrategy: body.fetchStrategy,
  }
}

function serializeMessageSummary(message: MessageRecord) {
  return {
    id: message.id,
    inboxId: message.inboxId,
    threadId: message.threadId,
    direction: parseMessageDirection(message.direction),
    fromEmail: message.fromEmail,
    toEmails: parseEmailList(message.toEmailsJson),
    ccEmails: parseEmailList(message.ccEmailsJson),
    bccEmails: parseEmailList(message.bccEmailsJson),
    subject: message.subject,
    snippet: message.snippet,
    bodyStorageMode: parseBodyStorageMode(message.bodyStorageMode),
    bodySizeBytes: message.bodySizeBytes,
    status: parseMessageStatus(message.status),
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
    sentAt: message.sentAt?.toISOString() ?? null,
    receivedAt: message.receivedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  }
}

async function resolveMessageBody(message: MessageRecord) {
  if (message.bodyStorageMode !== 'oversized') {
    return {
      textBody: message.textBody,
      htmlBody: message.htmlBody,
      fetchStrategy: 'inline' as const,
    }
  }

  if (!message.oversizedBodyR2Key) {
    throw new Error(`Missing oversized body key for message ${message.id}.`)
  }

  const env = getWorkerEnv() as Pick<Env, 'EMAIL_STORAGE'>
  const bodyObject = await env.EMAIL_STORAGE.get(message.oversizedBodyR2Key)

  if (!bodyObject) {
    throw new Error(`Oversized body not found for message ${message.id}.`)
  }

  const parsedBody = oversizedBodySchema.parse(JSON.parse(await bodyObject.text()))

  return {
    textBody: parsedBody.textBody,
    htmlBody: parsedBody.htmlBody,
    fetchStrategy: 'r2' as const,
  }
}

function parseEmailList(value: string) {
  try {
    const parsed = JSON.parse(value)

    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

function parseMessageDirection(value: string) {
  return messageDirectionSchema.parse(value)
}

function parseMessageStatus(value: string) {
  return messageStatusSchema.parse(value)
}

function parseBodyStorageMode(value: string) {
  return bodyStorageModeSchema.parse(value)
}

const oversizedBodySchema = z.object({
  textBody: z.string().nullable(),
  htmlBody: z.string().nullable(),
})
