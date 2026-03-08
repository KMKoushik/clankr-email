import type { EmailEvent } from '#/lib/email/events'
import type { createDb } from '#/db/index'
import type { RawEmail } from 'postal-mime'

export interface QueueSendOptions {
  delaySeconds?: number
}

export interface QueueBinding<T = unknown> {
  send(body: T, options?: QueueSendOptions): Promise<void>
}

export interface EmailBinding {
  send(message: unknown): Promise<unknown>
}

export interface R2ObjectBodyLike {
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>
  put(key: string, value: string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream): Promise<unknown>
}

export interface EmailWorkerMessage {
  from: string
  to: string
  raw: RawEmail
  setReject(reason: string): void
}

export interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}

export interface ClankrEmailEnv {
  APP_DB: Parameters<typeof createDb>[0]
  EMAIL: EmailBinding
  EMAIL_EVENTS: QueueBinding<EmailEvent>
  EMAIL_STORAGE: R2BucketLike
}
