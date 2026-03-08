import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { db } from '#/db/client'
import { provisionInitialInbox } from '#/lib/email/inboxes'

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
  }),
  databaseHooks: {
    user: {
      create: {
        async after(user) {
          if (!user) {
            return
          }

          await provisionInitialInbox(db, user.id)
        },
      },
    },
  },
  emailAndPassword: {
    enabled: true,
  },
  plugins: [tanstackStartCookies()],
})
