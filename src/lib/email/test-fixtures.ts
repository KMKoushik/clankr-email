type MimeFixtureOptions = {
  date?: string
  from?: string
  htmlBody?: string
  inReplyTo?: string
  messageId?: string
  references?: string[]
  subject?: string
  textBody?: string
  to?: string
}

export function createMimeFixture(options: MimeFixtureOptions = {}) {
  const date = options.date ?? 'Sun, 08 Mar 2026 10:00:00 +0000'
  const from = options.from ?? 'Sender <sender@example.com>'
  const to = options.to ?? 'Agent <agent@clankr.email>'
  const subject = options.subject ?? 'Hello from tests'
  const messageId = options.messageId ?? '<message-1@example.com>'
  const textBody = options.textBody ?? 'Plain text body'
  const htmlBody = options.htmlBody

  if (!htmlBody) {
    return [
      `Date: ${date}`,
      `From: ${from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      options.inReplyTo ? `In-Reply-To: ${options.inReplyTo}` : null,
      options.references?.length ? `References: ${options.references.join(' ')}` : null,
      'Content-Type: text/plain; charset=utf-8',
      '',
      textBody,
      '',
    ]
      .filter((line): line is string => line !== null)
      .join('\r\n')
  }

  const boundary = 'clankr-test-boundary'

  return [
    `Date: ${date}`,
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    options.inReplyTo ? `In-Reply-To: ${options.inReplyTo}` : null,
    options.references?.length ? `References: ${options.references.join(' ')}` : null,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
    '',
  ]
    .filter((line): line is string => line !== null)
    .join('\r\n')
}

export function createInboundWorkerMessage(options: {
  from?: string
  raw: string
  to?: string
}) {
  let rejectedWith: string | null = null

  const message: Pick<ForwardableEmailMessage, 'from' | 'raw' | 'setReject' | 'to'> = {
    from: options.from ?? 'sender@example.com',
    to: options.to ?? 'agent@clankr.email',
    raw: createReadableStream(options.raw),
    setReject(reason: string) {
      rejectedWith = reason
    },
  }

  return {
    message,
    getRejectedReason() {
      return rejectedWith
    },
  }
}

function createReadableStream(content: string) {
  const bytes = new TextEncoder().encode(content)

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}
