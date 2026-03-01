import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { authClient } from '#/lib/auth-client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

type AuthMode = 'sign-in' | 'sign-up'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const navigate = useNavigate()
  const { data: session, isPending } = authClient.useSession()

  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (isPending) {
    return (
      <main className="px-4 py-16">
        <div className="mx-auto h-24 w-full max-w-md animate-pulse rounded-xl border bg-card" />
      </main>
    )
  }

  if (session?.user) {
    return <Navigate to="/dashboard" />
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      if (mode === 'sign-up') {
        const result = await authClient.signUp.email({
          name,
          email,
          password,
        })

        if (result.error) {
          setError(result.error.message || 'Sign up failed')
          return
        }
      } else {
        const result = await authClient.signIn.email({
          email,
          password,
        })

        if (result.error) {
          setError(result.error.message || 'Sign in failed')
          return
        }
      }

      await navigate({ to: '/dashboard' })
    } catch {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="px-4 py-16 sm:py-20">
      <section className="mx-auto w-full max-w-md rounded-xl border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          {mode === 'sign-in' ? 'Log in' : 'Create an account'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === 'sign-in'
            ? 'Sign in to manage your agent inbox.'
            : 'Create your account to start sending and receiving agent emails.'}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === 'sign-in' ? 'default' : 'outline'}
            onClick={() => {
              setMode('sign-in')
              setError('')
            }}
          >
            Log in
          </Button>
          <Button
            type="button"
            variant={mode === 'sign-up' ? 'default' : 'outline'}
            onClick={() => {
              setMode('sign-up')
              setError('')
            }}
          >
            Sign up
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === 'sign-up' ? (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting
              ? 'Please wait...'
              : mode === 'sign-in'
                ? 'Log in'
                : 'Create account'}
          </Button>
        </form>
      </section>
    </main>
  )
}
