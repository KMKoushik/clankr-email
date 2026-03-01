import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from './schema.ts'

const d1 =
  (env as unknown as { clankr_email_db: Parameters<typeof drizzle>[0] })
    .clankr_email_db

export const db = drizzle(d1, { schema })
