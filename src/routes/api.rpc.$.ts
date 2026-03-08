import { createFileRoute } from '@tanstack/react-router'
import { RPCHandler } from '@orpc/server/fetch'

import { router } from '#/orpc/router'

const rpcHandler = new RPCHandler(router)

async function handleRequest(request: Request) {
  const { matched, response } = await rpcHandler.handle(request, {
    context: {
      request,
    },
    prefix: '/api/rpc',
  })

  return matched ? response : new Response('Not found', { status: 404 })
}

export const Route = createFileRoute('/api/rpc/$')({
  server: {
    handlers: {
      GET: ({ request }) => handleRequest(request),
      POST: ({ request }) => handleRequest(request),
    },
  },
})
