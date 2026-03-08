import { createStartHandler, defaultStreamHandler } from '@tanstack/react-start/server'

import type { EmailEvent } from '#/lib/email/events'
import { handleInboundEmail } from '#/lib/email/inbound'

const fetch = createStartHandler(defaultStreamHandler)

export default {
  fetch,
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) {
    void env
    void ctx

    console.log('inbound_email_received', {
      from: message.from,
      to: message.to,
    })

    try {
      const result = await handleInboundEmail(message)

      console.log('inbound_email_processed', {
        result,
        to: message.to,
      })
    } catch (error) {
      console.error('inbound_email_failed', {
        error,
        from: message.from,
        to: message.to,
      })

      throw error
    }
  },
  async queue(batch: MessageBatch<EmailEvent>) {
    for (const message of batch.messages) {
      message.ack()
    }
  },
}
