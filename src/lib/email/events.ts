import { createEventId } from './ids'

export const EMAIL_EVENT_TYPES = {
  messageReceived: 'message.received',
  messageSentAccepted: 'message.sent.accepted',
  messageSentFailed: 'message.sent.failed',
} as const

export type MessageReceivedEvent = {
  id: string
  type: (typeof EMAIL_EVENT_TYPES)['messageReceived']
  createdAt: string
  data: {
    inboxId: string
    threadId: string
    messageId: string
  }
}

export type MessageSentAcceptedEvent = {
  id: string
  type: (typeof EMAIL_EVENT_TYPES)['messageSentAccepted']
  createdAt: string
  data: {
    inboxId: string
    threadId: string
    messageId: string
    providerMessageId: string
  }
}

export type MessageSentFailedEvent = {
  id: string
  type: (typeof EMAIL_EVENT_TYPES)['messageSentFailed']
  createdAt: string
  data: {
    inboxId: string
    threadId: string
    messageId: string
    errorCode: string
  }
}

export type EmailEvent = MessageReceivedEvent | MessageSentAcceptedEvent | MessageSentFailedEvent

export function createMessageReceivedEvent(
  data: MessageReceivedEvent['data'],
  createdAt = new Date(),
): MessageReceivedEvent {
  return {
    id: createEventId(),
    type: EMAIL_EVENT_TYPES.messageReceived,
    createdAt: createdAt.toISOString(),
    data,
  }
}

export function createMessageSentAcceptedEvent(
  data: MessageSentAcceptedEvent['data'],
  createdAt = new Date(),
): MessageSentAcceptedEvent {
  return {
    id: createEventId(),
    type: EMAIL_EVENT_TYPES.messageSentAccepted,
    createdAt: createdAt.toISOString(),
    data,
  }
}

export function createMessageSentFailedEvent(
  data: MessageSentFailedEvent['data'],
  createdAt = new Date(),
): MessageSentFailedEvent {
  return {
    id: createEventId(),
    type: EMAIL_EVENT_TYPES.messageSentFailed,
    createdAt: createdAt.toISOString(),
    data,
  }
}
