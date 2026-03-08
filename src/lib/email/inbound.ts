import { and, desc, eq, inArray } from 'drizzle-orm'
import PostalMime, { addressParser, type Address, type Email, type RawEmail } from 'postal-mime'

import type { ClankrEmailEnv, EmailWorkerMessage } from '#/lib/cloudflare'
import { createDb } from '#/db/index'
import { emailMessages, emailThreads } from '#/db/schema'

import { createMessageReceivedEvent } from './events'
import { createMessageId, createThreadId } from './ids'
import { findInboxByLocalPart } from './inboxes'

const THREAD_SUBJECT_PREFIX_PATTERN = /^(?:\s*(?:re|fw|fwd)\s*:\s*)+/i
const MESSAGE_ID_PATTERN = /<[^>]+>/g

export const INLINE_BODY_LIMIT_BYTES = 48_000

export type InboundEmailResult =
  | {
      status: 'accepted'
      inboxId: string
      messageId: string
      threadId: string
    }
  | {
      status: 'duplicate'
      inboxId: string
      messageId: string
      threadId: string
    }
  | {
      status: 'rejected'
      reason: 'invalid-recipient' | 'unknown-inbox'
    }

type ThreadLookupDatabase = Pick<ReturnType<typeof createDb>, 'select'>

export async function handleInboundEmail(
  message: EmailWorkerMessage,
  env: ClankrEmailEnv,
): Promise<InboundEmailResult> {
  const localPart = getLocalPart(message.to)

  if (!localPart) {
    message.setReject('Unknown inbox')

    return {
      status: 'rejected',
      reason: 'invalid-recipient',
    }
  }

  const db = createDb(env.APP_DB)
  const inbox = await findInboxByLocalPart(db, localPart)

  if (!inbox) {
    message.setReject('Unknown inbox')

    return {
      status: 'rejected',
      reason: 'unknown-inbox',
    }
  }

  const rawEmail = await readRawEmail(message.raw)
  const parsedEmail = await PostalMime.parse(rawEmail)
  const internetMessageId = normalizeMessageId(parsedEmail.messageId)

  if (internetMessageId) {
    const [existingMessage] = await db
      .select({
        id: emailMessages.id,
        threadId: emailMessages.threadId,
      })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.inboxId, inbox.id),
          eq(emailMessages.internetMessageId, internetMessageId),
        ),
      )
      .limit(1)

    if (existingMessage) {
      return {
        status: 'duplicate',
        inboxId: inbox.id,
        messageId: existingMessage.id,
        threadId: existingMessage.threadId,
      }
    }
  }

  const messageId = createMessageId()
  const receivedAt = getReceivedAt(parsedEmail)
  const subject = normalizeSubject(parsedEmail.subject)
  const normalizedSubject = normalizeThreadSubject(subject)
  const fromEmail = getPrimaryAddress(parsedEmail.from) ?? message.from.trim().toLowerCase()
  const toEmails = normalizeAddressList(parsedEmail.to, message.to)
  const ccEmails = normalizeAddressList(parsedEmail.cc)
  const participantHash = await createParticipantHash([fromEmail, ...toEmails, ...ccEmails])
  const rawMimeKey = `raw/${inbox.id}/${messageId}.eml`
  const bodyStorage = buildBodyStorage(messageId, parsedEmail.text, parsedEmail.html)

  await env.EMAIL_STORAGE.put(rawMimeKey, rawEmail)

  if (bodyStorage.oversizedBodyR2Key) {
    await env.EMAIL_STORAGE.put(
      bodyStorage.oversizedBodyR2Key,
      JSON.stringify({
        htmlBody: parsedEmail.html ?? null,
        textBody: parsedEmail.text ?? null,
      }),
    )
  }

  const threadId = await db.transaction(async (tx) => {
    const existingThreadId = await findExistingThreadId(tx, {
      inboxId: inbox.id,
      internetMessageIds: collectThreadReferenceIds(parsedEmail),
      participantHash,
      subjectNormalized: normalizedSubject,
    })

    const nextThreadId = existingThreadId ?? createThreadId()

    if (!existingThreadId) {
      await tx.insert(emailThreads).values({
        id: nextThreadId,
        inboxId: inbox.id,
        subjectNormalized: normalizedSubject,
        participantHash,
        lastMessageAt: receivedAt,
      })
    } else {
      await tx
        .update(emailThreads)
        .set({ lastMessageAt: receivedAt })
        .where(eq(emailThreads.id, nextThreadId))
    }

    await tx.insert(emailMessages).values({
      id: messageId,
      inboxId: inbox.id,
      threadId: nextThreadId,
      direction: 'inbound',
      providerMessageId: null,
      internetMessageId,
      fromEmail,
      toEmailsJson: JSON.stringify(toEmails),
      ccEmailsJson: JSON.stringify(ccEmails),
      bccEmailsJson: JSON.stringify([]),
      subject,
      snippet: createSnippet(parsedEmail.text, parsedEmail.html),
      textBody: bodyStorage.textBody,
      htmlBody: bodyStorage.htmlBody,
      bodyStorageMode: bodyStorage.mode,
      rawMimeR2Key: rawMimeKey,
      oversizedBodyR2Key: bodyStorage.oversizedBodyR2Key,
      bodySizeBytes: bodyStorage.bodySizeBytes,
      status: 'received',
      errorCode: null,
      errorMessage: null,
      sentAt: null,
      receivedAt,
    })

    return nextThreadId
  })

  await env.EMAIL_EVENTS.send(
    createMessageReceivedEvent({
      inboxId: inbox.id,
      threadId,
      messageId,
    }),
  )

  return {
    status: 'accepted',
    inboxId: inbox.id,
    messageId,
    threadId,
  }
}

function getLocalPart(address: string) {
  const [parsedAddress] = addressParser(address, { flatten: true })
  const normalizedAddress = getPrimaryAddress(parsedAddress)

  if (!normalizedAddress) {
    return null
  }

  const atIndex = normalizedAddress.indexOf('@')

  if (atIndex <= 0) {
    return null
  }

  return normalizedAddress.slice(0, atIndex)
}

async function readRawEmail(rawEmail: RawEmail) {
  if (typeof rawEmail === 'string') {
    return new TextEncoder().encode(rawEmail).slice().buffer as ArrayBuffer
  }

  if (rawEmail instanceof ArrayBuffer) {
    return rawEmail
  }

  if (rawEmail instanceof Uint8Array) {
    return rawEmail.slice().buffer as ArrayBuffer
  }

  return new Response(rawEmail).arrayBuffer()
}

function getReceivedAt(parsedEmail: Email) {
  if (!parsedEmail.date) {
    return new Date()
  }

  const receivedAt = new Date(parsedEmail.date)

  if (Number.isNaN(receivedAt.valueOf())) {
    return new Date()
  }

  return receivedAt
}

function normalizeSubject(subject: string | undefined) {
  return subject?.trim() ?? ''
}

export function normalizeThreadSubject(subject: string) {
  return subject.replace(THREAD_SUBJECT_PREFIX_PATTERN, '').trim().toLowerCase()
}

function normalizeMessageId(messageId: string | undefined) {
  const normalizedMessageId = messageId?.trim()

  return normalizedMessageId ? normalizedMessageId.toLowerCase() : null
}

function collectThreadReferenceIds(parsedEmail: Email) {
  const messageIds = new Set<string>()

  for (const rawValue of [parsedEmail.inReplyTo, parsedEmail.references]) {
    if (!rawValue) {
      continue
    }

    for (const match of rawValue.matchAll(MESSAGE_ID_PATTERN)) {
      messageIds.add(match[0].toLowerCase())
    }
  }

  return [...messageIds]
}

function normalizeAddressList(addresses: Address[] | undefined, fallbackAddress?: string) {
  const normalizedAddresses = collectAddresses(addresses)

  if (normalizedAddresses.length > 0) {
    return normalizedAddresses
  }

  return fallbackAddress ? [fallbackAddress.trim().toLowerCase()] : []
}

function collectAddresses(addresses: Address[] | Address | undefined): string[] {
  const list = Array.isArray(addresses) ? addresses : addresses ? [addresses] : []
  const normalizedAddresses = new Set<string>()

  for (const entry of list) {
    if ('group' in entry && Array.isArray(entry.group)) {
      for (const member of entry.group) {
        const normalizedAddress = member.address.trim().toLowerCase()

        if (normalizedAddress) {
          normalizedAddresses.add(normalizedAddress)
        }
      }

      continue
    }

    if ('address' in entry && entry.address) {
      normalizedAddresses.add(entry.address.trim().toLowerCase())
    }
  }

  return [...normalizedAddresses]
}

function getPrimaryAddress(address: Address | undefined) {
  return collectAddresses(address)[0] ?? null
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

async function findExistingThreadId(
  tx: ThreadLookupDatabase,
  params: {
    inboxId: string
    internetMessageIds: string[]
    participantHash: string
    subjectNormalized: string
  },
) {
  const { inboxId, internetMessageIds, participantHash, subjectNormalized } = params

  if (internetMessageIds.length > 0) {
    const [replyMatch] = await tx
      .select({ threadId: emailMessages.threadId })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.inboxId, inboxId),
          inArray(emailMessages.internetMessageId, internetMessageIds),
        ),
      )
      .orderBy(desc(emailMessages.receivedAt), desc(emailMessages.createdAt))
      .limit(1)

    if (replyMatch) {
      return replyMatch.threadId
    }
  }

  const [fallbackThread] = await tx
    .select({ id: emailThreads.id })
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.inboxId, inboxId),
        eq(emailThreads.subjectNormalized, subjectNormalized),
        eq(emailThreads.participantHash, participantHash),
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt), desc(emailThreads.createdAt))
    .limit(1)

  return fallbackThread?.id ?? null
}

function buildBodyStorage(messageId: string, textBody: string | undefined, htmlBody: string | undefined) {
  const nextTextBody = textBody ?? null
  const nextHtmlBody = htmlBody ?? null
  const bodyPayload = JSON.stringify({
    htmlBody: nextHtmlBody,
    textBody: nextTextBody,
  })
  const bodySizeBytes = new TextEncoder().encode(bodyPayload).byteLength

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
