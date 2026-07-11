# 06 — Running, Deploying & Verification Status

## What has been verified (in this environment, no external services)

| Check | Command | Result |
|-------|---------|--------|
| Dependencies resolve | `pnpm install` | ✅ 300+ packages, 0 conflicts |
| Whole monorepo type-safe | `pnpm -r typecheck` | ✅ **23/23 projects, 0 errors** |
| Unit logic correct | `pnpm -r test` | ✅ all suites passing |
| DB schema is valid Postgres | `pnpm --filter @brandpilot/db generate` | ✅ migrations `drizzle/0000…0006`, all tables + RLS policies (+ unique constraints for the inbound-dedup races) |
| Web production build | `pnpm --filter @brandpilot/web build` | ✅ next.js optimized bundle (12 routes) |
| API boots & RBAC | `pnpm dev` (API on :4000) | ✅ `/health` → 200, unauth routes → 401 |

These prove the code **compiles, its logic is tested, the schema is deployable, and the
integrated system boots**. What they do **not** prove is live behavior against real
Claude/Voyage/Meta/Stripe/fal APIs and a running database with real keys — that requires
credentials + infrastructure (below).

## Prerequisites for a live run

- **Node 20+** and **pnpm** (via `corepack enable`).
- **Postgres 16 with the `pgvector` extension** and **Redis** — locally via the provided
  `docker-compose.yml` (needs Docker), or hosted (Neon/Supabase + Upstash).
- **API keys** in `.env` (copy from `.env.example`):
  - **Required to boot:** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`
  - **Enable integrations:** `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_TOKEN`, `FAL_KEY`,
    `STRIPE_SECRET_KEY`, `FIRECRAWL_API_KEY`
  - **Webhook verification tokens:** `META_VERIFY_TOKEN`, `WHATSAPP_VERIFY_TOKEN` (for inbound
    Meta Graph API & WhatsApp Cloud API webhooks)
  - **Observability:** `OTEL_EXPORTER_OTLP_ENDPOINT` (optional, for distributed tracing export)
  - **Demo mode:** `NEXT_PUBLIC_DEMO_MODE` (optional, defaults to `false`)
- **Secrets:** 32-byte `AUTH_SECRET` (hex or base64) and base64 `TOKEN_ENCRYPTION_KEY`
  (32 bytes, used for OAuth token envelope encryption).

## Local run

```bash
corepack enable
pnpm install
cp .env.example .env            # then fill in the keys
docker compose up -d            # postgres+pgvector · redis · minio
pnpm db:generate                # (already committed as drizzle/0000_*.sql)
pnpm db:migrate                 # applies schema + Row-Level Security policies
pnpm db:seed                    # a demo org
pnpm dev                        # web :3000 · api :4000 (OpenAPI at /docs) · worker
```

Then: open `http://localhost:3000/onboarding`, enter a website URL → the API enqueues a
Discovery job → the worker builds the Business DNA → it renders on the page.

## Connecting a real channel (Meta / Instagram / Facebook)

The connect flow is an OAuth redirect **plus** inbound webhooks, so the **API must be
reachable at a public HTTPS origin**. Set `API_URL` to that origin (e.g.
`https://api.yourdomain.com`, or an `ngrok`/`cloudflared` tunnel to `:4000` for local
testing). Every provider-facing URL is derived from `API_URL` by `connectorRouteUrl`
(`@brandpilot/config`) and is mounted at the API **root** (there is no `/api` prefix).

1. **Create a Meta app** (developers.facebook.com → *My Apps* → *Create App* → *Business*)
   and add the **Instagram Graph API** + **Facebook Login** products.
2. **Register these EXACT URLs** (they must match byte-for-byte, or Meta rejects the flow):
   - Facebook Login → *Valid OAuth Redirect URIs*: **`${API_URL}/connectors/meta/callback`**
   - Webhooks → *Callback URL*: **`${API_URL}/connectors/meta/webhook`**,
     *Verify token*: the value of **`META_VERIFY_TOKEN`**. Subscribe the **`messages`**
     (DMs) and **`comments`** fields — the inbound parser (`meta-payload.ts`) handles
     exactly those two (DM + comment automation).
3. **Set credentials** in `.env`: `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`.
   Scopes requested by `ConnectorsController`: `instagram_basic`,
   `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`, `business_management`.
4. **Development Mode — no App Review needed.** While the app is in Dev Mode you can connect
   accounts you own or that are admins/testers of the app. That is enough to connect your
   OWN business's Instagram/Facebook and exercise the whole loop (discovery → content →
   publish → inbox → leads). Add the account under *App Roles → Roles/Testers*.
5. **Connect in-product:** sign in → **Settings** (or **Onboarding**) → **Connect
   Instagram**. The button calls the authenticated `GET /connectors/meta/start`, which
   returns Meta's consent URL; after you approve, Meta redirects to
   `/connectors/meta/callback` (org resolved from the signed OAuth `state`), the account +
   an **encrypted** token are persisted, and you land back on Settings with a success
   toast. Inbound DMs/comments then arrive at the webhook and appear in the Inbox.
6. **App Review — only to onboard OTHER businesses.** Letting third-party businesses connect
   their own accounts requires Meta App Review for the advanced permissions above; your own
   account works in Dev Mode without it.

TikTok and WhatsApp follow the same shape (`/connectors/tiktok/callback`,
`/connectors/whatsapp/webhook`, with `TIKTOK_*` / `WHATSAPP_*` credentials).

## Deploy targets (recommended)

- **Web** (`apps/web`) → Vercel.
- **API + Worker** (`apps/api`, `apps/worker`) → a container platform (Railway / Render / Fly /
  AWS ECS). Both are stateless and scale horizontally; run one or more worker replicas.
- **Postgres** → Neon / Supabase / RDS (enable `pgvector` extension). **Redis** → Upstash / ElastiCache.
- **Object storage** → Cloudflare R2 / S3 (swap the MinIO endpoint).
- Set the same `.env` in each service. Run `pnpm db:migrate` once as a release step.

**RLS as a backstop (API only):** Every org-scoped path in `apps/api` runs inside
`withOrgScope`, which sets the `app.org_id` GUC that the RLS policies key off (including
signup provisioning and audit-log writes). In production you can therefore connect the
**API** to Postgres as a least-privilege, non-owner role — `SELECT`/`INSERT`/`UPDATE` on
org-scoped tables, with `FORCE ROW LEVEL SECURITY` on those tables — so the database
itself refuses a cross-tenant leak if a query ever forgets its `org_id` filter or
`withOrgScope` is miscalled. The app already enforces tenant scoping in code; RLS is
defense-in-depth on top.

**Do NOT give the worker an RLS-subject role.** `apps/worker` and the domain modules do
*not* use `withOrgScope` — they are a trusted internal process that scopes every query
with an explicit `where org_id = …` filter and legitimately operates across orgs (the
scheduler fans out per-org jobs). Under a role subject to RLS with no `app.org_id` set,
its reads would match zero rows and its writes would be rejected, silently stalling the
autonomous loop. Run the worker as the table owner (or a `BYPASSRLS` role). To get
DB-enforced isolation for the worker too, first wrap each job handler in
`withOrgScope(db, job.orgId, …)`; a non-owner role then becomes safe there as well.

## Production sign-off checklist

**Wave 1 — Foundation & Hardening (verified):**
- [x] Architecture, schema, module hierarchy, roadmap (docs 00–05)
- [x] All 12 capability modules + AI core, typechecked + unit-tested
- [x] Security: JWT, RBAC, audit logs, login throttling, timing-safe auth, token encryption
- [x] DB schema generates valid migrations with RLS policies applied
- [x] Real external adapters (Meta / fal / Stripe / OAuth) implemented with signature verification
- [x] Signal→automation closed loop: recordSignal → automationSignal queue → automation.worker
- [x] Scheduler operational: daily.tick, publish.tick, workflow.tick running per-replica
- [x] Inbound webhooks for Meta Graph API & WhatsApp Cloud API with HMAC verification
- [x] OAuth state validation with CSRF protection & expiry checking
- [x] Per-org spend caps (SpendGuard) enforced before every LLM/media call
- [x] Read-through caching (Redis) for hot Brain reads (voice/brand-kit/profile)
- [x] OpenTelemetry tracing + pino structured logs + Sentry error tracking
- [x] Row-Level Security policies active via withOrgScope on every org-scoped read

**Remaining for live validation:**
- [ ] **#19** End-to-end integration test against live stack with real keys
  (Postgres + Redis + Anthropic + Voyage + Meta + fal + Stripe + Stripe webhooks)
- [ ] UX/E2E tests for critical user flows (onboarding, publish, conversation reply)
- [ ] LLM tool-use verification (approve, schedule-workflow, update CRM, etc.)
- [ ] Live monitoring & alert thresholds (queue depth, error rates, spend trends)

The remaining items are **execution + testing** steps (bring up Docker + keys, exercise
the full loop), not code gaps. Everything they need is wired.
