import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'

import type { ClankrEmailEnv, EmailWorkerMessage, WorkerExecutionContext } from '#/lib/cloudflare'
import type { EmailEvent } from '#/lib/email/events'
import { handleInboundEmail } from '#/lib/email/inbound'

const fetch = createStartHandler(defaultStreamHandler)

export default {
  fetch,
  async email(message: EmailWorkerMessage, env: ClankrEmailEnv, ctx: WorkerExecutionContext) {
    void ctx
    await handleInboundEmail(message, env)
  },
  async queue(batch: { messages: Array<{ body: EmailEvent; ack(): void }> }) {
    for (const message of batch.messages) {
      message.ack()
    }
  },
}
