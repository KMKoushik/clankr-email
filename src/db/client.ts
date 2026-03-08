import { env } from 'cloudflare:workers'

import { createDb } from './index'

export const db = createDb(env.APP_DB)
