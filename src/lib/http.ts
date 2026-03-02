export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  })
}

export function badRequest(message: string, details?: unknown): Response {
  return json(
    {
      error: message,
      details,
    },
    { status: 400 },
  )
}

export function unauthorized(): Response {
  return json(
    {
      error: 'Unauthorized',
    },
    { status: 401 },
  )
}

export function notFound(message = 'Not found'): Response {
  return json(
    {
      error: message,
    },
    { status: 404 },
  )
}

export function internalError(message = 'Internal server error'): Response {
  return json(
    {
      error: message,
    },
    { status: 500 },
  )
}
