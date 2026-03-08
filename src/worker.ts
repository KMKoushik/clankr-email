import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'

import type { EmailEvent } from '#/lib/email/events'
import { handleInboundEmail } from '#/lib/email/inbound'

const fetch = createStartHandler(defaultStreamHandler)

export default {
  fetch,
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    void env
    void ctx
    await handleInboundEmail(message)
  },
  async queue(batch: MessageBatch<EmailEvent>) {
    for (const message of batch.messages) {
      message.ack()
    }
  },
}
