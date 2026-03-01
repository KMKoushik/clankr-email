import { Link, createFileRoute } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import { Button } from '#/components/ui/button'

export const Route = createFileRoute('/')({ component: LandingPage })

function LandingPage() {
  const { data: session } = authClient.useSession()
  const ctaPath = session?.user ? '/dashboard' : '/login'
  const ctaLabel = session?.user ? 'Go to Dashboard' : 'Start Building'

  return (
    <main className="flex min-h-[calc(100vh-12rem)] flex-col items-center justify-center px-4 py-24 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mb-8 flex justify-center">
          <span className="inline-flex items-center border bg-card px-3 py-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Clankr Email
          </span>
        </div>
        
        <h1 className="text-balance text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
          Email infrastructure for autonomous agents.
        </h1>
        
        <p className="mx-auto mt-6 text-balance text-lg text-muted-foreground sm:text-xl">
          Give your AI agents the ability to securely send, receive, and understand emails. 
          Built for modern agentic workflows.
        </p>
        
        <div className="mt-10 flex items-center justify-center gap-4">
          <Button size="lg" className="h-11 rounded-none border-2 border-foreground px-8 text-base shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)] hover:-translate-y-0.5 hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-[6px_6px_0px_0px_rgba(255,255,255,1)] transition-all" asChild>
            <Link to={ctaPath}>{ctaLabel}</Link>
          </Button>
          {!session?.user && (
            <Button variant="outline" size="lg" className="h-11 rounded-none border-2 border-foreground px-8 text-base bg-transparent hover:bg-muted" asChild>
              <Link to="/login">Sign In</Link>
            </Button>
          )}
        </div>
      </div>
      
      <div className="mx-auto mt-32 grid max-w-5xl gap-6 sm:grid-cols-3">
        {[
          {
            title: 'Dedicated Inboxes',
            description: 'Provision unique email addresses instantly via API. Perfect for giving every agent or user session their own secure inbox.',
          },
          {
            title: 'Webhook Routing',
            description: 'Receive real-time webhooks the millisecond an email arrives. Payload includes parsed text, attachments, and thread context.',
          },
          {
            title: 'Agent-Friendly API',
            description: 'A clean, RESTful API designed specifically for LLMs and autonomous agents to read, compose, and reply to threads.',
          }
        ].map((feature, i) => (
          <div key={i} className="flex flex-col border-2 border-foreground bg-card p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-[4px_4px_0px_0px_rgba(255,255,255,1)]">
             <h3 className="mb-2 text-xl font-bold tracking-tight">{feature.title}</h3>
             <p className="text-muted-foreground">{feature.description}</p>
          </div>
        ))}
      </div>
    </main>
  )
}
