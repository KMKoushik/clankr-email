# AGENTS.md
Instructions for agentic coding assistants working in this repository.

## Scope
- Follow this file for command usage, validation steps, and coding conventions.
- Keep changes focused; do not refactor unrelated code.
- Match established patterns in nearby files before introducing new structure.

## Project Snapshot
- Framework/runtime: TanStack Start + React 19 + Vite 7.
- Language: TypeScript (`strict: true`).
- Styling: Tailwind CSS v4 + custom tokens in `src/styles.css`.
- Data/auth: Drizzle ORM (SQLite) + Better Auth.
- API: oRPC routes in `src/routes/api.$.ts` and `src/routes/api.rpc.$.ts`.
- Content: `content-collections` using `content/blog/*.{md,mdx}`.
- Package manager: `pnpm` (use `pnpm-lock.yaml` as source of truth).

## Cursor/Copilot Rules
### Cursor rules found
Source: `.cursorrules`

```bash
# Use latest Shadcn for new components
pnpm dlx shadcn@latest add button
```

### Rules not found
- No `.cursor/rules/` directory is present.
- No `.github/copilot-instructions.md` file is present.

## Build, Dev, Test, Deploy Commands
Run from repo root.

```bash
# Install deps
pnpm install

# Dev server (port 3000)
pnpm dev

# Production build
pnpm build

# Preview build
pnpm preview

# Run tests once
pnpm test

# Deploy (build + wrangler deploy)
pnpm deploy
```

## Single-Test and Vitest Commands
`pnpm test` maps to `vitest run`.

```bash
# Run one test file
pnpm test -- src/path/to/file.test.ts

# Run one TSX test file
pnpm test -- src/path/to/file.test.tsx

# Run tests by name/pattern
pnpm test -- -t "renders header"

# File + name filter together
pnpm test -- src/path/to/file.test.ts -t "handles invalid input"

# Watch mode
pnpm vitest
```

Notes:
- No committed `*.test.*` files currently exist.
- Prefer new tests under `src/`, close to the code being tested.

## Lint and Typecheck
There is currently no dedicated lint script.
Use TypeScript checks as baseline static validation:

```bash
pnpm exec tsc --noEmit
```

Important TS constraints from `tsconfig.json`:
- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- `noUncheckedSideEffectImports: true`

## Database Commands
```bash
pnpm db:generate
pnpm db:migrate
pnpm db:push
pnpm db:pull
pnpm db:studio
```

Use `.env.local` for local secrets/config (for example `DATABASE_URL`).

## Code Style Guidelines

### Imports
- Put side-effect imports first (example: `import '#/polyfill'`).
- Then third-party packages.
- Then internal imports (`#/...` preferred), then relative imports.
- Use `import type` for type-only imports.
- Prefer `#/` alias instead of long relative chains.

### Formatting
- Match the style of the file you are editing.
- Most hand-written files use single quotes, no semicolons, and 2-space indent.
- Keep trailing commas in multiline objects/arrays/arguments.
- Do not mass-reformat unrelated lines.
- Shadcn-generated files may use double quotes; keep them internally consistent.

### Types
- Define explicit types at boundaries (API inputs/outputs, forms, DB operations).
- Validate external/user input with Zod where appropriate.
- Avoid `any`; if needed, keep scope narrow and local.
- Use non-null assertions (`!`) only when invariant is guaranteed.

### Naming
- Components/types: `PascalCase`.
- Hooks: `useXxx` in `camelCase`.
- Variables/functions: `camelCase`.
- Global exported constants: `UPPER_SNAKE_CASE` when already used (example: `SITE_URL`).
- Route filenames must follow TanStack file routing conventions.

### React and Routing
- Define routes as `export const Route = createFileRoute('...')({...})`.
- Keep page component near its route declaration.
- Use route `loader` for data loading and `head` for metadata.
- For server endpoints, return explicit `Response` status on error/not-found.

### Styling
- Reuse CSS variables and tokens from `src/styles.css`.
- Prefer Tailwind utilities plus existing semantic tokens.
- Use `cn()` from `#/lib/utils` for class merging.
- Keep visual design consistent with the existing theme unless asked otherwise.

### Error Handling
- Validate before mutating DB or calling external APIs.
- Use `try/catch` around async writes/mutations.
- Log actionable errors with context.
- Do not swallow errors silently.
- Use `void` for intentionally un-awaited promises in UI handlers.

### Auth/API/Data Safety
- Keep Better Auth wiring in existing integration points.
- Keep oRPC schema and handlers aligned when changing contracts.
- Keep DB schema updates in `src/db/schema.ts` and run drizzle commands.
- Never hardcode secrets; use env vars.

## Generated or Protected Files
- Do not manually edit `src/routeTree.gen.ts` (auto-generated).
- Respect `.vscode/settings.json` protections for `routeTree.gen.ts`.
- Treat `.content-collections/generated` as generated output.

## Agent Completion Checklist
1. Run relevant validation commands (`pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build` as needed).
2. Keep diff minimal and avoid unrelated formatting churn.
3. Confirm route/auth/data changes remain type-safe.
4. If adding shadcn UI, use the `.cursorrules` command.
5. Update this file if workflow conventions change.
