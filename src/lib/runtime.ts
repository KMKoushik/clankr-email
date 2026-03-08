import { env } from 'cloudflare:workers'

import { createDb } from '#/db/index'

export const db = createDb(env.APP_DB)

export function getDb() {
  return db
}

export function getWorkerEnv() {
  return env
}
