import { Navigate, createFileRoute } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'

export const Route = createFileRoute('/dashboard')({
  component: DashboardPage,
})

function DashboardPage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return (
      <main className="px-4 py-16">
        <div className="mx-auto h-24 w-full max-w-2xl animate-pulse rounded-xl border bg-card" />
      </main>
    )
  }

  if (!session?.user) {
    return <Navigate to="/login" />
  }

  const details = [
    ['Name', session.user.name],
    ['Email', session.user.email],
    ['User ID', session.user.id],
    ['Email Verified', session.user.emailVerified ? 'Yes' : 'No'],
  ]

  return (
    <main className="px-4 py-16 sm:py-20">
      <section className="mx-auto w-full max-w-2xl rounded-xl border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed-in user details.
        </p>

        <dl className="mt-6 divide-y rounded-md border">
          {details.map(([label, value]) => (
            <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr] sm:gap-4">
              <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
              <dd className="text-sm break-all">{value || '-'}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  )
}
