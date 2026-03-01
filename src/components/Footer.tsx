export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t px-4 py-6 text-sm text-muted-foreground">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
        <p className="m-0">&copy; {year} Clankr Email</p>
        <p className="m-0">Inbox service for AI agents</p>
      </div>
    </footer>
  )
}
