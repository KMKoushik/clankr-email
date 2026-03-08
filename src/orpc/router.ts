import { healthProcedure } from './procedures/health'
import { inboxRouter } from './procedures/inboxes'
import { messageRouter } from './procedures/messages'
import { threadRouter } from './procedures/threads'
import { webhookRouter } from './procedures/webhooks'

export const router = {
  inboxes: inboxRouter,
  messages: messageRouter,
  system: {
    health: healthProcedure,
  },
  threads: threadRouter,
  webhooks: webhookRouter,
}

export type AppRouter = typeof router
