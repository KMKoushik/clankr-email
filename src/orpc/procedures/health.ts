import { z } from 'zod'

import { orpc } from '#/orpc/context'

export const healthProcedure = orpc
  .route({
    method: 'GET',
    path: '/health',
    summary: 'Health check',
  })
  .output(
    z.object({
      ok: z.literal(true),
      service: z.literal('clankr-email'),
    }),
  )
  .handler(() => ({
    ok: true,
    service: 'clankr-email' as const,
  }))
