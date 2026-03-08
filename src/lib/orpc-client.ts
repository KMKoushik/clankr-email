import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

import type { RouterClient } from '@orpc/server'

import type { AppRouter } from '#/orpc/router'

const link = new RPCLink({
  fetch: (request, init) => {
    return fetch(new Request(request, { credentials: 'same-origin' }), init)
  },
  url: () => {
    if (typeof window !== 'undefined') {
      return new URL('/api/rpc', window.location.origin).toString()
    }

    return 'http://localhost/api/rpc'
  },
})

export const rpcClient: RouterClient<AppRouter> = createORPCClient(link)

export const orpc = createTanstackQueryUtils(rpcClient)
