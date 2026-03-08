import { readdirSync, readFileSync } from 'node:fs'

import Database from 'better-sqlite3'

import { createDb, type AppDb } from '#/db/index'
import { inboxes, user } from '#/db/schema'

import type { EmailEvent } from './events'

import { createInboxId } from './ids'
import { createDefaultInboxLocalPart } from './inboxes'

type StoredObject = {
  body: Uint8Array
}

type TestHarnessEnv = Pick<Env, 'APP_DB'> & {
  EMAIL: Pick<SendEmail, 'send'>
  EMAIL_EVENTS: Pick<Queue<EmailEvent>, 'send'>
  EMAIL_STORAGE: Pick<R2Bucket, 'put'>
}

export class TestQueue<T = unknown> {
  readonly sent: Array<{ body: T; options?: QueueSendOptions }> = []

  async send(body: T, options?: QueueSendOptions) {
    this.sent.push({ body, options })
  }
}

export class TestEmailBinding {
  readonly sent: unknown[] = []
  private nextError: unknown | null = null

  failWith(error: unknown) {
    this.nextError = error
  }

  async send(message: unknown) {
    this.sent.push(message)

    if (this.nextError) {
      const error = this.nextError
      this.nextError = null

      throw error
    }

    return {
      messageId: `test-email-${this.sent.length}`,
    }
  }
}

type TestR2ObjectBodyLike = Pick<R2ObjectBody, 'arrayBuffer' | 'text'>

class TestR2ObjectBody implements TestR2ObjectBodyLike {
  constructor(private readonly object: StoredObject) {}

  async arrayBuffer() {
    return this.object.body.slice().buffer as ArrayBuffer
  }

  async text() {
    return new TextDecoder().decode(this.object.body)
  }
}

export class TestR2Bucket {
  readonly objects = new Map<string, StoredObject>()

  async get(key: string) {
    const object = this.objects.get(key)

    return object ? new TestR2ObjectBody(object) : null
  }

  async put(key: string, value: Parameters<R2Bucket['put']>[1]) {
    if (value === null) {
      throw new Error('TestR2Bucket.put does not support null values.')
    }

    this.objects.set(key, {
      body: await toUint8Array(value),
    })

    return null as unknown as R2Object
  }
}

export class TestExecutionContext {
  readonly deferred: Promise<unknown>[] = []

  waitUntil(promise: Promise<unknown>) {
    this.deferred.push(promise)
  }
}

class TestD1PreparedStatement {
  constructor(
    private readonly sqlite: Database.Database,
    private readonly query: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new TestD1PreparedStatement(this.sqlite, this.query, params)
  }

  async run() {
    const statement = this.sqlite.prepare(this.query)
    const result = statement.run(...this.params)

    return {
      success: true,
      meta: {
        changes: result.changes,
        last_row_id: Number(result.lastInsertRowid),
      },
      results: [],
    }
  }

  async all() {
    const statement = this.sqlite.prepare(this.query)

    return {
      success: true,
      meta: {
        changes: 0,
        last_row_id: 0,
      },
      results: statement.all(...this.params),
    }
  }

  async raw() {
    return this.sqlite.prepare(this.query).raw(true).all(...this.params)
  }

  async executeForBatch() {
    if (isReadQuery(this.query)) {
      return this.all()
    }

    return this.run()
  }
}

class TestD1Database {
  constructor(private readonly sqlite: Database.Database) {}

  prepare(query: string) {
    return new TestD1PreparedStatement(this.sqlite, query)
  }

  async batch(statements: TestD1PreparedStatement[]) {
    return Promise.all(statements.map((statement) => statement.executeForBatch()))
  }

  async exec(query: string) {
    this.sqlite.exec(query)

    return {
      count: 0,
      duration: 0,
    }
  }
}

export type EmailTestHarness = {
  db: AppDb
  email: TestEmailBinding
  env: TestHarnessEnv
  queue: TestQueue<EmailEvent>
  ctx: TestExecutionContext
  sqlite: Database.Database
  storage: TestR2Bucket
  cleanup(): void
}

export function createEmailTestHarness(): EmailTestHarness {
  const sqlite = new Database(':memory:')

  applyAllMigrations(sqlite)

  const appDb = createDb(new TestD1Database(sqlite) as unknown as Parameters<typeof createDb>[0])
  const email = new TestEmailBinding()
  const queue = new TestQueue<EmailEvent>()
  const storage = new TestR2Bucket()
  const ctx = new TestExecutionContext()

  return {
    db: appDb,
    email,
    env: {
      APP_DB: appDb.$client,
      EMAIL: email,
      EMAIL_EVENTS: queue,
      EMAIL_STORAGE: storage,
    },
    queue,
    ctx,
    sqlite,
    storage,
    cleanup() {
      sqlite.close()
    },
  }
}

export async function createUserRecord(database: AppDb, overrides: Partial<typeof user.$inferInsert> = {}) {
  const userId = overrides.id ?? 'user_test_01'
  const now = new Date('2026-03-08T00:00:00.000Z')

  await database.insert(user).values({
    id: userId,
    name: overrides.name ?? 'Test User',
    email: overrides.email ?? `${userId}@example.com`,
    emailVerified: overrides.emailVerified ?? true,
    image: overrides.image ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  })

  return userId
}

export async function createInboxRecord(
  database: AppDb,
  userId: string,
  overrides: {
    customLocalPart?: string | null
    defaultLocalPart?: string
    id?: string
    isActive?: boolean
  } = {},
) {
  const inboxId = overrides.id ?? createInboxId()

  await database.insert(inboxes).values({
    id: inboxId,
    userId,
    defaultLocalPart: overrides.defaultLocalPart ?? createDefaultInboxLocalPart(inboxId),
    customLocalPart: overrides.customLocalPart ?? null,
    isActive: overrides.isActive ?? true,
  })

  return inboxId
}

function applyAllMigrations(sqlite: Database.Database) {
  const migrationsDirectory = new URL('../../../drizzle/', import.meta.url)
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort()

  for (const migrationFile of migrationFiles) {
    const migrationSql = readFileSync(new URL(migrationFile, migrationsDirectory), 'utf8')

    for (const statement of migrationSql.split('--> statement-breakpoint')) {
      const normalizedStatement = statement.trim()

      if (!normalizedStatement) {
        continue
      }

      sqlite.exec(normalizedStatement)
    }
  }
}

function isReadQuery(query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  return normalizedQuery.startsWith('select') || normalizedQuery.startsWith('pragma')
}

async function toUint8Array(value: string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream) {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value)
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  }

  return new Uint8Array(await new Response(value).arrayBuffer())
}
