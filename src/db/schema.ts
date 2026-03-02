import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

import { user } from './auth-schema.ts'

export * from './auth-schema.ts'

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`

export const inbox = sqliteTable(
  'inbox',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    canonicalLocalPart: text('canonical_local_part').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('inbox_canonical_local_part_unique').on(table.canonicalLocalPart),
    index('inbox_user_id_idx').on(table.userId),
  ],
)

export const inboxAlias = sqliteTable(
  'inbox_alias',
  {
    id: text('id').primaryKey(),
    inboxId: text('inbox_id')
      .notNull()
      .references(() => inbox.id, { onDelete: 'cascade' }),
    localPart: text('local_part').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('inbox_alias_local_part_unique').on(table.localPart),
    index('inbox_alias_inbox_id_idx').on(table.inboxId),
  ],
)

export const emailThread = sqliteTable(
  'email_thread',
  {
    id: text('id').primaryKey(),
    inboxId: text('inbox_id')
      .notNull()
      .references(() => inbox.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    normalizedSubject: text('normalized_subject').notNull(),
    status: text('status').notNull().default('open'),
    lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('email_thread_inbox_id_idx').on(table.inboxId),
    index('email_thread_last_message_at_idx').on(table.lastMessageAt),
    index('email_thread_normalized_subject_idx').on(table.normalizedSubject),
  ],
)

export const emailMessage = sqliteTable(
  'email_message',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => emailThread.id, { onDelete: 'cascade' }),
    inboxId: text('inbox_id')
      .notNull()
      .references(() => inbox.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(),
    providerMessageId: text('provider_message_id'),
    internetMessageId: text('internet_message_id'),
    fromAddress: text('from_address').notNull(),
    toAddress: text('to_address').notNull(),
    ccAddresses: text('cc_addresses').notNull().default('[]'),
    bccAddresses: text('bcc_addresses').notNull().default('[]'),
    subject: text('subject').notNull(),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    snippet: text('snippet').notNull().default(''),
    inReplyTo: text('in_reply_to'),
    references: text('references').notNull().default('[]'),
    headers: text('headers').notNull().default('{}'),
    rawEmailR2Key: text('raw_email_r2_key'),
    rawSize: integer('raw_size').notNull().default(0),
    deliveryStatus: text('delivery_status').notNull().default('received'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .notNull(),
  },
  (table) => [
    index('email_message_thread_id_idx').on(table.threadId),
    index('email_message_inbox_id_idx').on(table.inboxId),
    index('email_message_created_at_idx').on(table.createdAt),
    index('email_message_internet_message_id_idx').on(table.internetMessageId),
  ],
)

export const emailAttachment = sqliteTable(
  'email_attachment',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => emailMessage.id, { onDelete: 'cascade' }),
    inboxId: text('inbox_id')
      .notNull()
      .references(() => inbox.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull().default(0),
    disposition: text('disposition').notNull().default('attachment'),
    contentId: text('content_id'),
    r2Key: text('r2_key'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .notNull(),
  },
  (table) => [
    index('email_attachment_message_id_idx').on(table.messageId),
    index('email_attachment_inbox_id_idx').on(table.inboxId),
  ],
)

export const webhookSubscription = sqliteTable(
  'webhook_subscription',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    inboxId: text('inbox_id').references(() => inbox.id, { onDelete: 'cascade' }),
    targetUrl: text('target_url').notNull(),
    secret: text('secret').notNull(),
    events: text('events').notNull().default('["*"]'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('webhook_subscription_user_id_idx').on(table.userId),
    index('webhook_subscription_inbox_id_idx').on(table.inboxId),
  ],
)

export const webhookDelivery = sqliteTable(
  'webhook_delivery',
  {
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => webhookSubscription.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    status: text('status').notNull().default('pending'),
    lastResponseStatus: integer('last_response_status'),
    lastError: text('last_error'),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }),
    deliveredAt: integer('delivered_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('webhook_delivery_subscription_id_idx').on(table.subscriptionId),
    index('webhook_delivery_next_attempt_at_idx').on(table.nextAttemptAt),
    index('webhook_delivery_status_idx').on(table.status),
    uniqueIndex('webhook_delivery_subscription_event_unique').on(
      table.subscriptionId,
      table.eventId,
    ),
  ],
)

export const emailEvent = sqliteTable(
  'email_event',
  {
    id: text('id').primaryKey(),
    inboxId: text('inbox_id').references(() => inbox.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').references(() => emailThread.id, {
      onDelete: 'cascade',
    }),
    messageId: text('message_id').references(() => emailMessage.id, {
      onDelete: 'cascade',
    }),
    eventType: text('event_type').notNull(),
    payload: text('payload').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .notNull(),
  },
  (table) => [
    index('email_event_inbox_id_idx').on(table.inboxId),
    index('email_event_event_type_idx').on(table.eventType),
    index('email_event_created_at_idx').on(table.createdAt),
  ],
)

export const suppressionEntry = sqliteTable(
  'suppression_entry',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    reason: text('reason').notNull(),
    source: text('source').notNull().default('manual'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex('suppression_entry_email_unique').on(table.email)],
)

export const todos = sqliteTable('todos', {
  id: integer({ mode: 'number' }).primaryKey({
    autoIncrement: true,
  }),
  title: text().notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
})
