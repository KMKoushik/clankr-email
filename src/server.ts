import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

import { handleInboundEmail, retryDueWebhookDeliveries } from '#/lib/email'

const startEntry = createServerEntry({
  fetch(request, requestOptions) {
    return handler.fetch(request, requestOptions)
  },
})

export default {
  ...startEntry,
  async email(message: Parameters<typeof handleInboundEmail>[0]) {
    await handleInboundEmail(message)
  },
  async scheduled(_event: unknown, _env: unknown, _ctx: unknown) {
    await retryDueWebhookDeliveries(100)
  },
}
