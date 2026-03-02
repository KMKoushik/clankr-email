import { env as workerEnv } from 'cloudflare:workers'
import { and, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm'
import PostalMime from 'postal-mime'

import { db } from '#/db/index'
import {
  emailAttachment,
  emailEvent,
  emailMessage,
  emailThread,
  inbox,
  inboxAlias,
  suppressionEntry,
  webhookDelivery,
  webhookSubscription,
} from '#/db/schema'

const EMAIL_DOMAIN = 'clankr.email'
const MAX_WEBHOOK_ATTEMPTS = 8
const WEBHOOK_RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
]

const RESERVED_LOCAL_PARTS = new Set([
  'admin',
  'api',
  'auth',
  'billing',
  'help',
  'noreply',
  'postmaster',
  'root',
  'security',
  'support',
  'webhook',
  'www',
])

export type EmailEventType =
  | 'message.received'
  | 'thread.updated'
  | 'message.sent'
  | 'message.failed'
  | 'message.bounced'

export interface EmailSendResponse {
  messageId: string
  success: boolean
}

export interface EmailSendPayload {
  to: string | string[]
  from: string | { email: string; name?: string }
  subject: string
  text?: string
  html?: string
  cc?: string | string[]
  bcc?: string | string[]
  replyTo?: string | { email: string; name?: string }
  headers?: Record<string, string>
}

interface EmailBinding {
  send(message: EmailSendPayload): Promise<EmailSendResponse>
}

interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: {
        contentType?: string
      }
    },
  ): Promise<void>
}

interface WorkerBindings {
  EMAIL?: EmailBinding
  EMAIL_RAW_BUCKET?: R2BucketLike
}

export interface ForwardableEmailMessageLike {
  readonly from: string
  readonly to: string
  readonly headers: Headers
  readonly raw: ReadableStream
  readonly rawSize: number
  setReject(reason: string): void
}

interface InboundParsedEmail {
  fromAddress: string
  toAddress: string
  ccAddresses: string[]
  bccAddresses: string[]
  subject: string
  textBody: string | null
  htmlBody: string | null
  snippet: string
  internetMessageId: string | null
  inReplyTo: string | null
  references: string[]
  rawSize: number
  rawEmailR2Key: string | null
  attachments: Array<{
    filename: string
    mimeType: string
    contentId: string | null
    disposition: string
    r2Key: string | null
    size: number
  }>
  headers: Record<string, string>
  receivedAt: Date
}

interface ParsedAddress {
  address: string
}

interface ParsedAttachment {
  filename?: string
  mimeType?: string
  contentId?: string
  disposition?: string
  content?: unknown
}

interface ParsedEmailObject {
  from?: unknown
  to?: unknown
  cc?: unknown
  bcc?: unknown
  subject?: unknown
  text?: unknown
  html?: unknown
  messageId?: unknown
  inReplyTo?: unknown
  references?: unknown
  attachments?: unknown
}

export interface InboxSummary {
  id: string
  canonicalEmail: string
  aliases: string[]
  createdAt: Date
}

export interface WebhookEventPayload {
  eventId: string
  type: EmailEventType
  occurredAt: string
  inboxId: string | null
  threadId: string | null
  messageId: string | null
  data: Record<string, unknown>
}

interface DispatchEventInput {
  type: EmailEventType
  inboxId: string | null
  threadId?: string | null
  messageId?: string | null
  data: Record<string, unknown>
}

function getBindings(): WorkerBindings {
  return workerEnv as unknown as WorkerBindings
}

function createId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`
}

function normalizeLocalPart(localPart: string): string | null {
  const normalized = localPart.trim().toLowerCase()
  if (!/^[a-z0-9._-]{3,64}$/.test(normalized)) {
    return null
  }
  if (RESERVED_LOCAL_PARTS.has(normalized)) {
    return null
  }
  return normalized
}

function extractLocalPart(emailAddress: string): string {
  return emailAddress.split('@')[0]?.toLowerCase() ?? ''
}

function getPrimaryLocalPart(localPart: string): string {
  return localPart.split('+')[0] ?? localPart
}

function buildInboxEmail(localPart: string): string {
  return `${localPart}@${EMAIL_DOMAIN}`
}

function normalizeSubject(subject: string): string {
  const trimmed = subject.trim()
  if (!trimmed) {
    return '(no subject)'
  }

  let normalized = trimmed
  let previous = ''
  while (normalized !== previous) {
    previous = normalized
    normalized = normalized.replace(/^(re|fwd?)\s*:\s*/i, '').trim()
  }

  return normalized.toLowerCase() || '(no subject)'
}

function toSnippet(text: string | null, html: string | null): string {
  const source = text ?? html?.replace(/<[^>]+>/g, ' ') ?? ''
  const compact = source.replace(/\s+/g, ' ').trim()
  return compact.slice(0, 280)
}

function parseStringArray(value: string | null): string[] {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function parseEventList(value: string): string[] {
  const parsed = parseStringArray(value)
  return parsed.length ? parsed : ['*']
}

function parseStringRecord(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
  } catch {
    return {}
  }
}

function parseAddressLike(value: unknown): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const match = entry.match(/<([^>]+)>/)
        return (match?.[1] ?? entry).toLowerCase()
      })
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => parseAddressLike(entry))
      .map((entry) => entry.toLowerCase())
  }

  if (value && typeof value === 'object') {
    const candidate = value as ParsedAddress & { name?: unknown }
    if (typeof candidate.address === 'string') {
      return [candidate.address.toLowerCase()]
    }
  }

  return []
}

function normalizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of headers.entries()) {
    result[key] = value
  }
  return result
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function createSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  )

  return toHex(new Uint8Array(signature))
}

async function ensureAliasAvailable(localPart: string): Promise<void> {
  const [existingAlias] = await db
    .select({ id: inboxAlias.id })
    .from(inboxAlias)
    .where(eq(inboxAlias.localPart, localPart))
    .limit(1)

  if (existingAlias) {
    throw new Error('Alias is not available')
  }

  const [existingCanonical] = await db
    .select({ id: inbox.id })
    .from(inbox)
    .where(eq(inbox.canonicalLocalPart, localPart))
    .limit(1)

  if (existingCanonical) {
    throw new Error('Alias is not available')
  }
}

async function getInboxAliases(inboxIds: string[]): Promise<Map<string, string[]>> {
  if (!inboxIds.length) {
    return new Map()
  }

  const rows = await db
    .select({ inboxId: inboxAlias.inboxId, localPart: inboxAlias.localPart })
    .from(inboxAlias)
    .where(inArray(inboxAlias.inboxId, inboxIds))

  const map = new Map<string, string[]>()
  for (const row of rows) {
    const aliases = map.get(row.inboxId) ?? []
    aliases.push(buildInboxEmail(row.localPart))
    map.set(row.inboxId, aliases)
  }

  return map
}

async function dispatchEvent(input: DispatchEventInput): Promise<void> {
  const eventId = createId('evt')
  const payload: WebhookEventPayload = {
    eventId,
    type: input.type,
    occurredAt: new Date().toISOString(),
    inboxId: input.inboxId,
    threadId: input.threadId ?? null,
    messageId: input.messageId ?? null,
    data: input.data,
  }

  await db.insert(emailEvent).values({
    id: eventId,
    inboxId: input.inboxId,
    threadId: input.threadId ?? null,
    messageId: input.messageId ?? null,
    eventType: input.type,
    payload: JSON.stringify(payload),
  })

  const subscriptions = await db
    .select()
    .from(webhookSubscription)
    .where(
      and(
        eq(webhookSubscription.isActive, true),
        input.inboxId
          ? or(
              eq(webhookSubscription.inboxId, input.inboxId),
              isNull(webhookSubscription.inboxId),
            )
          : isNull(webhookSubscription.inboxId),
      ),
    )

  const body = JSON.stringify(payload)
  for (const subscription of subscriptions) {
    const events = parseEventList(subscription.events)
    if (!events.includes('*') && !events.includes(input.type)) {
      continue
    }

    const deliveryId = createId('dlv')
    await db
      .insert(webhookDelivery)
      .values({
        id: deliveryId,
        subscriptionId: subscription.id,
        eventId,
        eventType: input.type,
        payload: body,
        status: 'pending',
      })
      .onConflictDoNothing()

    await attemptWebhookDelivery(deliveryId)
  }
}

async function attemptWebhookDelivery(deliveryId: string): Promise<void> {
  const [row] = await db
    .select({
      id: webhookDelivery.id,
      subscriptionId: webhookDelivery.subscriptionId,
      payload: webhookDelivery.payload,
      attemptCount: webhookDelivery.attemptCount,
      eventId: webhookDelivery.eventId,
      eventType: webhookDelivery.eventType,
      targetUrl: webhookSubscription.targetUrl,
      secret: webhookSubscription.secret,
      status: webhookDelivery.status,
    })
    .from(webhookDelivery)
    .innerJoin(
      webhookSubscription,
      eq(webhookSubscription.id, webhookDelivery.subscriptionId),
    )
    .where(eq(webhookDelivery.id, deliveryId))
    .limit(1)

  if (!row || row.status === 'succeeded' || row.status === 'failed') {
    return
  }

  const attempt = row.attemptCount + 1
  const timestamp = new Date().toISOString()
  const signedPayload = `${timestamp}.${row.payload}`
  const signature = await signPayload(row.secret, signedPayload)

  try {
    const response = await fetch(row.targetUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-clankr-event-id': row.eventId,
        'x-clankr-event-type': row.eventType,
        'x-clankr-timestamp': timestamp,
        'x-clankr-signature': signature,
      },
      body: row.payload,
    })

    if (response.ok) {
      await db
        .update(webhookDelivery)
        .set({
          attemptCount: attempt,
          status: 'succeeded',
          deliveredAt: new Date(),
          lastResponseStatus: response.status,
          nextAttemptAt: null,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(webhookDelivery.id, row.id))
      return
    }

    const nextDelay = WEBHOOK_RETRY_DELAYS_MS[attempt - 1]
    const retryable = attempt < MAX_WEBHOOK_ATTEMPTS && typeof nextDelay === 'number'

    await db
      .update(webhookDelivery)
      .set({
        attemptCount: attempt,
        status: retryable ? 'retrying' : 'failed',
        lastResponseStatus: response.status,
        lastError: `HTTP ${response.status}`,
        nextAttemptAt: retryable ? new Date(Date.now() + nextDelay) : null,
        updatedAt: new Date(),
      })
      .where(eq(webhookDelivery.id, row.id))
  } catch (error) {
    const nextDelay = WEBHOOK_RETRY_DELAYS_MS[attempt - 1]
    const retryable = attempt < MAX_WEBHOOK_ATTEMPTS && typeof nextDelay === 'number'
    const message = error instanceof Error ? error.message : 'Unknown network error'

    await db
      .update(webhookDelivery)
      .set({
        attemptCount: attempt,
        status: retryable ? 'retrying' : 'failed',
        lastError: message,
        nextAttemptAt: retryable ? new Date(Date.now() + nextDelay) : null,
        updatedAt: new Date(),
      })
      .where(eq(webhookDelivery.id, row.id))
  }
}

async function parseInboundMessage(
  message: ForwardableEmailMessageLike,
  inboxId: string,
): Promise<InboundParsedEmail> {
  const rawBuffer = await new Response(message.raw).arrayBuffer()
  const parsed = (await PostalMime.parse(rawBuffer, {
    attachmentEncoding: 'base64',
  })) as ParsedEmailObject

  const messageIdHeader = message.headers.get('message-id')
  const inReplyToHeader = message.headers.get('in-reply-to')
  const referencesHeader = message.headers.get('references')

  const fromAddress =
    parseAddressLike(parsed.from)[0] ?? parseAddressLike(message.headers.get('from'))[0]

  const toAddress = parseAddressLike(parsed.to)[0] ?? message.to.toLowerCase()
  const ccAddresses = parseAddressLike(parsed.cc)
  const bccAddresses = parseAddressLike(parsed.bcc)
  const subject = typeof parsed.subject === 'string' ? parsed.subject : ''
  const textBody = typeof parsed.text === 'string' ? parsed.text : null
  const htmlBody = typeof parsed.html === 'string' ? parsed.html : null
  const internetMessageId =
    (typeof parsed.messageId === 'string' ? parsed.messageId : null) ?? messageIdHeader
  const inReplyTo =
    (typeof parsed.inReplyTo === 'string' ? parsed.inReplyTo : null) ?? inReplyToHeader

  const parsedReferences =
    Array.isArray(parsed.references) && parsed.references.length
      ? parsed.references.filter(
          (reference): reference is string => typeof reference === 'string',
        )
      : typeof parsed.references === 'string'
        ? parsed.references.split(/\s+/).filter(Boolean)
        : referencesHeader?.split(/\s+/).filter(Boolean) ?? []

  const rawEmailR2Key = await storeRawEmail(inboxId, rawBuffer)
  const attachments = await storeAttachments(
    inboxId,
    parsed.attachments,
    internetMessageId ?? createId('raw'),
  )

  return {
    fromAddress: fromAddress ?? message.from.toLowerCase(),
    toAddress,
    ccAddresses,
    bccAddresses,
    subject,
    textBody,
    htmlBody,
    snippet: toSnippet(textBody, htmlBody),
    internetMessageId,
    inReplyTo,
    references: parsedReferences,
    rawSize: message.rawSize,
    rawEmailR2Key,
    attachments,
    headers: normalizeHeaders(message.headers),
    receivedAt: new Date(),
  }
}

async function storeRawEmail(
  inboxId: string,
  rawBuffer: ArrayBuffer,
): Promise<string | null> {
  const bucket = getBindings().EMAIL_RAW_BUCKET
  if (!bucket) {
    return null
  }

  const key = `raw/${inboxId}/${new Date().toISOString()}/${createId('msg')}.eml`
  await bucket.put(key, rawBuffer, {
    httpMetadata: {
      contentType: 'message/rfc822',
    },
  })
  return key
}

async function storeAttachments(
  inboxId: string,
  unknownAttachments: unknown,
  messageToken: string,
): Promise<InboundParsedEmail['attachments']> {
  if (!Array.isArray(unknownAttachments)) {
    return []
  }

  const bucket = getBindings().EMAIL_RAW_BUCKET
  const attachments: InboundParsedEmail['attachments'] = []
  let attachmentIndex = 0

  for (const unknownAttachment of unknownAttachments) {
    const attachment = unknownAttachment as ParsedAttachment
    const filename = attachment.filename ?? `attachment-${attachmentIndex + 1}`
    const mimeType = attachment.mimeType ?? 'application/octet-stream'
    const contentId =
      typeof attachment.contentId === 'string' ? attachment.contentId : null
    const disposition = attachment.disposition ?? 'attachment'
    const rawContent = attachment.content

    let size = 0
    let r2Key: string | null = null

    if (typeof rawContent === 'string') {
      size = rawContent.length
      if (bucket) {
        r2Key = `attachments/${inboxId}/${messageToken}/${attachmentIndex}-${filename}`
        await bucket.put(r2Key, rawContent, {
          httpMetadata: {
            contentType: mimeType,
          },
        })
      }
    } else if (rawContent instanceof ArrayBuffer) {
      size = rawContent.byteLength
      if (bucket) {
        r2Key = `attachments/${inboxId}/${messageToken}/${attachmentIndex}-${filename}`
        await bucket.put(r2Key, rawContent, {
          httpMetadata: {
            contentType: mimeType,
          },
        })
      }
    } else if (ArrayBuffer.isView(rawContent)) {
      size = rawContent.byteLength
      if (bucket) {
        r2Key = `attachments/${inboxId}/${messageToken}/${attachmentIndex}-${filename}`
        await bucket.put(r2Key, rawContent, {
          httpMetadata: {
            contentType: mimeType,
          },
        })
      }
    }

    attachments.push({
      filename,
      mimeType,
      contentId,
      disposition,
      r2Key,
      size,
    })
    attachmentIndex += 1
  }

  return attachments
}

async function resolveInboxByLocalPart(localPart: string) {
  const normalized = getPrimaryLocalPart(localPart)

  const [aliasMatch] = await db
    .select({
      id: inbox.id,
      canonicalLocalPart: inbox.canonicalLocalPart,
      userId: inbox.userId,
    })
    .from(inboxAlias)
    .innerJoin(inbox, eq(inbox.id, inboxAlias.inboxId))
    .where(eq(inboxAlias.localPart, normalized))
    .limit(1)

  if (aliasMatch) {
    return aliasMatch
  }

  const [canonicalMatch] = await db
    .select({
      id: inbox.id,
      canonicalLocalPart: inbox.canonicalLocalPart,
      userId: inbox.userId,
    })
    .from(inbox)
    .where(eq(inbox.canonicalLocalPart, normalized))
    .limit(1)

  return canonicalMatch ?? null
}

async function findThreadForInbound(
  inboxId: string,
  subject: string,
  inReplyTo: string | null,
  references: string[],
) {
  const candidateMessageIds = [inReplyTo, ...references]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .slice(0, 20)

  if (candidateMessageIds.length > 0) {
    const [matchedMessage] = await db
      .select({ threadId: emailMessage.threadId })
      .from(emailMessage)
      .where(
        and(
          eq(emailMessage.inboxId, inboxId),
          inArray(emailMessage.internetMessageId, candidateMessageIds),
        ),
      )
      .orderBy(desc(emailMessage.createdAt))
      .limit(1)

    if (matchedMessage) {
      const [thread] = await db
        .select()
        .from(emailThread)
        .where(eq(emailThread.id, matchedMessage.threadId))
        .limit(1)

      if (thread) {
        return thread
      }
    }
  }

  const normalizedSubject = normalizeSubject(subject)
  const [subjectMatch] = await db
    .select()
    .from(emailThread)
    .where(
      and(
        eq(emailThread.inboxId, inboxId),
        eq(emailThread.normalizedSubject, normalizedSubject),
      ),
    )
    .orderBy(desc(emailThread.lastMessageAt))
    .limit(1)

  if (subjectMatch) {
    return subjectMatch
  }

  const threadId = createId('thr')
  const createdAt = new Date()
  await db.insert(emailThread).values({
    id: threadId,
    inboxId,
    subject: subject || '(no subject)',
    normalizedSubject,
    status: 'open',
    lastMessageAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  })

  const [thread] = await db
    .select()
    .from(emailThread)
    .where(eq(emailThread.id, threadId))
    .limit(1)

  if (!thread) {
    throw new Error('Unable to create email thread')
  }

  return thread
}

async function getInboxFromAddress(inboxId: string): Promise<string> {
  const [row] = await db
    .select({ canonical: inbox.canonicalLocalPart })
    .from(inbox)
    .where(eq(inbox.id, inboxId))
    .limit(1)

  if (!row) {
    throw new Error('Inbox not found')
  }

  const [alias] = await db
    .select({ localPart: inboxAlias.localPart })
    .from(inboxAlias)
    .where(eq(inboxAlias.inboxId, inboxId))
    .orderBy(inboxAlias.createdAt)
    .limit(1)

  return buildInboxEmail(alias?.localPart ?? row.canonical)
}

export async function createInboxForUser(
  userId: string,
  customLocalPart?: string,
): Promise<InboxSummary> {
  let normalizedCustomLocalPart: string | null = null
  if (customLocalPart) {
    normalizedCustomLocalPart = normalizeLocalPart(customLocalPart)
    if (!normalizedCustomLocalPart) {
      throw new Error('Invalid custom_name. Use only letters, digits, dots, underscores, or dashes.')
    }

    await ensureAliasAvailable(normalizedCustomLocalPart)
  }

  const inboxId = createId('ibx')
  const createdAt = new Date()

  await db.insert(inbox).values({
    id: inboxId,
    userId,
    canonicalLocalPart: inboxId,
    createdAt,
    updatedAt: createdAt,
  })

  if (normalizedCustomLocalPart) {
    await db.insert(inboxAlias).values({
      id: createId('als'),
      inboxId,
      localPart: normalizedCustomLocalPart,
      createdAt,
      updatedAt: createdAt,
    })
  }

  const aliases = await getInboxAliases([inboxId])

  return {
    id: inboxId,
    canonicalEmail: buildInboxEmail(inboxId),
    aliases: aliases.get(inboxId) ?? [],
    createdAt,
  }
}

export async function listInboxesForUser(userId: string): Promise<InboxSummary[]> {
  const inboxes = await db
    .select()
    .from(inbox)
    .where(eq(inbox.userId, userId))
    .orderBy(desc(inbox.createdAt))

  const aliases = await getInboxAliases(inboxes.map((entry) => entry.id))

  return inboxes.map((entry) => ({
    id: entry.id,
    canonicalEmail: buildInboxEmail(entry.canonicalLocalPart),
    aliases: aliases.get(entry.id) ?? [],
    createdAt: entry.createdAt,
  }))
}

export async function claimAliasForInbox(
  userId: string,
  inboxId: string,
  localPart: string,
): Promise<{ email: string }> {
  const [ownedInbox] = await db
    .select({ id: inbox.id })
    .from(inbox)
    .where(and(eq(inbox.id, inboxId), eq(inbox.userId, userId)))
    .limit(1)

  if (!ownedInbox) {
    throw new Error('Inbox not found')
  }

  const normalized = normalizeLocalPart(localPart)
  if (!normalized) {
    throw new Error('Invalid custom_name. Use only letters, digits, dots, underscores, or dashes.')
  }

  await ensureAliasAvailable(normalized)

  const createdAt = new Date()
  await db.insert(inboxAlias).values({
    id: createId('als'),
    inboxId,
    localPart: normalized,
    createdAt,
    updatedAt: createdAt,
  })

  return {
    email: buildInboxEmail(normalized),
  }
}

export async function listThreadsForInbox(
  userId: string,
  inboxId: string,
  limit = 50,
) {
  const [ownedInbox] = await db
    .select({ id: inbox.id })
    .from(inbox)
    .where(and(eq(inbox.id, inboxId), eq(inbox.userId, userId)))
    .limit(1)

  if (!ownedInbox) {
    throw new Error('Inbox not found')
  }

  const threads = await db
    .select()
    .from(emailThread)
    .where(eq(emailThread.inboxId, inboxId))
    .orderBy(desc(emailThread.lastMessageAt))
    .limit(Math.max(1, Math.min(limit, 100)))

  return threads
}

export async function listMessagesForThread(
  userId: string,
  threadId: string,
  limit = 100,
) {
  const [thread] = await db
    .select({
      id: emailThread.id,
      inboxId: emailThread.inboxId,
      userId: inbox.userId,
    })
    .from(emailThread)
    .innerJoin(inbox, eq(inbox.id, emailThread.inboxId))
    .where(eq(emailThread.id, threadId))
    .limit(1)

  if (!thread || thread.userId !== userId) {
    throw new Error('Thread not found')
  }

  const messages = await db
    .select()
    .from(emailMessage)
    .where(eq(emailMessage.threadId, threadId))
    .orderBy(emailMessage.createdAt)
    .limit(Math.max(1, Math.min(limit, 250)))

  return messages.map((message) => ({
    ...message,
    ccAddresses: parseStringArray(message.ccAddresses),
    bccAddresses: parseStringArray(message.bccAddresses),
    references: parseStringArray(message.references),
    headers: parseStringRecord(message.headers),
  }))
}

export async function sendEmailFromInbox(options: {
  userId: string
  inboxId: string
  to: string
  subject: string
  text?: string
  html?: string
  threadId?: string
  replyToMessageId?: string
}): Promise<{ messageId: string; threadId: string }> {
  const [ownedInbox] = await db
    .select({ id: inbox.id })
    .from(inbox)
    .where(and(eq(inbox.id, options.inboxId), eq(inbox.userId, options.userId)))
    .limit(1)

  if (!ownedInbox) {
    throw new Error('Inbox not found')
  }

  const [suppressed] = await db
    .select({ id: suppressionEntry.id })
    .from(suppressionEntry)
    .where(eq(suppressionEntry.email, options.to.toLowerCase()))
    .limit(1)

  if (suppressed) {
    throw new Error('Recipient is suppressed because of previous delivery issues')
  }

  const emailBinding = getBindings().EMAIL
  if (!emailBinding) {
    throw new Error('EMAIL binding is not configured')
  }

  const threadId = options.threadId ?? createId('thr')
  const [thread] = await db
    .select()
    .from(emailThread)
    .where(eq(emailThread.id, threadId))
    .limit(1)

  if (thread && thread.inboxId !== options.inboxId) {
    throw new Error('Thread does not belong to this inbox')
  }

  if (!thread) {
    const now = new Date()
    await db.insert(emailThread).values({
      id: threadId,
      inboxId: options.inboxId,
      subject: options.subject,
      normalizedSubject: normalizeSubject(options.subject),
      status: 'open',
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    })
  }

  const fromAddress = await getInboxFromAddress(options.inboxId)
  const internetMessageId = `<${createId('msg')}@${EMAIL_DOMAIN}>`
  const referenceHeaderValues = [options.replyToMessageId].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )

  const headers: Record<string, string> = {
    'Message-ID': internetMessageId,
  }

  if (referenceHeaderValues.length) {
    headers['In-Reply-To'] = referenceHeaderValues[0]
    headers['References'] = referenceHeaderValues.join(' ')
  }

  const response = await emailBinding.send({
    to: options.to,
    from: fromAddress,
    subject: options.subject,
    text: options.text,
    html: options.html,
    headers,
  })

  const createdAt = new Date()
  const messageId = createId('msg')
  await db.insert(emailMessage).values({
    id: messageId,
    threadId,
    inboxId: options.inboxId,
    direction: 'outbound',
    providerMessageId: response.messageId,
    internetMessageId,
    fromAddress,
    toAddress: options.to.toLowerCase(),
    ccAddresses: JSON.stringify([]),
    bccAddresses: JSON.stringify([]),
    subject: options.subject,
    textBody: options.text ?? null,
    htmlBody: options.html ?? null,
    snippet: toSnippet(options.text ?? null, options.html ?? null),
    inReplyTo: options.replyToMessageId ?? null,
    references: JSON.stringify(referenceHeaderValues),
    headers: JSON.stringify(headers),
    rawSize: 0,
    deliveryStatus: response.success ? 'sent' : 'failed',
    sentAt: createdAt,
    createdAt,
  })

  await db
    .update(emailThread)
    .set({
      lastMessageAt: createdAt,
      subject: options.subject,
      normalizedSubject: normalizeSubject(options.subject),
      updatedAt: createdAt,
    })
    .where(eq(emailThread.id, threadId))

  await dispatchEvent({
    type: response.success ? 'message.sent' : 'message.failed',
    inboxId: options.inboxId,
    threadId,
    messageId,
    data: {
      to: options.to,
      subject: options.subject,
      providerMessageId: response.messageId,
    },
  })

  return {
    messageId,
    threadId,
  }
}

export async function replyToThread(options: {
  userId: string
  threadId: string
  text?: string
  html?: string
  subject?: string
}): Promise<{ messageId: string; threadId: string }> {
  const [thread] = await db
    .select({
      id: emailThread.id,
      inboxId: emailThread.inboxId,
      subject: emailThread.subject,
      userId: inbox.userId,
    })
    .from(emailThread)
    .innerJoin(inbox, eq(inbox.id, emailThread.inboxId))
    .where(eq(emailThread.id, options.threadId))
    .limit(1)

  if (!thread || thread.userId !== options.userId) {
    throw new Error('Thread not found')
  }

  const [latestInbound] = await db
    .select({
      fromAddress: emailMessage.fromAddress,
      internetMessageId: emailMessage.internetMessageId,
    })
    .from(emailMessage)
    .where(
      and(
        eq(emailMessage.threadId, options.threadId),
        eq(emailMessage.direction, 'inbound'),
      ),
    )
    .orderBy(desc(emailMessage.createdAt))
    .limit(1)

  if (!latestInbound) {
    throw new Error('No inbound message found in thread')
  }

  const subject =
    options.subject ??
    (thread.subject.toLowerCase().startsWith('re:')
      ? thread.subject
      : `Re: ${thread.subject}`)

  return sendEmailFromInbox({
    userId: options.userId,
    inboxId: thread.inboxId,
    to: latestInbound.fromAddress,
    subject,
    text: options.text,
    html: options.html,
    threadId: options.threadId,
    replyToMessageId: latestInbound.internetMessageId ?? undefined,
  })
}

export async function handleInboundEmail(
  message: ForwardableEmailMessageLike,
): Promise<void> {
  const recipientLocalPart = getPrimaryLocalPart(extractLocalPart(message.to))
  const resolvedInbox = await resolveInboxByLocalPart(recipientLocalPart)

  if (!resolvedInbox) {
    message.setReject('Unknown inbox address')
    return
  }

  const parsed = await parseInboundMessage(message, resolvedInbox.id)
  const thread = await findThreadForInbound(
    resolvedInbox.id,
    parsed.subject,
    parsed.inReplyTo,
    parsed.references,
  )

  const messageId = createId('msg')
  await db.insert(emailMessage).values({
    id: messageId,
    threadId: thread.id,
    inboxId: resolvedInbox.id,
    direction: 'inbound',
    providerMessageId: null,
    internetMessageId: parsed.internetMessageId,
    fromAddress: parsed.fromAddress,
    toAddress: parsed.toAddress,
    ccAddresses: JSON.stringify(parsed.ccAddresses),
    bccAddresses: JSON.stringify(parsed.bccAddresses),
    subject: parsed.subject || '(no subject)',
    textBody: parsed.textBody,
    htmlBody: parsed.htmlBody,
    snippet: parsed.snippet,
    inReplyTo: parsed.inReplyTo,
    references: JSON.stringify(parsed.references),
    headers: JSON.stringify(parsed.headers),
    rawEmailR2Key: parsed.rawEmailR2Key,
    rawSize: parsed.rawSize,
    deliveryStatus: 'received',
    receivedAt: parsed.receivedAt,
    createdAt: parsed.receivedAt,
  })

  for (const attachment of parsed.attachments) {
    await db.insert(emailAttachment).values({
      id: createId('att'),
      messageId,
      inboxId: resolvedInbox.id,
      filename: attachment.filename,
      contentType: attachment.mimeType,
      size: attachment.size,
      disposition: attachment.disposition,
      contentId: attachment.contentId,
      r2Key: attachment.r2Key,
      createdAt: parsed.receivedAt,
    })
  }

  await db
    .update(emailThread)
    .set({
      lastMessageAt: parsed.receivedAt,
      subject: parsed.subject || thread.subject,
      normalizedSubject: normalizeSubject(parsed.subject || thread.subject),
      status: 'open',
      updatedAt: parsed.receivedAt,
    })
    .where(eq(emailThread.id, thread.id))

  await dispatchEvent({
    type: 'message.received',
    inboxId: resolvedInbox.id,
    threadId: thread.id,
    messageId,
    data: {
      from: parsed.fromAddress,
      to: parsed.toAddress,
      subject: parsed.subject,
      snippet: parsed.snippet,
    },
  })

  await dispatchEvent({
    type: 'thread.updated',
    inboxId: resolvedInbox.id,
    threadId: thread.id,
    messageId,
    data: {
      status: 'open',
      lastMessageAt: parsed.receivedAt.toISOString(),
    },
  })
}

export async function createWebhookSubscription(options: {
  userId: string
  targetUrl: string
  inboxId?: string
  events?: EmailEventType[]
}) {
  if (options.inboxId) {
    const [ownedInbox] = await db
      .select({ id: inbox.id })
      .from(inbox)
      .where(and(eq(inbox.id, options.inboxId), eq(inbox.userId, options.userId)))
      .limit(1)

    if (!ownedInbox) {
      throw new Error('Inbox not found')
    }
  }

  const id = createId('whs')
  const createdAt = new Date()
  const events = options.events?.length ? options.events : ['*']
  const secret = createSecret()

  await db.insert(webhookSubscription).values({
    id,
    userId: options.userId,
    inboxId: options.inboxId ?? null,
    targetUrl: options.targetUrl,
    secret,
    events: JSON.stringify(events),
    isActive: true,
    createdAt,
    updatedAt: createdAt,
  })

  return {
    id,
    targetUrl: options.targetUrl,
    inboxId: options.inboxId ?? null,
    events,
    secret,
    createdAt,
  }
}

export async function listWebhookSubscriptions(userId: string) {
  const rows = await db
    .select()
    .from(webhookSubscription)
    .where(eq(webhookSubscription.userId, userId))
    .orderBy(desc(webhookSubscription.createdAt))

  return rows.map((row) => ({
    id: row.id,
    targetUrl: row.targetUrl,
    inboxId: row.inboxId,
    events: parseEventList(row.events),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

export async function deleteWebhookSubscription(
  userId: string,
  subscriptionId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: webhookSubscription.id })
    .from(webhookSubscription)
    .where(
      and(
        eq(webhookSubscription.id, subscriptionId),
        eq(webhookSubscription.userId, userId),
      ),
    )
    .limit(1)

  if (!row) {
    throw new Error('Subscription not found')
  }

  await db
    .update(webhookSubscription)
    .set({
      isActive: false,
      updatedAt: new Date(),
    })
    .where(eq(webhookSubscription.id, subscriptionId))
}

export async function retryDueWebhookDeliveries(limit = 50): Promise<number> {
  const rows = await db
    .select({ id: webhookDelivery.id })
    .from(webhookDelivery)
    .where(
      and(
        eq(webhookDelivery.status, 'retrying'),
        lte(webhookDelivery.nextAttemptAt, new Date()),
      ),
    )
    .orderBy(webhookDelivery.nextAttemptAt)
    .limit(Math.max(1, Math.min(limit, 200)))

  for (const row of rows) {
    await attemptWebhookDelivery(row.id)
  }

  return rows.length
}
