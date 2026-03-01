import { Link } from '@tanstack/react-router'
import BetterAuthHeader from '../integrations/better-auth/header-user.tsx'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 px-4 backdrop-blur">
      <nav className="mx-auto flex w-full max-w-5xl items-center gap-2 py-3">
        <h2 className="m-0 text-base font-semibold tracking-tight">
          <Link
            to="/"
            className="inline-flex items-center rounded-md px-2 py-1 text-foreground no-underline transition hover:bg-accent"
          >
            Clankr Email
          </Link>
        </h2>

        <div className="ml-2 flex items-center gap-1 text-sm font-medium">
          <Link
            to="/"
            className="rounded-md px-3 py-1.5 text-muted-foreground no-underline transition hover:bg-accent hover:text-foreground"
            activeProps={{
              className: 'rounded-md bg-accent px-3 py-1.5 text-foreground no-underline',
            }}
          >
            Home
          </Link>
          <Link
            to="/dashboard"
            className="rounded-md px-3 py-1.5 text-muted-foreground no-underline transition hover:bg-accent hover:text-foreground"
            activeProps={{
              className: 'rounded-md bg-accent px-3 py-1.5 text-foreground no-underline',
            }}
          >
            Dashboard
          </Link>
        </div>

        <div className="ml-auto">
          <BetterAuthHeader />
        </div>
      </nav>
    </header>
  )
}
