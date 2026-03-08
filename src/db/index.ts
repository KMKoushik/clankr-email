import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from './schema.ts'

export function createDb(database: Parameters<typeof drizzle>[0]) {
  return drizzle(database, { schema })
}

export type AppDb = ReturnType<typeof createDb>

export const db = createDb(env.APP_DB)
