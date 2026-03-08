import { monotonicFactory } from 'ulid'

const createUlid = monotonicFactory()

export const ENTITY_PREFIXES = {
  apiKey: 'ak',
  event: 'evt',
  inbox: 'in',
  message: 'em',
  thread: 'th',
  webhookDelivery: 'wd',
  webhookSubscription: 'wh',
} as const

export type EntityPrefix = (typeof ENTITY_PREFIXES)[keyof typeof ENTITY_PREFIXES]

export function createPrefixedId(prefix: EntityPrefix) {
  return `${prefix}_${createUlid().toLowerCase()}`
}

export function createInboxId() {
  return createPrefixedId(ENTITY_PREFIXES.inbox)
}

export function createApiKeyId() {
  return createPrefixedId(ENTITY_PREFIXES.apiKey)
}

export function createThreadId() {
  return createPrefixedId(ENTITY_PREFIXES.thread)
}

export function createMessageId() {
  return createPrefixedId(ENTITY_PREFIXES.message)
}

export function createWebhookSubscriptionId() {
  return createPrefixedId(ENTITY_PREFIXES.webhookSubscription)
}

export function createWebhookDeliveryId() {
  return createPrefixedId(ENTITY_PREFIXES.webhookDelivery)
}

export function createEventId() {
  return createPrefixedId(ENTITY_PREFIXES.event)
}
