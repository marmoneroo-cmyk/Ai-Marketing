# BrandPilot — Autonomous AI Marketing OS

> **Codename:** `BrandPilot` (placeholder — rename freely).
> An autonomous marketing department for small businesses. The owner connects their
> social accounts, answers a short questionnaire, and the platform learns the business,
> creates a shared **Business Brain**, and runs content, conversations, lead
> qualification, sales assistance, and continuous optimization on their behalf.

**This is not an AI content generator.** Content generation is one output of a system
whose real job is to *understand a business* and then act as its marketing team.

---

## The One Idea

Every module reads from and writes to a single **Business Brain** — the source of truth.
No module operates independently. Understanding comes first; action comes second.

```
Connect accounts ─▶ Discovery Engine ─▶ Business Brain (DNA) ─▶ every module acts ─▶
   ─▶ signals flow back ─▶ Business Brain updates ─▶ better decisions ─▶ (loop)
```

The business owner should spend **< 15 minutes per week** in the system.

---

## Documentation

| # | Doc | What it covers |
|---|-----|----------------|
| 00 | [Vision & Principles](docs/00-vision-and-principles.md) | Vision, non-goals, AI operating rules, trust & safety, the autonomous loop |
| 01 | [System Architecture](docs/01-system-architecture.md) | Tech stack, Business Brain memory model, agent runtime, integrations, security |
| 02 | [Database Schema](docs/02-database-schema.md) | Full PostgreSQL schema (structured + semantic + episodic memory) |
| 03 | [Module Hierarchy](docs/03-module-hierarchy.md) | The 13 modules + cross-cutting concerns, dependencies, per-module contracts |
| 04 | [Implementation Roadmap](docs/04-implementation-roadmap.md) | Phases 0–8, exit criteria, reuse candidates, review gates |
| 05 | [Reuse Decisions](docs/05-reuse-decisions.md) | Build-vs-adopt calls per subsystem |
| 06 | [Running & Deploying](docs/06-running-and-deploying.md) | Local setup, env, deploy targets, RLS deploy posture, sign-off checklist |
| 07 | [Production Audit](docs/07-production-audit.md) | Hardening status, quality-dimension audit, remaining external-integration edges |

Start with **00** for the "why", **01** for the "how", **04** for the "when", **07** for "what's left".

---

## Technology Decisions (assumptions — overridable)

Chosen for a modular, API-first, production-grade, AI-heavy platform. Tell me to change any of these.

| Layer | Choice | Why |
|-------|--------|-----|
| Monorepo | Turborepo + pnpm | One repo, many packages, shared types |
| Language | TypeScript (end-to-end) | Shared domain types across API, workers, web |
| Web dashboard | Next.js 16 (App Router) + Tailwind + shadcn/ui | Modern, fast, RSC, great DX |
| API + services | NestJS | Modules, DI, guards, interceptors, OpenAPI — fits "modular + RBAC + API-first" |
| Async / agents | BullMQ on Redis | Durable job queues for autonomous workers & schedules |
| Database | PostgreSQL 16 + `pgvector` | Relational truth + semantic memory in one store |
| ORM | Drizzle ORM | Type-safe, SQL-close, first-class pgvector |
| Reasoning AI | Anthropic Claude (Opus 4.8 / Sonnet 5 / Haiku 4.5) | Tiered by task: strategy / generation / classification |
| Embeddings | Voyage AI (`voyage-3`) | High-quality retrieval for the Business Brain |
| Media generation | fal.ai (image/video) | Creative Studio assets |
| Auth + RBAC | JWT (argon2 + Passport / `@nestjs/jwt`) + org model + Postgres RLS | Multi-tenant, role-based, auditable; fail-closed global guards |
| Object storage | S3-compatible (R2 / S3) | Media & document assets |
| Observability | OpenTelemetry + pino + Sentry | Tracing, structured logs, error tracking |
| Validation | Zod at every boundary | Never trust external data |

Full rationale and the model-routing policy live in [docs/01-system-architecture.md](docs/01-system-architecture.md).

---

## Status

🟢 **Built, hardened, and verified.** All 12 capability modules + the AI core, API, worker,
and web are implemented and integrated. The autonomous loop is wired end-to-end with security
hardening, caching, spend caps, observability, and inbound webhooks. Verified in-repo with
no external services:

**Core verification:**
- `pnpm -r typecheck` — **23/23 projects, 0 errors**
- `pnpm -r test` — **all suites pass**
- `pnpm db:generate` — 38-table schema + RLS policies → **valid Postgres migration**
- `pnpm --filter @brandpilot/web build` — **production bundle** (12 routes)
- API **boots** with RBAC: `GET /health` → `200`, unauth routes → `401`

**Security & autonomy hardened:**
- ✅ Signal→automation closed loop: module signals → durably recorded → automation.signal queue
- ✅ Scheduler operational: daily.tick (brain reindex), per-minute publish/workflow ticks
- ✅ Inbound webhooks: Meta Graph API & WhatsApp Cloud API with HMAC verification + verify tokens
- ✅ OAuth state validation: CSRF protection via signed, expiring state tokens
- ✅ RLS enforcement: `withOrgScope` wraps all org-scoped reads, database enforces isolation
- ✅ Spend caps: per-org daily LLM/media budgets enforced via Redis-backed SpendGuard
- ✅ Caching: read-through Redis cache (5-min TTL) for voice, brand kit, profile reads
- ✅ Observability: OpenTelemetry tracing, pino structured logs, Sentry error tracking
- ✅ Dark mode UI, mobile-responsive dashboard, accessibility foundations

**Remaining for a live run:**
- Running Postgres 16 + Redis + API keys (Anthropic, Voyage, Meta, fal, Stripe)
- End-to-end integration test of the full autonomous loop with real services
- E2E testing of critical user flows (onboarding, publish, conversation replies)

See [docs/06-running-and-deploying.md](docs/06-running-and-deploying.md) for setup
instructions.
