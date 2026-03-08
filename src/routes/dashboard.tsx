import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import {
  AtSign,
  Clock3,
  FlaskConical,
  Inbox as InboxIcon,
  LoaderCircle,
  MailPlus,
  RefreshCw,
  Reply,
  Send,
  Sparkles,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import { authClient } from '#/lib/auth-client'
import { orpc, rpcClient } from '#/lib/orpc-client'
import { cn } from '#/lib/utils'

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
})

type ComposeMode = 'new' | 'reply'

type ComposeState = {
  mode: ComposeMode
  inboxId: string
  replyToThreadId?: string
  to: string
  cc: string
  bcc: string
  subject: string
  text: string
  html: string
}

type ActionNotice = {
  tone: 'error' | 'success'
  text: string
}

type InboxRecord = Awaited<ReturnType<typeof rpcClient.inboxes.get>>
type ThreadListResult = Awaited<ReturnType<typeof rpcClient.threads.listByInbox>>
type ThreadSummary = ThreadListResult['items'][number]
type MessageListResult = Awaited<ReturnType<typeof rpcClient.threads.listMessages>>
type MessageSummary = MessageListResult['items'][number]
type MessageDetail = Awaited<ReturnType<typeof rpcClient.messages.get>>
type SendMessageInput = Parameters<typeof rpcClient.messages.send>[0]
type SendTestEmailResult = Awaited<ReturnType<typeof rpcClient.messages.sendTest>>

function DashboardPage() {
  const queryClient = useQueryClient()
  const { data: session, isPending } = authClient.useSession()

  const [isClient, setIsClient] = useState(false)
  const [selectedInboxId, setSelectedInboxId] = useState<string | null>(null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [aliasDraft, setAliasDraft] = useState('')
  const [composeState, setComposeState] = useState<ComposeState | null>(null)
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null)

  useEffect(() => {
    setIsClient(true)
  }, [])

  const isReady = isClient && Boolean(session?.user)

  const inboxesQuery = useQuery(
    orpc.inboxes.list.queryOptions({
      enabled: isReady,
      staleTime: 5_000,
    }),
  )

  const inboxes: InboxRecord[] = inboxesQuery.data ?? []
  const selectedInbox = useMemo(
    () => inboxes.find((inbox) => inbox.id === selectedInboxId) ?? null,
    [inboxes, selectedInboxId],
  )

  const threadsQuery = useQuery(
    orpc.threads.listByInbox.queryOptions({
      enabled: isReady && Boolean(selectedInboxId),
      input: {
        inboxId: selectedInboxId ?? '',
        limit: 25,
      },
      staleTime: 3_000,
    }),
  )

  const threads: ThreadSummary[] = threadsQuery.data?.items ?? []
  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [threads, selectedThreadId],
  )

  const messagesQuery = useQuery(
    orpc.threads.listMessages.queryOptions({
      enabled: isReady && Boolean(selectedThreadId),
      input: {
        limit: 100,
        threadId: selectedThreadId ?? '',
      },
      staleTime: 3_000,
    }),
  )

  const threadMessages: MessageSummary[] = messagesQuery.data?.items ?? []
  const selectedMessageSummary = useMemo(
    () => threadMessages.find((message) => message.id === selectedMessageId) ?? null,
    [threadMessages, selectedMessageId],
  )

  const messageDetailQuery = useQuery(
    orpc.messages.get.queryOptions({
      enabled: isReady && Boolean(selectedMessageId),
      input: {
        messageId: selectedMessageId ?? '',
      },
      staleTime: 3_000,
    }),
  )

  const selectedMessage: MessageDetail | null = messageDetailQuery.data ?? null

  useEffect(() => {
    if (inboxes.length === 0) {
      setSelectedInboxId(null)
      return
    }

    if (!selectedInboxId || !inboxes.some((inbox) => inbox.id === selectedInboxId)) {
      setSelectedInboxId(inboxes[0]!.id)
    }
  }, [inboxes, selectedInboxId])

  useEffect(() => {
    if (threads.length === 0) {
      setSelectedThreadId(null)
      return
    }

    if (!selectedThreadId || !threads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(threads[0]!.id)
    }
  }, [selectedThreadId, threads])

  useEffect(() => {
    if (threadMessages.length === 0) {
      setSelectedMessageId(null)
      return
    }

    if (!selectedMessageId || !threadMessages.some((message) => message.id === selectedMessageId)) {
      setSelectedMessageId(threadMessages.at(-1)?.id ?? null)
    }
  }, [selectedMessageId, threadMessages])

  useEffect(() => {
    setAliasDraft(selectedInbox?.customLocalPart ?? '')
  }, [selectedInbox?.customLocalPart, selectedInbox?.id])

  const createInboxMutation = useMutation(
    orpc.inboxes.create.mutationOptions({
    onSuccess: async (createdInbox) => {
      setActionNotice({
        text: `Created ${getPrimaryInboxAddress(createdInbox)}.`,
        tone: 'success',
      })
      setSelectedInboxId(createdInbox.id)
      await queryClient.invalidateQueries({
        queryKey: orpc.inboxes.list.key(),
      })
    },
    }),
  )

  const updateAliasMutation = useMutation(
    orpc.inboxes.updateAlias.mutationOptions({
    onSuccess: async (updatedInbox) => {
      setActionNotice({
        text: updatedInbox.customLocalPart
          ? `Alias saved as ${updatedInbox.customLocalPart}@clankr.email.`
          : 'Custom alias cleared.',
        tone: 'success',
      })
      await queryClient.invalidateQueries({
        queryKey: orpc.inboxes.list.key(),
      })
    },
    onError: (error) => {
      setActionNotice({
        text: getErrorMessage(error),
        tone: 'error',
      })
    },
    }),
  )

  const sendMessageMutation = useMutation(
    orpc.messages.send.mutationOptions({
    onSuccess: async (result) => {
      setComposeState(null)
      setSelectedInboxId(result.inboxId)
      setSelectedThreadId(result.threadId)
      setSelectedMessageId(result.id)
      setActionNotice({
        text: result.status === 'accepted'
          ? 'Message accepted by the provider.'
          : result.errorMessage ?? 'Message saved, but the provider rejected it.',
        tone: result.status === 'accepted' ? 'success' : 'error',
      })

      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.threads.listByInbox.queryKey({
            input: {
              inboxId: result.inboxId,
              limit: 25,
            },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.threads.listMessages.queryKey({
            input: {
              limit: 100,
              threadId: result.threadId,
            },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.messages.get.queryKey({
            input: {
              messageId: result.id,
            },
          }),
        }),
      ])
    },
    }),
  )

  const sendTestEmailMutation = useMutation(
    orpc.messages.sendTest.mutationOptions({
      onSuccess: (result: SendTestEmailResult) => {
        setActionNotice({
          text: `Test email sent to ${result.toEmail} from ${result.fromEmail}.`,
          tone: 'success',
        })
      },
      onError: (error) => {
        setActionNotice({
          text: getErrorMessage(error),
          tone: 'error',
        })
      },
    }),
  )

  if (isPending) {
    return (
      <main className="px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
        <div className="grid gap-5 xl:grid-cols-[22rem_28rem_minmax(0,1fr)]">
          <SkeletonPanel className="min-h-[24rem]" />
          <SkeletonPanel className="min-h-[24rem]" />
          <SkeletonPanel className="min-h-[24rem]" />
        </div>
      </main>
    )
  }

  if (!session?.user) {
    return <Navigate to="/login" />
  }

  const composerInbox = composeState
    ? inboxes.find((inbox) => inbox.id === composeState.inboxId) ?? null
    : null

  return (
    <main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top_left,rgba(214,154,78,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(74,124,121,0.12),transparent_24%)] px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
      <section className="flex w-full flex-col gap-5">
        <section className="overflow-hidden bg-[linear-gradient(135deg,rgba(214,154,78,0.16),rgba(255,255,255,0)),linear-gradient(180deg,rgba(17,24,39,0.03),rgba(17,24,39,0))] px-1 py-1">
          <div className="flex flex-col gap-5 px-4 py-5 sm:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl space-y-3">
                <div className="inline-flex w-fit items-center gap-2 border border-border/80 bg-background/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  <Sparkles className="size-3.5 text-primary" />
                  End-to-end inbox workbench
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    Run the inbox flow without leaving the dashboard.
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                    Create inboxes, move between live threads, read full message bodies, and send new
                    messages or threaded replies from one place.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 lg:min-w-[34rem]">
                <div className="flex justify-start lg:justify-end">
                  <Button
                    disabled={sendTestEmailMutation.isPending}
                    onClick={() => {
                      setActionNotice(null)
                      sendTestEmailMutation.mutate({})
                    }}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {sendTestEmailMutation.isPending ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <FlaskConical className="size-4" />
                    )}
                    Send test email
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricCard label="Signed in as" value={session.user.name || session.user.email} hint={session.user.email} />
                  <MetricCard label="Inboxes" value={String(inboxes.length)} hint={selectedInbox ? getPrimaryInboxAddress(selectedInbox) : 'Waiting for inboxes'} />
                  <MetricCard label="Threads here" value={String(threads.length)} hint={selectedThread?.subject || 'Select an inbox'} />
                </div>
              </div>
            </div>

            {actionNotice ? (
              <div
                className={cn(
                  'flex items-start justify-between gap-3 border px-3 py-2 text-sm',
                  actionNotice.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : 'border-destructive/30 bg-destructive/10 text-destructive',
                )}
              >
                <span>{actionNotice.text}</span>
                <button
                  className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70 transition hover:opacity-100"
                  onClick={() => setActionNotice(null)}
                  type="button"
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <section className="grid gap-5 xl:grid-cols-[22rem_28rem_minmax(0,1fr)] xl:items-start">
          <aside className="space-y-4">
            <Panel>
              <div className="flex items-center justify-between gap-3 border-b border-border/80 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Inboxes</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Each inbox can send and receive at `@clankr.email`.
                  </p>
                </div>
                <Button
                  className="shrink-0"
                  disabled={createInboxMutation.isPending}
                  onClick={() => {
                    setActionNotice(null)
                    createInboxMutation.mutate({})
                  }}
                  size="sm"
                  type="button"
                >
                  {createInboxMutation.isPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <InboxIcon className="size-4" />
                  )}
                  New inbox
                </Button>
              </div>

              <div className="space-y-3 px-4 py-4">
                {inboxesQuery.isLoading ? (
                  <div className="space-y-2">
                    <SkeletonLine />
                    <SkeletonLine />
                    <SkeletonLine />
                  </div>
                ) : inboxes.length > 0 ? (
                  inboxes.map((inbox) => {
                    const isSelected = inbox.id === selectedInboxId

                    return (
                      <button
                        key={inbox.id}
                        className={cn(
                          'w-full border px-4 py-4 text-left transition',
                          isSelected
                            ? 'border-primary bg-primary/10 shadow-[inset_4px_0_0_0_var(--color-primary)]'
                            : 'border-border/80 bg-background/70 hover:border-primary/40 hover:bg-accent/60',
                        )}
                        onClick={() => {
                          setActionNotice(null)
                          setSelectedInboxId(inbox.id)
                        }}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{getPrimaryInboxAddress(inbox)}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{inbox.id}</p>
                          </div>
                          <StatusPill tone={inbox.customLocalPart ? 'accent' : 'neutral'}>
                            {inbox.customLocalPart ? 'alias live' : 'default only'}
                          </StatusPill>
                        </div>
                        {inbox.customLocalPart ? (
                          <p className="mt-3 text-xs text-muted-foreground">
                            Fallback: {inbox.defaultLocalPart}@clankr.email
                          </p>
                        ) : null}
                      </button>
                    )
                  })
                ) : (
                  <EmptyState
                    body="Your first inbox should be provisioned automatically, but you can create one here too."
                    title="No inboxes yet"
                  />
                )}
              </div>
            </Panel>

            <Panel>
              <div className="border-b border-border/80 px-5 py-4">
                <h2 className="text-lg font-semibold tracking-tight">Inbox settings</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Manage the selected inbox address and launch compose quickly.
                </p>
              </div>

              {selectedInbox ? (
                <div className="space-y-4 px-5 py-5">
                  <div className="space-y-2 border border-border/70 bg-background/65 px-4 py-4">
                    <AddressRow label="Primary" value={getPrimaryInboxAddress(selectedInbox)} />
                    <AddressRow label="Default" value={`${selectedInbox.defaultLocalPart}@clankr.email`} />
                    <AddressRow
                      label="Custom"
                      value={selectedInbox.customLocalPart ? `${selectedInbox.customLocalPart}@clankr.email` : 'Not set'}
                    />
                  </div>

                  <form
                    className="space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      setActionNotice(null)
                      updateAliasMutation.mutate({
                        alias: aliasDraft.trim() ? aliasDraft.trim() : null,
                        inboxId: selectedInbox.id,
                      })
                    }}
                  >
                    <div className="space-y-2">
                      <Label htmlFor="alias">Friendly alias</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id="alias"
                          onChange={(event) => setAliasDraft(event.target.value)}
                          placeholder="sales-team"
                          value={aliasDraft}
                        />
                        <span className="text-xs text-muted-foreground">@clankr.email</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button disabled={updateAliasMutation.isPending} size="sm" type="submit">
                        {updateAliasMutation.isPending ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <AtSign className="size-4" />
                        )}
                        Save alias
                      </Button>
                      <Button
                        disabled={updateAliasMutation.isPending || !selectedInbox.customLocalPart}
                        onClick={() => {
                          setAliasDraft('')
                          setActionNotice(null)
                          updateAliasMutation.mutate({
                            alias: null,
                            inboxId: selectedInbox.id,
                          })
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Clear alias
                      </Button>
                    </div>

                    <p className="text-xs leading-5 text-muted-foreground">
                      Lowercase letters, numbers, and hyphens only. Reserved words are blocked.
                    </p>
                  </form>

                  <Button
                    className="w-full"
                    onClick={() => setComposeState(createNewComposeState(selectedInbox.id))}
                    type="button"
                  >
                    <MailPlus className="size-4" />
                    New outbound message
                  </Button>
                </div>
              ) : (
                <div className="px-5 py-5">
                  <EmptyState body="Select an inbox to manage its address and compose from it." title="No inbox selected" />
                </div>
              )}
            </Panel>
          </aside>

          <section className="space-y-4">
            <Panel>
              <div className="flex items-center justify-between gap-3 border-b border-border/80 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Threads</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedInbox
                      ? `Latest conversations for ${getPrimaryInboxAddress(selectedInbox)}.`
                      : 'Pick an inbox to browse its conversations.'}
                  </p>
                </div>
                <Button
                  disabled={!selectedInboxId || threadsQuery.isFetching}
                  onClick={() => {
                    setActionNotice(null)
                    void threadsQuery.refetch()
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <RefreshCw className={cn('size-4', threadsQuery.isFetching ? 'animate-spin' : '')} />
                  Refresh
                </Button>
              </div>

              <div className="space-y-2 px-3 py-3">
                {threadsQuery.isLoading ? (
                  <div className="space-y-2 px-2 py-2">
                    <SkeletonLine />
                    <SkeletonLine />
                    <SkeletonLine />
                    <SkeletonLine />
                  </div>
                ) : !selectedInbox ? (
                  <EmptyState body="Choose or create an inbox to load its threads." title="Inbox required" />
                ) : threads.length === 0 ? (
                  <EmptyState
                    body="This inbox has no conversations yet. Send a message or route one inbound to see it appear here."
                    title="No threads yet"
                  />
                ) : (
                  threads.map((thread) => {
                    const isSelected = thread.id === selectedThreadId

                    return (
                      <button
                        key={thread.id}
                        className={cn(
                          'w-full border px-4 py-4 text-left transition',
                          isSelected
                            ? 'border-primary bg-primary/8 shadow-[inset_4px_0_0_0_var(--color-primary)]'
                            : 'border-border/80 bg-background/70 hover:border-primary/35 hover:bg-accent/60',
                        )}
                        onClick={() => {
                          setActionNotice(null)
                          setSelectedThreadId(thread.id)
                        }}
                        type="button"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {thread.subject || '(no subject)'}
                            </p>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {thread.fromEmail || 'Unknown sender'}
                            </p>
                          </div>
                          <StatusPill tone={thread.latestMessageDirection === 'outbound' ? 'accent' : 'neutral'}>
                            {thread.latestMessageDirection || 'empty'}
                          </StatusPill>
                        </div>

                        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                          {thread.snippet || 'No preview available yet.'}
                        </p>

                        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span>{thread.messageCount} message{thread.messageCount === 1 ? '' : 's'}</span>
                          <span>{formatCompactDateTime(thread.lastMessageAt)}</span>
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            </Panel>
          </section>

          <section className="space-y-4">
            {composeState ? (
              <ComposePanel
                composeState={composeState}
                inboxes={inboxes}
                isSubmitting={sendMessageMutation.isPending}
                onCancel={() => {
                  setComposeState(null)
                  sendMessageMutation.reset()
                }}
                onChange={setComposeState}
                onSubmit={(event) => {
                  event.preventDefault()
                  setActionNotice(null)
                  sendMessageMutation.mutate(buildSendMessagePayload(composeState))
                }}
                replySource={selectedMessageSummary}
                selectedInbox={composerInbox}
                sendError={sendMessageMutation.isError ? getErrorMessage(sendMessageMutation.error) : null}
              />
            ) : null}

            <Panel>
              <div className="flex flex-col gap-4 border-b border-border/80 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Conversation reader</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedThread
                      ? `Inspect ${selectedThread.subject || '(no subject)'} and open any message in the thread.`
                      : 'Select a thread to inspect the full conversation.'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!selectedInbox}
                    onClick={() => selectedInbox && setComposeState(createNewComposeState(selectedInbox.id))}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <MailPlus className="size-4" />
                    New
                  </Button>
                  <Button
                    disabled={!selectedInbox || !selectedThread || threadMessages.length === 0}
                    onClick={() => {
                      if (!selectedInbox || !selectedThread) {
                        return
                      }

                      setComposeState(
                        createReplyComposeState({
                          inboxId: selectedInbox.id,
                          selectedMessage: selectedMessageSummary,
                          threadId: selectedThread.id,
                          threadMessages,
                          threadSubject: selectedThread.subject,
                        }),
                      )
                    }}
                    size="sm"
                    type="button"
                  >
                    <Reply className="size-4" />
                    Reply in thread
                  </Button>
                </div>
              </div>

              {!selectedThread ? (
                <div className="px-5 py-12">
                  <EmptyState
                    body="Pick a thread from the middle pane or send a new message to create one."
                    title="Conversation view is empty"
                  />
                </div>
              ) : (
                <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
                    <div className="space-y-2 border border-border/70 bg-background/65 p-2">
                      <div className="flex items-center justify-between gap-3 border-b border-border/80 px-2 py-2">
                        <div>
                          <p className="text-sm font-semibold">Messages</p>
                          <p className="text-xs text-muted-foreground">
                            {threadMessages.length} item{threadMessages.length === 1 ? '' : 's'} in order
                          </p>
                        </div>
                        {messagesQuery.isFetching ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
                      </div>

                      {messagesQuery.isLoading ? (
                        <div className="space-y-2 px-2 py-2">
                          <SkeletonLine />
                          <SkeletonLine />
                          <SkeletonLine />
                        </div>
                      ) : threadMessages.length === 0 ? (
                        <div className="px-2 py-4">
                          <EmptyState body="Messages will appear here when the thread receives activity." title="No messages yet" />
                        </div>
                      ) : (
                        threadMessages.map((message) => {
                          const isSelected = message.id === selectedMessageId

                          return (
                            <button
                              key={message.id}
                              className={cn(
                                'w-full border px-3 py-3 text-left transition',
                                isSelected
                                  ? 'border-primary bg-primary/10'
                                  : 'border-border/80 bg-card hover:border-primary/35 hover:bg-accent/50',
                              )}
                              onClick={() => setSelectedMessageId(message.id)}
                              type="button"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <StatusPill tone={message.direction === 'outbound' ? 'accent' : 'neutral'}>
                                  {message.direction}
                                </StatusPill>
                                <span className="text-xs text-muted-foreground">
                                  {formatCompactDateTime(message.sentAt ?? message.receivedAt ?? message.createdAt)}
                                </span>
                              </div>
                              <p className="mt-3 truncate text-sm font-medium">{message.subject || '(no subject)'}</p>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                                {message.snippet || 'No preview available.'}
                              </p>
                            </button>
                          )
                        })
                      )}
                    </div>

                    <div className="min-w-0 border border-border/70 bg-background/65">
                      <div className="flex items-center justify-between gap-3 border-b border-border/80 px-4 py-3">
                        <div>
                          <p className="text-sm font-semibold">Message detail</p>
                          <p className="text-xs text-muted-foreground">
                            Read body content, routing metadata, and storage source.
                          </p>
                        </div>
                        {messageDetailQuery.isFetching ? <LoaderCircle className="size-4 animate-spin text-muted-foreground" /> : null}
                      </div>

                      {messageDetailQuery.isLoading ? (
                        <div className="space-y-3 px-4 py-4">
                          <SkeletonLine />
                          <SkeletonLine />
                          <SkeletonLine />
                          <SkeletonBlock />
                        </div>
                      ) : selectedMessage ? (
                        <MessageDetailPanel message={selectedMessage} />
                      ) : (
                        <div className="px-4 py-10">
                          <EmptyState body="Choose a message from the thread to inspect its full contents." title="No message selected" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Panel>
          </section>
        </section>
      </section>
    </main>
  )
}

function ComposePanel(props: {
  composeState: ComposeState
  inboxes: InboxRecord[]
  isSubmitting: boolean
  onCancel: () => void
  onChange: (nextState: ComposeState) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  replySource: MessageSummary | null
  selectedInbox: InboxRecord | null
  sendError: string | null
}) {
  const { composeState, inboxes, isSubmitting, onCancel, onChange, onSubmit, replySource, selectedInbox, sendError } = props
  const isReply = composeState.mode === 'reply'

  return (
    <Panel>
      <div className="flex flex-col gap-4 border-b border-border/80 bg-[linear-gradient(135deg,rgba(214,154,78,0.14),rgba(255,255,255,0))] px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {isReply ? 'Reply in thread' : 'Compose message'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {isReply
              ? 'The reply uses thread headers automatically so the conversation stays grouped.'
              : 'Send a new outbound message from any active inbox.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill tone="neutral">{selectedInbox ? getPrimaryInboxAddress(selectedInbox) : 'Choose inbox'}</StatusPill>
          <Button onClick={onCancel} size="sm" type="button" variant="outline">
            Close
          </Button>
        </div>
      </div>

      <form className="space-y-4 px-5 py-5" onSubmit={onSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="compose-inbox">From inbox</Label>
            {isReply ? (
              <div className="flex h-9 items-center border border-border/80 bg-background/70 px-3 text-sm">
                {selectedInbox ? getPrimaryInboxAddress(selectedInbox) : 'No inbox selected'}
              </div>
            ) : (
              <Select
                onValueChange={(value) => onChange({ ...composeState, inboxId: value })}
                value={composeState.inboxId}
              >
                <SelectTrigger id="compose-inbox" className="w-full">
                  <SelectValue placeholder="Select an inbox" />
                </SelectTrigger>
                <SelectContent>
                  {inboxes.map((inbox) => (
                    <SelectItem key={inbox.id} value={inbox.id}>
                      {getPrimaryInboxAddress(inbox)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="compose-subject">Subject</Label>
            <Input
              id="compose-subject"
              onChange={(event) => onChange({ ...composeState, subject: event.target.value })}
              placeholder="Project update"
              value={composeState.subject}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="compose-to">To</Label>
          <Input
            id="compose-to"
            onChange={(event) => onChange({ ...composeState, to: event.target.value })}
            placeholder="name@example.com, ops@example.com"
            value={composeState.to}
          />
          <p className="text-xs text-muted-foreground">
            Separate addresses with commas, spaces, or new lines.
          </p>
        </div>

        <details className="border border-border/70 bg-background/55 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">Advanced fields</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="compose-cc">CC</Label>
              <Input
                id="compose-cc"
                onChange={(event) => onChange({ ...composeState, cc: event.target.value })}
                placeholder="team@example.com"
                value={composeState.cc}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="compose-bcc">BCC</Label>
              <Input
                id="compose-bcc"
                onChange={(event) => onChange({ ...composeState, bcc: event.target.value })}
                placeholder="audit@example.com"
                value={composeState.bcc}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="compose-html">Optional HTML body</Label>
              <Textarea
                id="compose-html"
                onChange={(event) => onChange({ ...composeState, html: event.target.value })}
                placeholder="<p>Rich message body</p>"
                rows={5}
                value={composeState.html}
              />
            </div>
          </div>
        </details>

        <div className="space-y-2">
          <Label htmlFor="compose-text">Plain text body</Label>
          <Textarea
            id="compose-text"
            onChange={(event) => onChange({ ...composeState, text: event.target.value })}
            placeholder="Write the message body here..."
            rows={10}
            value={composeState.text}
          />
        </div>

        {replySource ? (
          <div className="border border-border/70 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
            Reply target: {replySource.fromEmail} - {replySource.subject || '(no subject)'}
          </div>
        ) : null}

        {sendError ? (
          <div className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {sendError}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            {isSubmitting ? 'Sending...' : isReply ? 'Send reply' : 'Send message'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Outbound sends are persisted first, so failed provider attempts still show up in the thread.
          </p>
        </div>
      </form>
    </Panel>
  )
}

function MessageDetailPanel({ message }: { message: MessageDetail }) {
  const hasHtml = Boolean(message.htmlBody?.trim())
  const hasText = Boolean(message.textBody?.trim())

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="space-y-3 border border-border/70 bg-card/85 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={message.direction === 'outbound' ? 'accent' : 'neutral'}>
            {message.direction}
          </StatusPill>
          <StatusPill tone={message.status === 'failed' || message.status === 'rejected' ? 'danger' : 'neutral'}>
            {message.status}
          </StatusPill>
          <StatusPill tone={message.bodyFetchStrategy === 'r2' ? 'accent' : 'neutral'}>
            body: {message.bodyFetchStrategy}
          </StatusPill>
        </div>

        <div>
          <h3 className="text-xl font-semibold tracking-tight">{message.subject || '(no subject)'}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="size-3.5" />
              {formatLongDateTime(message.sentAt ?? message.receivedAt ?? message.createdAt)}
            </span>
            <span>{message.id}</span>
          </div>
        </div>

        <MetadataRow label="From" value={message.fromEmail} />
        <MetadataRow label="To" value={formatAddressList(message.toEmails)} />
        <MetadataRow label="CC" value={formatAddressList(message.ccEmails)} />
        <MetadataRow label="BCC" value={formatAddressList(message.bccEmails)} />
        <MetadataRow label="Internet ID" value={message.internetMessageId || 'Unavailable'} />

        {message.errorMessage ? (
          <div className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {message.errorMessage}
          </div>
        ) : null}
      </div>

      <div className="border border-border/70 bg-background/70 px-4 py-4">
        {hasHtml ? (
          <div
            className="prose prose-neutral dark:prose-invert max-w-none break-words prose-pre:overflow-x-auto"
            dangerouslySetInnerHTML={{ __html: message.htmlBody ?? '' }}
          />
        ) : hasText ? (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">
            {message.textBody}
          </pre>
        ) : (
          <p className="text-sm text-muted-foreground">No body content was stored for this message.</p>
        )}
      </div>

      <details className="border border-border/70 bg-background/55 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Delivery and storage metadata</summary>
        <div className="mt-4 space-y-2 text-muted-foreground">
          <MetadataRow label="Provider ID" value={message.providerMessageId || 'Unavailable'} />
          <MetadataRow label="Raw MIME key" value={message.rawMimeR2Key || 'Unavailable'} />
          <MetadataRow label="Overflow body key" value={message.oversizedBodyR2Key || 'Unavailable'} />
          <MetadataRow
            label="Stored body size"
            value={message.bodySizeBytes === null ? 'Unavailable' : `${message.bodySizeBytes.toLocaleString()} bytes`}
          />
        </div>
      </details>
    </div>
  )
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <section className="overflow-hidden border border-border/50 bg-card/82 backdrop-blur-sm shadow-[0_24px_70px_-38px_rgba(15,23,42,0.4)]">
      {children}
    </section>
  )
}

function MetricCard(props: { hint: string; label: string; value: string }) {
  return (
    <div className="border border-border/60 bg-background/70 px-4 py-3 backdrop-blur-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{props.label}</p>
      <p className="mt-2 truncate text-lg font-semibold tracking-tight">{props.value}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{props.hint}</p>
    </div>
  )
}

function StatusPill(props: { children: ReactNode; tone: 'accent' | 'danger' | 'neutral' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center border px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
        props.tone === 'accent' && 'border-primary/30 bg-primary/10 text-primary',
        props.tone === 'danger' && 'border-destructive/30 bg-destructive/10 text-destructive',
        props.tone === 'neutral' && 'border-border/80 bg-background/80 text-muted-foreground',
      )}
    >
      {props.children}
    </span>
  )
}

function EmptyState(props: { body: string; title: string }) {
  return (
    <div className="border border-dashed border-border/70 bg-background/45 px-4 py-6 text-center">
      <p className="text-sm font-semibold tracking-tight">{props.title}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{props.body}</p>
    </div>
  )
}

function AddressRow(props: { label: string; value: string }) {
  return <MetadataRow label={props.label} value={props.value} />
}

function MetadataRow(props: { label: string; value: string }) {
  return (
    <div className="grid gap-1 text-sm sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-3">
      <span className="font-medium text-muted-foreground">{props.label}</span>
      <span className="break-words">{props.value}</span>
    </div>
  )
}

function SkeletonPanel({ className }: { className?: string }) {
  return (
    <div className={cn('border border-border/50 bg-card/80 p-5 backdrop-blur-sm', className)}>
      <div className="space-y-3">
        <SkeletonLine className="w-2/5" />
        <SkeletonLine className="w-4/5" />
        <SkeletonLine className="w-3/5" />
        <SkeletonBlock />
      </div>
    </div>
  )
}

function SkeletonLine({ className }: { className?: string }) {
  return <div className={cn('h-4 animate-pulse bg-muted', className)} />
}

function SkeletonBlock() {
  return <div className="h-32 animate-pulse bg-muted" />
}

function createNewComposeState(inboxId: string): ComposeState {
  return {
    bcc: '',
    cc: '',
    html: '',
    inboxId,
    mode: 'new',
    subject: '',
    text: '',
    to: '',
  }
}

function createReplyComposeState(params: {
  inboxId: string
  selectedMessage: MessageSummary | null
  threadId: string
  threadMessages: MessageSummary[]
  threadSubject: string | null
}) {
  const replyTarget = params.selectedMessage
    ?? [...params.threadMessages].reverse().find((message) => message.direction === 'inbound')
    ?? params.threadMessages.at(-1)

  const replyAddress = replyTarget
    ? replyTarget.direction === 'inbound'
      ? replyTarget.fromEmail
      : replyTarget.toEmails[0] ?? ''
    : ''

  return {
    bcc: '',
    cc: '',
    html: '',
    inboxId: params.inboxId,
    mode: 'reply' as const,
    replyToThreadId: params.threadId,
    subject: addReplyPrefix(replyTarget?.subject || params.threadSubject || ''),
    text: replyTarget ? `\n\n---\nFrom: ${replyTarget.fromEmail}\nSubject: ${replyTarget.subject}` : '',
    to: replyAddress,
  }
}

function buildSendMessagePayload(composeState: ComposeState): SendMessageInput {
  return {
    bcc: parseRecipientInput(composeState.bcc),
    cc: parseRecipientInput(composeState.cc),
    html: composeState.html.trim() || undefined,
    inboxId: composeState.inboxId,
    replyToThreadId: composeState.replyToThreadId,
    subject: composeState.subject,
    text: composeState.text.trim() || undefined,
    to: parseRecipientInput(composeState.to),
  }
}

function parseRecipientInput(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function addReplyPrefix(subject: string) {
  const trimmed = subject.trim()

  if (!trimmed) {
    return 'Re:'
  }

  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
}

function getPrimaryInboxAddress(inbox: InboxRecord) {
  return `${inbox.customLocalPart ?? inbox.defaultLocalPart}@clankr.email`
}

function formatAddressList(addresses: string[]) {
  return addresses.length > 0 ? addresses.join(', ') : 'None'
}

function formatCompactDateTime(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatLongDateTime(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
