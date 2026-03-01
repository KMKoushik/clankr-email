import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig } from 'drizzle-kit'

const localD1Dir = resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject')

if (!existsSync(localD1Dir)) {
  throw new Error(
    `Local D1 directory not found at ${localD1Dir}. Run \`pnpm dev\` first to create it.`,
  )
}

const sqliteFile = readdirSync(localD1Dir).find((fileName) =>
  fileName.endsWith('.sqlite'),
)

if (!sqliteFile) {
  throw new Error(
    `No local D1 sqlite file found in ${localD1Dir}. Run \`pnpm dev\` and perform a signup first.`,
  )
}

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: join(localD1Dir, sqliteFile),
  },
})
