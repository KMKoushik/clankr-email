import { createFileRoute } from '@tanstack/react-router'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { OpenAPIReferencePlugin } from '@orpc/openapi/plugins'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'

import { router } from '#/orpc/router'

const openApiHandler = new OpenAPIHandler(router, {
  plugins: [
    new OpenAPIReferencePlugin({
      docsPath: '/docs',
      schemaConverters: [new ZodToJsonSchemaConverter()],
      specGenerateOptions: {
        info: {
          title: 'Clankr Email API',
          version: '0.1.0',
        },
      },
      specPath: '/openapi.json',
    }),
  ],
})

async function handleRequest(request: Request) {
  const { matched, response } = await openApiHandler.handle(request, {
    context: {
      request,
    },
    prefix: '/api',
  })

  return matched ? response : new Response('Not found', { status: 404 })
}

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      DELETE: ({ request }) => handleRequest(request),
      GET: ({ request }) => handleRequest(request),
      PATCH: ({ request }) => handleRequest(request),
      POST: ({ request }) => handleRequest(request),
      PUT: ({ request }) => handleRequest(request),
    },
  },
})
