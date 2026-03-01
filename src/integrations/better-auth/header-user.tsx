import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { authClient } from '#/lib/auth-client'

export default function BetterAuthHeader() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) {
    return <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
  }

  if (session?.user) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {session.user.email}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void authClient.signOut()
          }}
        >
          Sign out
        </Button>
      </div>
    )
  }

  return (
    <Button size="sm" asChild>
      <Link to="/login">Log in</Link>
    </Button>
  )
}
