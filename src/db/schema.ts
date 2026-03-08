import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export * from './auth-schema.ts'

const TIMESTAMP_NOW_SQL = sql`(cast(unixepoch('subsecond') * 1000 as integer))`

const createdAtColumn = (name: string) =>
  integer(name, { mode: 'timestamp_ms' }).default(TIMESTAMP_NOW_SQL).notNull()

const updatedAtColumn = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })
    .default(TIMESTAMP_NOW_SQL)
    .$onUpdate(() => new Date())
    .notNull()

export const inboxes = sqliteTable(
  'inboxes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    defaultLocalPart: text('default_local_part').notNull(),
    customLocalPart: text('custom_local_part'),
    isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
    createdAt: createdAtColumn('created_at'),
    updatedAt: updatedAtColumn('updated_at'),
  },
  (table) => [
    index('inboxes_user_id_idx').on(table.userId),
    uniqueIndex('inboxes_default_local_part_unique').on(table.defaultLocalPart),
    uniqueIndex('inboxes_custom_local_part_unique').on(table.customLocalPart),
  ],
)

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    lastFour: text('last_four').notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: createdAtColumn('created_at'),
    updatedAt: updatedAtColumn('updated_at'),
  },
  (table) => [
    index('api_keys_user_id_idx').on(table.userId),
    uniqueIndex('api_keys_key_prefix_unique').on(table.keyPrefix),
  ],
)

export const emailThreads = sqliteTable(
  'email_threads',
  {
    id: text('id').primaryKey(),
    inboxId: text('inbox_id').notNull(),
    subjectNormalized: text('subject_normalized').notNull(),
    participantHash: text('participant_hash').notNull(),
    lastMessageAt: integer('last_message_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAtColumn('created_at'),
    updatedAt: updatedAtColumn('updated_at'),
  },
  (table) => [
    index('email_threads_inbox_id_idx').on(table.inboxId),
    index('email_threads_last_message_at_idx').on(table.lastMessageAt),
  ],
)

export const emailMessages = sqliteTable(
  'email_messages',
  {
    id: text('id').primaryKey(),
    inboxId: text('inbox_id').notNull(),
    threadId: text('thread_id').notNull(),
    direction: text('direction').notNull(),
    providerMessageId: text('provider_message_id'),
    internetMessageId: text('internet_message_id'),
    fromEmail: text('from_email').notNull(),
    toEmailsJson: text('to_emails_json').default('[]').notNull(),
    ccEmailsJson: text('cc_emails_json').default('[]').notNull(),
    bccEmailsJson: text('bcc_emails_json').default('[]').notNull(),
    subject: text('subject').notNull(),
    snippet: text('snippet').default('').notNull(),
    textBody: text('text_body'),
    htmlBody: text('html_body'),
    bodyStorageMode: text('body_storage_mode').default('inline').notNull(),
    rawMimeR2Key: text('raw_mime_r2_key'),
    oversizedBodyR2Key: text('oversized_body_r2_key'),
    bodySizeBytes: integer('body_size_bytes'),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }),
    createdAt: createdAtColumn('created_at'),
  },
  (table) => [
    index('email_messages_inbox_id_idx').on(table.inboxId),
    index('email_messages_thread_id_idx').on(table.threadId),
    index('email_messages_provider_message_id_idx').on(table.providerMessageId),
    index('email_messages_internet_message_id_idx').on(table.internetMessageId),
  ],
)

export const webhookSubscriptions = sqliteTable(
  'webhook_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    inboxId: text('inbox_id'),
    url: text('url').notNull(),
    secret: text('secret').notNull(),
    eventTypesJson: text('event_types_json').default('[]').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).default(true).notNull(),
    createdAt: createdAtColumn('created_at'),
    updatedAt: updatedAtColumn('updated_at'),
  },
  (table) => [
    index('webhook_subscriptions_user_id_idx').on(table.userId),
    index('webhook_subscriptions_inbox_id_idx').on(table.inboxId),
  ],
)

export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    subscriptionId: text('subscription_id').notNull(),
    eventId: text('event_id').notNull(),
    attempt: integer('attempt').notNull(),
    status: text('status').notNull(),
    responseStatus: integer('response_status'),
    nextRetryAt: integer('next_retry_at', { mode: 'timestamp_ms' }),
    createdAt: createdAtColumn('created_at'),
    updatedAt: updatedAtColumn('updated_at'),
  },
  (table) => [
    index('webhook_deliveries_subscription_id_idx').on(table.subscriptionId),
    index('webhook_deliveries_event_id_idx').on(table.eventId),
    index('webhook_deliveries_next_retry_at_idx').on(table.nextRetryAt),
  ],
)
