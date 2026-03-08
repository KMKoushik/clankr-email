import { createEventId } from './ids'

export const EMAIL_EVENT_TYPES = {
  messageReceived: 'message.received',
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

export type EmailEvent = MessageReceivedEvent

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
