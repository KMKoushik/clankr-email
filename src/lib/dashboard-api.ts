export type InboxRecord = {
  id: string
  userId: string
  defaultLocalPart: string
  customLocalPart: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ThreadSummary = {
  id: string
  inboxId: string
  latestMessageDirection: 'inbound' | 'outbound' | null
  latestMessageId: string | null
  createdAt: string
  fromEmail: string | null
  lastMessageAt: string
  messageCount: number
  snippet: string | null
  subject: string | null
  updatedAt: string
}

export type ListThreadsResult = {
  items: ThreadSummary[]
  nextCursor: {
    id: string
    lastMessageAt: string
  } | null
}

export type MessageSummary = {
  id: string
  inboxId: string
  threadId: string
  direction: 'inbound' | 'outbound'
  fromEmail: string
  toEmails: string[]
  ccEmails: string[]
  bccEmails: string[]
  subject: string
  snippet: string
  bodyStorageMode: 'inline' | 'oversized'
  bodySizeBytes: number | null
  status: 'pending' | 'received' | 'accepted' | 'failed' | 'rejected'
  errorCode: string | null
  errorMessage: string | null
  sentAt: string | null
  receivedAt: string | null
  createdAt: string
}

export type ListMessagesResult = {
  items: MessageSummary[]
  nextCursor: {
    id: string
  } | null
}

export type MessageDetail = MessageSummary & {
  internetMessageId: string | null
  providerMessageId: string | null
  rawMimeR2Key: string | null
  oversizedBodyR2Key: string | null
  textBody: string | null
  htmlBody: string | null
  bodyFetchStrategy: 'inline' | 'r2'
}

export type SendMessageInput = {
  inboxId: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text?: string
  html?: string
  replyToThreadId?: string
}

export type SendMessageResult = {
  id: string
  inboxId: string
  threadId: string
  providerMessageId: string | null
  status: 'accepted' | 'failed'
  errorCode: string | null
  errorMessage: string | null
  sentAt: string | null
}

export async function listInboxes() {
  return requestJson<InboxRecord[]>('/api/inboxes')
}

export async function createInbox() {
  return requestJson<InboxRecord>('/api/inboxes', {
    body: {},
    method: 'POST',
  })
}

export async function updateInboxAlias(inboxId: string, alias: string | null) {
  return requestJson<InboxRecord>(`/api/inboxes/${inboxId}/alias`, {
    body: { alias },
    method: 'PATCH',
  })
}

export async function listThreadsByInbox(inboxId: string) {
  return requestJson<ListThreadsResult>(`/api/inboxes/${inboxId}/threads?limit=25`)
}

export async function listThreadMessages(threadId: string) {
  return requestJson<ListMessagesResult>(`/api/threads/${threadId}/messages?limit=100`)
}

export async function getMessage(messageId: string) {
  return requestJson<MessageDetail>(`/api/messages/${messageId}`)
}

export async function sendMessage(input: SendMessageInput) {
  return requestJson<SendMessageResult>('/api/messages/send', {
    body: input,
    method: 'POST',
  })
}

async function requestJson<T>(path: string, init: RequestInitWithJsonBody = {}) {
  const headers = new Headers(init.headers)

  if (init.body !== undefined) {
    headers.set('content-type', 'application/json')
  }

  const response = await fetch(path, {
    ...init,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
    headers,
  })

  const payload = await parseResponsePayload(response)

  if (!response.ok) {
    throw new Error(extractErrorMessage(payload) ?? 'The request failed.')
  }

  return payload as T
}

async function parseResponsePayload(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()

  return text ? { message: text } : null
}

function extractErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  if ('message' in payload && typeof payload.message === 'string') {
    return payload.message
  }

  if (
    'error' in payload
    && payload.error
    && typeof payload.error === 'object'
    && 'message' in payload.error
    && typeof payload.error.message === 'string'
  ) {
    return payload.error.message
  }

  return null
}

type RequestInitWithJsonBody = Omit<RequestInit, 'body'> & {
  body?: unknown
}
