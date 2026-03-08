# Clankr Email MVP Plan (Cloudflare-native)

## 1) Product goal

Build a Cloudflare-native "email for agents" MVP where each signed-up user can own one or more inboxes at `@clankr.email`, send and receive through API, read threaded conversations, and subscribe to webhook events.

## 2) Requirements mapped to MVP

1. On signup, auto-provision an inbox: `id@clankr.email`.
2. User can assign one friendly alias per inbox: `name@clankr.email`.
3. Multi-inbox per user is supported from day 1.
4. App can send and receive email through API.
5. App can list threads and read thread messages through API.
6. App supports webhook subscriptions for email events.
7. Implementation is fully on Cloudflare primitives.

## 3) Cloudflare architecture

- **Runtime/API**: TanStack Start Worker (`fetch`) with oRPC router (`#/orpc/router`) for typed, authenticated APIs.
- **Inbound email**: Worker `email(message, env, ctx)` handler via Cloudflare Email Routing.
- **Outbound email**: `env.EMAIL.send()` (Cloudflare Email Service sending binding).
- **Primary relational store (MVP)**: one D1 database for auth-linked app data, inboxes, threads, messages, and webhook metadata.
- **ORM/migrations**: Drizzle ORM + Drizzle Kit against a single schema/migration chain.
- **Blob/fidelity store**: Cloudflare R2 for raw MIME, attachments, and oversized message bodies.
- **Async jobs**: Cloudflare Queues for webhook fanout + retry.
- **Observability**: Workers logs + optional Analytics Engine events.

## 4) Domain and routing setup (day 0)

1. Onboard `clankr.email` in Cloudflare Email Service for:
   - **Email Sending** (SPF/DKIM records)
   - **Email Routing** (MX/SPF/DKIM records)
2. Update `wrangler.jsonc`:
   - Add one D1 binding for the application database.
   - Add `send_email` binding named `EMAIL` (remote binding enabled for local dev).
   - Add R2 binding for raw MIME, attachments, and oversized bodies.
   - Add queue producer/consumer bindings for webhook delivery jobs.
3. Configure Email Routing rule:
   - Route catch-all `*@clankr.email` to this Worker.
4. Verify with smoke tests:
   - send test email from Worker
   - receive test email into Worker `email()` handler

## 5) Data model (single D1 + Drizzle)

All app-facing relational data lives in one D1 database for MVP. R2 is used only for blob/fidelity storage, not as the normal message read path.

### DB topology (MVP)

- `APP_DB`:
  - auth tables
  - `inboxes`
  - `email_threads`
  - `email_messages`
  - `webhook_subscriptions`
  - `webhook_deliveries`

### ID format (all entities)

- Use prefixed ULID IDs for readability + time sorting.
- Format: `<prefix>_<ulid>`.
- Prefixes:
  - `in_` inbox
  - `th_` thread
  - `em_` message
  - `wh_` webhook subscription
  - `wd_` webhook delivery
  - `evt_` emitted event

### `inboxes` (`APP_DB`)

- `id` (text pk, `in_<ulid>`)
- `user_id` (text, indexed, non-unique)
- `default_local_part` (text, unique, immutable)
- `custom_local_part` (text, unique, nullable) // user-friendly alias
- `is_active` (integer boolean)
- `created_at`, `updated_at`

### `webhook_subscriptions` (`APP_DB`)

- `id` (text pk, `wh_<ulid>`)
- `user_id` (text, indexed)
- `inbox_id` (text, nullable, indexed) // null means all user inboxes
- `url` (text)
- `secret` (text, encrypted/wrapped)
- `event_types_json` (text)
- `is_active` (integer boolean)
- `created_at`, `updated_at`

### `email_threads` (`APP_DB`)

- `id` (text pk, `th_<ulid>`)
- `inbox_id` (text, indexed)
- `subject_normalized` (text)
- `participant_hash` (text) // deterministic key for fallback threading
- `last_message_at` (timestamp, indexed)
- `created_at`, `updated_at`

### `email_messages` (`APP_DB`)

- `id` (text pk, `em_<ulid>`)
- `inbox_id` (text, indexed)
- `thread_id` (text, indexed)
- `direction` (text: `inbound|outbound`)
- `provider_message_id` (text, nullable, indexed)
- `internet_message_id` (text, nullable, indexed)
- `from_email` (text)
- `to_emails_json` (text)
- `cc_emails_json` (text)
- `bcc_emails_json` (text)
- `subject` (text)
- `snippet` (text) // short preview for list views
- `text_body` (text, nullable) // normal read path for parsed text body
- `html_body` (text, nullable) // normal read path for parsed/sanitized html body
- `body_storage_mode` (text: `inline|oversized`)
- `raw_mime_r2_key` (text, nullable)
- `oversized_body_r2_key` (text, nullable)
- `body_size_bytes` (integer, nullable)
- `status` (text: `received|accepted|failed|rejected`)
- `error_code`, `error_message` (nullable)
- `sent_at`, `received_at`, `created_at`

### `webhook_deliveries` (`APP_DB`)

- `id` (text pk, `wd_<ulid>`)
- `subscription_id` (text, indexed)
- `event_id` (text, indexed)
- `attempt` (integer)
- `status` (text: `queued|success|failed|dead`)
- `response_status` (integer nullable)
- `next_retry_at` (timestamp nullable, indexed)
- `created_at`, `updated_at`

## 6) Inbox identity strategy

- On inbox creation, generate stable default local part:
  - format: `u_<short-ulid-slice>`
  - result: `u_01j...@clankr.email`
- Each inbox can optionally set one friendly local part in `custom_local_part`.
- Validation for custom local part:
  - lowercase, alnum + hyphen, 3-32 chars
  - reserved word blocklist (`admin`, `support`, `postmaster`, etc.)
  - uniqueness enforced by DB unique index
- Inbound resolution:
  - local part matches `custom_local_part` first, then `default_local_part`
  - if no match: `message.setReject('Unknown inbox')`

## 6A) D1 + Drizzle scaffolding (local + prod)

Start with one application D1 database from day 1. Do not introduce multi-DB routing or sharding until the workload proves it is necessary.

### Wrangler bindings

Use one D1 binding and one migration directory:

```jsonc
{
  "d1_databases": [
    {
      "binding": "APP_DB",
      "database_name": "clankr-email",
      "database_id": "<uuid>",
      "migrations_dir": "drizzle"
    }
  ]
}
```

### Drizzle file layout

```txt
src/db/schema.ts
drizzle/*
drizzle.config.ts
```

### Runtime DB client (Worker)

- Create one Drizzle client for `APP_DB` and use it for auth, inboxes, threads, messages, and webhooks.
- Keep the normal product read path inside D1.
- Use R2 only for raw MIME, attachments, and oversized payload overflow.

### Migration commands

Generate migrations from the single app schema:

```bash
pnpm drizzle-kit generate --config=drizzle.config.ts
```

Apply locally:

```bash
pnpm wrangler d1 migrations apply APP_DB --local
```

Apply remotely:

```bash
pnpm wrangler d1 migrations apply APP_DB --remote
```

### Local development workflow

1. Run `pnpm dev` once to initialize local D1 state.
2. Generate migrations from the app schema.
3. Apply local migrations for the app DB binding.
4. Run API and inbound-email smoke tests.

### Production workflow

1. Create the database once (`wrangler d1 create ...`) and commit the ID into `wrangler.jsonc`.
2. Apply remote migrations.
3. Deploy Worker.
4. Verify no pending migrations:
   - `wrangler d1 migrations list APP_DB --remote`

### When to revisit storage topology later

Only revisit sharding or an external database if real usage justifies it, for example:

1. D1 write throughput or operational limits become a bottleneck.
2. Search, reporting, or multi-tenant data volume outgrows a single DB comfortably.
3. You want stronger SQL ergonomics and scaling via an external Postgres provider.

Until then, keep one D1 database and evolve the schema conservatively.

### Migration safety rules

- Prefer additive, backward-compatible migrations.
- Avoid large rewrites of hot message tables without a staged rollout.
- If you later introduce overflow storage or a different primary DB, dual-write and backfill before switching reads.

## 7) API surface (MVP, oRPC-first)

All product APIs are defined as oRPC procedures (single source of truth) in `#/orpc/router`.

- Transport route: `src/routes/api.rpc.$.ts` with `/api/rpc/*`.
- OpenAPI bridge: `src/routes/api.$.ts` with `/api/*` and schema at `/api/openapi.json`.
- Every procedure requires auth and ownership-scoped queries against the single app DB.

### Inbox procedures

- `inboxes.list` -> list user inboxes
- `inboxes.create` -> create additional inbox
- `inboxes.get` -> inbox detail
- `inboxes.updateAlias` -> set/clear `custom_local_part`

### Send procedures

- `messages.send`
  - input: `inboxId`, `to[]`, `cc[]`, `bcc[]`, `subject`, `text|html`, `replyToThreadId?`
  - action: validate ownership + `env.EMAIL.send`
  - output: internal message id + provider message id + status

### Thread/message read procedures

- `threads.listByInbox` -> threads by `last_message_at desc`
- `threads.listMessages` -> paginated messages
- `messages.get` -> message detail + body fetch strategy

### Webhook procedures

- `webhooks.create` -> create subscription
- `webhooks.list` -> list subscriptions
- `webhooks.update` -> pause/resume, event filter updates
- `webhooks.delete` -> delete
- `webhooks.test` -> send test event

## 8) Inbound email processing flow

1. Cloudflare routes incoming email to Worker `email()` handler.
2. Resolve `message.to` local part to inbox in `APP_DB` (`custom_local_part` then `default_local_part`).
3. Parse MIME body from `message.raw` (robust parser library, not regex).
4. Compute thread in `APP_DB`:
   - preferred: `In-Reply-To`/`References` match existing `internet_message_id`
   - fallback: normalized subject + participants hash within inbox
5. Persist message metadata and parsed body in `APP_DB`.
6. Persist raw MIME to R2, plus oversized bodies and attachments when needed.
7. Update thread `last_message_at` in `APP_DB`.
8. Emit `message.received` event to queue for webhooks.

## 9) Outbound sending flow

1. Authenticated user calls `messages.send` procedure.
2. Validate sender inbox ownership in `APP_DB` and enforce recipient limits.
3. Persist outbound metadata row in `APP_DB` (`accepted|failed`).
4. Call `env.EMAIL.send(...)`.
5. Persist provider `messageId` and error code/message if failed (`APP_DB`).
6. Store parsed outbound bodies in `APP_DB`; store raw MIME or oversized payloads in R2 when needed.
7. Thread linkage:
   - if replying: include `In-Reply-To`/`References` headers
   - else: create/find thread by subject + participants in `APP_DB`
8. Emit events:
   - `message.sent.accepted`
   - `message.sent.failed`

## 10) Webhook event system

### Event types (MVP)

- `message.received`
- `message.sent.accepted`
- `message.sent.failed`
- `thread.updated`
- `inbox.alias.updated`

### Delivery design

- Push events to Cloudflare Queue.
- Consumer posts JSON payload to subscriber URL.
- Sign requests with `X-Clankr-Signature: sha256=<hmac>` and include timestamp.
- Retry policy: exponential backoff (example: 1m, 5m, 30m, 2h, 12h), then dead-letter.
- Idempotency: include stable `event_id` in payload + headers.

Payload shape:

```json
{
  "id": "evt_01jng0f3p5q8rqm3x7f4a9w2bz",
  "type": "message.received",
  "createdAt": "2026-03-03T00:00:00.000Z",
  "data": {
    "inboxId": "in_01jng0...",
    "threadId": "th_01jng0...",
    "messageId": "em_01jng0..."
  }
}
```

## 11) Security and tenancy rules

- Every read/write query scoped by `session.user.id` ownership.
- Validate external input at procedure boundaries (oRPC + Zod) before DB writes.
- No reliance on DB foreign keys for auth boundaries.
- Never expose raw provider errors directly without sanitizing.
- Rate-limit `messages.send` per user + per inbox.
- Enforce max recipients and payload size before `env.EMAIL.send`.
- For webhook URLs:
  - allow only `https`
  - block localhost/private CIDR in production
  - store secrets encrypted.

## 12) Implementation phases

Test work starts in Phase 0 and continues in every phase. New primitives should ship with tests in the same change set, not as a later hardening pass.

### Phase 0: DB scaffolding + migration pipeline

- [x] Add one D1 binding for the application DB.
- [x] Keep one Drizzle schema/config/migration directory.
- [x] Add CLI scripts for generate/apply/list migrations locally and remotely.
- [x] Scaffold oRPC procedure modules/contract in `#/orpc/router` for inbox/send/thread/webhook domains.
- Add a test harness for D1, R2, Queues, and Email bindings so each primitive can be exercised without a full end-to-end run.
- Add fixture factories, MIME fixtures, and test helpers before feature work starts.

### Phase 1: Foundation

- [x] Add schema + migrations for inbox, thread, message, and webhook tables.
- [x] Add prefixed ULID utility (`in_`, `th_`, `em_`, `wh_`, `evt_`, `wd_`).
- Add `EMAIL`, R2, and Queue bindings in Wrangler.
- Add migration smoke checks in CI (`migrations list` should be empty after apply).
- Write the first unit and repository tests for ID generation, alias validation, and schema-level helpers as the foundation code is added.

### Phase 2: Inbox provisioning + alias

- [x] Hook signup flow to auto-create first inbox.
- [x] Implement `inboxes.create` procedure.
- [x] Implement `inboxes.updateAlias` procedure with uniqueness validation.
- Write integration tests for signup provisioning, additional inbox creation, alias updates, reserved-word rejection, and uniqueness collisions alongside the implementation.

### Phase 3: Receive pipeline

- Implement `email()` handler with inbox resolution in `APP_DB`, MIME parsing, D1 persistence, and R2 raw MIME/overflow storage.
- Write integration tests for routing + threading fallback before wiring the full handler.
- Add fixture-driven inbound tests for unknown inbox rejection, reply-chain threading, fallback threading, duplicate provider/internet message IDs, and oversized body spillover to R2 as each case is implemented.

### Phase 4: Send pipeline

- Implement `messages.send` procedure backed by `env.EMAIL.send` with app-db ownership checks.
- Persist send outcomes in `APP_DB` and map Cloudflare error codes to API responses.
- Write integration tests covering happy-path send, ownership rejection, recipient/payload validation, provider failure mapping, reply headers, and DB persistence of send status alongside the procedure work.

### Phase 5: Thread procedures

- Implement `threads.listByInbox`, `threads.listMessages`, and `messages.get` procedures against `APP_DB`, with R2 fallback only for oversized bodies if needed.
- Add dashboard UI to manage inboxes and read threads.
- Write API tests for pagination, ordering, ownership boundaries, body retrieval from D1, and R2 fallback for oversized messages while these procedures are introduced.

### Phase 6: Webhooks

- Implement `webhooks.create/list/update/delete/test` procedures.
- Queue-based delivery worker with HMAC signatures + retries.
- Write tests for subscription scoping, event filtering, signature generation, retry scheduling, idempotent delivery records, and dead-letter transition as the webhook flow is built.

### Phase 7: Hardening

- Add rate limits, structured logs, and basic analytics.
- Validate read latency for thread/message queries and R2 overflow retrieval.
- Expand smoke/load coverage and finalize the runbook; this phase hardens an already-tested system rather than backfilling missing tests.

## 13) Testing strategy

Testing is a first-class requirement. Every primitive should be testable in isolation, and every user-visible flow should have at least one integration path and one end-to-end smoke path.

Tests are written from the beginning of implementation, not collected at the end. Each feature or primitive should land with its own unit, integration, or worker-level coverage in the same phase that introduces it.

### Test layers

- **Unit tests**: pure logic such as ID generation, alias normalization/validation, subject normalization, participant hashing, threading heuristics, webhook signature generation, and retry backoff math.
- **Repository/service tests**: DB-facing helpers against local D1 for inbox lookup, thread selection, message insert/update, webhook subscription queries, and ownership-scoped reads.
- **Procedure/API integration tests**: oRPC procedures exercised with auth context, validating input parsing, auth boundaries, persistence, and API outputs.
- **Worker primitive tests**: direct tests for `email()` handling, queue consumers, and any body-storage helpers with mocked Cloudflare bindings.
- **End-to-end smoke tests**: the smallest real path that proves signup -> inbox provisioning -> receive/send -> thread read -> webhook delivery.

### What must be independently testable

- **Inbox provisioning**: signup creates exactly one inbox with a stable default local part.
- **Alias management**: alias validation, uniqueness, reserved words, clear/reset behavior.
- **Inbound routing**: local-part resolution, unknown inbox rejection, active/inactive inbox handling.
- **Message parsing**: MIME parsing to normalized subject, participants, text/html body, snippet, message IDs.
- **Threading**: `In-Reply-To`/`References` matching first, deterministic fallback second.
- **Message persistence**: inserts, idempotency behavior, status transitions, and thread `last_message_at` updates.
- **Body storage**: normal bodies read from D1; oversized bodies/raw MIME/attachments written to and retrievable from R2.
- **Outbound sending**: auth checks, payload validation, provider success/failure mapping, reply header generation.
- **Read APIs**: inbox/thread/message listing and detail endpoints with pagination and ownership enforcement.
- **Webhooks**: subscription CRUD, event fanout, HMAC signing, retry scheduling, dead-letter behavior.

### Test data and fixtures

- Keep reusable MIME fixtures for plain text, html-only, multipart alternative, attachment-bearing, malformed-but-accepted, reply-chain, and oversized emails.
- Keep deterministic fixture IDs and timestamps so thread ordering and webhook signatures are stable in tests.
- Add helper factories for users, inboxes, threads, messages, subscriptions, and delivery attempts.
- Make oversized-body fixtures explicit so R2 fallback behavior is always covered by tests, not assumed.

### Local validation workflow

Minimum validation before merging a feature:

1. Run focused unit/integration tests for the changed area.
2. Run `pnpm test`.
3. Run `pnpm exec tsc --noEmit`.
4. Run at least one smoke path covering the affected primitive end-to-end.

### CI expectations

- Run all tests on every PR.
- Apply local D1 migrations in CI before integration tests.
- Fail CI if migrations are pending after generation/apply checks.
- Treat missing coverage for a new primitive as incomplete work, not follow-up polish.

## 14) MVP acceptance criteria

1. Signup auto-creates a working `@clankr.email` inbox.
2. User can create additional inboxes and set one friendly alias per inbox.
3. Inbound emails to default or custom local parts resolve via `APP_DB` and appear in thread/message APIs.
4. `messages.send` sends mail from selected inbox and persists status/message IDs in `APP_DB`.
5. Thread grouping works for standard reply chains.
6. Webhook subscribers receive signed events with retries.
7. End-to-end runs on Cloudflare (Workers + Email Service + D1 + R2 + Queues).
8. All IDs are prefixed ULIDs and are time-sort friendly.
9. Local + remote migrations are repeatable for `APP_DB`.
10. MVP API surface is implemented in oRPC procedures and served via `/api/rpc/*` (with OpenAPI output at `/api/openapi.json`).

## 15) Known MVP constraints

- Email Service is in private beta; API surface and limits can change.
- Sending is via Worker binding (no standalone REST in beta).
- Full MIME/attachment extraction may be partial for edge cases.
- Raw MIME and oversized body storage in R2 is a fidelity/overflow path, not the primary read path.
- Delivery/open tracking is out of scope for MVP.
- If a message body exceeds comfortable D1 inline limits, that body may need to spill to R2 and be read via a secondary path.

## 16) Nice-to-have after MVP

- Team/shared inbox permissions.
- Attachment retrieval via signed R2 URLs.
- Search index over subject/body/contact.
- Rules engine (auto-label, auto-forward, AI categorization).
- Per-inbox outbound domains and DKIM profiles.
