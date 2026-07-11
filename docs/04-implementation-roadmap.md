# 04 — Implementation Roadmap

Sequencing principle: **build the wedge first.** The platform's differentiator is that it
*understands the business* before doing anything. So Foundations → Business Brain → Discovery
come before content, conversations, and sales. Each phase ships **working, testable software**
and gets its own detailed TDD plan (`docs/superpowers/plans/…`) written just before it starts.

**Per-phase gates (every phase, per project standards):**
- ✅ TDD, 80%+ coverage (unit + integration; E2E on critical flows)
- ✅ `code-reviewer` pass; `security-reviewer` pass for anything touching auth, tokens, payments, PII, or external input
- ✅ Zod validation at boundaries · audit logging · migrations reversible
- ✅ No CRITICAL/HIGH review findings open at phase exit

---

## Phase 0 — Foundations  *(the skeleton)*

**Goal:** a running, secure, multi-tenant skeleton with CI, DB, auth, and the shared packages
stubbed.

**Deliverables**
- Turborepo + pnpm monorepo; `apps/{web,api,worker}`, `packages/*` scaffolded.
- `db` package: Drizzle schema from [doc 02], first migration, seed script, RLS policies.
- `api`: NestJS gateway, health, OpenAPI, Zod pipe, error envelope, rate limiting.
- JWT sessions (argon2 + Passport / `@nestjs/jwt`) + org model + RBAC guards + `audit_logs` middleware.
- `agent-runtime` + `business-brain` package skeletons with typed interfaces (no logic yet).
- Redis/BullMQ wired; one demo job end-to-end. Docker compose for local (pg+redis+minio).
- CI (typecheck, lint, test, migrate-check); OTel + pino + Sentry baseline.
- **Research & reuse spike** (honors the mandatory rule): `gh search` for Postiz/Mixpost
  (publishing), Chatwoot (inbox), Cal.com (booking), Twenty (CRM), Firecrawl — decide
  fork/wrap/build per component; record decisions in `docs/05-reuse-decisions.md`.

**Exit criteria:** `pnpm dev` boots web+api+worker; a seeded org logs in; a gated demo endpoint
enforces RBAC and writes an audit log; migrations up/down clean; CI green.

---

## Phase 1 — Business Brain + Discovery Engine  *(the wedge)*

**Goal:** connect Meta, scan the footprint, and produce a real **Business DNA** the owner can review.

**Deliverables**
- `business-brain`: four layers live — structured CRUD, `upsertKnowledge` (Voyage embeddings +
  chunking), `retrieve()` with confidence, `recordSignal`, `recomputeDerived` scaffold.
- `connectors`: Meta (Instagram+Facebook) OAuth + pull (posts/media/comments/insights);
  Firecrawl website/reviews; encrypted `connector_tokens`.
- `discovery`: ingestion pipeline → normalize → embed → seed profile/products/services/
  personas/competitors; `discovery_runs` progress. (Brand-kit colors/fonts/logo extraction →
  `brand_kits` is **not yet wired** — see docs/07.)
- Onboarding flow (web): connect accounts + ~20 gap-filling questions; Business DNA review screen.

**Exit criteria:** a test business connects Instagram, discovery completes, and the dashboard
shows a populated, source-cited Business DNA with completeness score. `retrieve()` returns
grounded chunks with citations.

**Reuse:** Firecrawl (direct). **Risk:** platform API limits/permissions — build resilient,
resumable ingestion with partial-success handling.

---

## Phase 2 — Brand & Audience Intelligence

**Goal:** turn raw DNA into a usable **brand voice profile** and **audience segments/personas**.

**Deliverables**
- `brand-intelligence`: voice profile (personality, tone, vocabulary, emoji, sentence stats,
  do/don't examples), content pillars, best/worst pattern detection → `brand_voice_profiles`,
  `insights`.
- `audience-intelligence`: personas + segments, pain points, triggers, objections, sentiment →
  `customer_personas`, `audience_segments`, `objections`.
- `recomputeDerived` job scheduled (nightly + event-triggered).
- Web: editable Brand & Audience screens (owner corrections feed back into the Brain).

**Exit criteria:** voice profile + ≥2 segments generated with confidence scores; owner edits
persist and are used downstream.

---

## Phase 3 — Content Engine + Creative Studio  *(first real output, gated)*

**Goal:** generate a month of on-brand, per-platform content with visuals — behind approval.

**Deliverables**
- `content-engine`: strategy → monthly calendar → weekly → `content_items` → per-platform
  `content_variants` (caption/hook/CTA/hashtags/SEO) with **voice-conformance scoring**.
- `creative-studio`: fal.ai image/carousel/story/cover generation + reel storyboards/scripts,
  brand-kit adherence check → `creative_assets`.
- Web: content calendar, variant editor, one-click approve/changes/reject (`content_approvals`).

**Exit criteria:** a 4-week calendar generates with assets; every variant scores above the
voice threshold or is flagged; approval flow works end-to-end.

---

## Phase 4 — Publishing Engine

**Goal:** schedule and publish approved content reliably across platforms.

**Deliverables**
- `publishing`: scheduling, best-time optimization (from `kpi_daily`), feed preview, cross-
  publish, pause/cancel, **retryable** `publish_jobs` with dead-letter + alerting.
- Connectors: Meta + TikTok + GBP publish; capture `external_post_id`.
- Approval-gated publish, promotable to Auto with rate/volume caps.

**Exit criteria:** approved post schedules, publishes to a sandbox/test account, records the
external id, retries on transient failure, and emits `post_published`.

---

## Phase 5 — Conversation AI  *(guardrails first)*

**Goal:** monitor and respond to comments/DMs with approved-knowledge-only answers.

**Deliverables**
- `conversation`: webhook intake (Meta/WhatsApp) → intent triage (Haiku) → grounded reply
  (Sonnet) with citations; objection handling; info collection; **escalation triggers**;
  human-handoff inbox.
- Guardrails: banned topics, PII policy, confidence-threshold escalation, per-account kill
  switch. Suggest-mode by default; Auto for FAQ intents only.
- Web: unified inbox + approval of AI drafts.

**Exit criteria:** an inbound comment is classified, a grounded draft is produced with
citations, low-confidence cases escalate, and every outbound message is audited.

---

## Phase 6 — Sales AI + CRM + Appointments + Customer Prep

**Goal:** qualify leads, assist sales, book meetings, and brief the consultant — closing the
front half of the loop.

**Deliverables**
- `sales`: recommend services, packages, pricing, up/cross-sell, proposals, quotes, **Stripe
  payment links**, appointment booking, CRM updates; value-capped approvals.
- Native CRM (`contacts/leads/deals/pipeline_stages/lead_activities`) + calendar/availability.
- `customer-prep`: one-page briefing generator (public research + Brain summary + intent).
- Web: CRM board, lead scoring, appointment calendar, briefing viewer.

**Exit criteria:** a qualified lead → quote → payment link → booked appointment → generated
briefing, all recorded as signals and reflected in the pipeline.

**Reuse:** Cal.com (booking), Stripe (payments), optionally Chatwoot/Twenty. **Security:**
payments + PII → mandatory `security-reviewer`.

---

## Phase 7 — Analytics + AI Optimization  *(close the loop)*

**Goal:** measure everything and feed learning back into content and publishing.

**Deliverables**
- `analytics`: metric collection + daily KPI rollups (all KPIs from doc 00), top/worst posts,
  trends, growth.
- `optimization`: best hooks/CTAs/styles/durations/hashtags/times; experiments; recommendations
  with confidence → update derived intelligence and Content/Publishing defaults.
- Web: analytics dashboards + marketing/sales/growth scores + recommendations feed.

**Exit criteria:** KPIs populate daily; at least one optimization recommendation is generated
from real metrics and, when accepted, measurably changes future planning.

---

## Phase 8 — Automation Engine + Hardening

**Goal:** run the full autonomous loop and make it production-tough.

**Deliverables**
- `automation`: signal-triggered workflows (visual builder), the end-to-end loop from doc 00,
  per-step guardrails/approvals, retries, `owner_tasks` generation.
- Autonomy graduation controls (per-capability Observe→Suggest→Auto).
- Hardening: load/perf on `signals` + metrics (partitioning), cost controls + prompt caching,
  full audit coverage, backup/restore, penetration-test pass, docs & runbooks.

**Exit criteria:** comment → reply → DM → qualify → book → prep → CRM → follow-up → review runs
autonomously within guardrails on a test account; kill switch and approvals verified; SLOs met.

---

## Milestones mapped to the Success Definition

| Milestone | Proves | Phases |
|-----------|--------|--------|
| **M1 — "It understands my business"** | Connect + onboard + Business DNA in minutes | 0–1 |
| **M2 — "It sounds like me"** | Voice profile + on-brand content, approved | 2–3 |
| **M3 — "It runs my feed"** | Scheduling + publishing + inbox replies | 4–5 |
| **M4 — "It brings & handles customers"** | Leads, sales assist, booking, briefings | 6 |
| **M5 — "It improves itself"** | Analytics + optimization loop | 7 |
| **M6 — "< 15 min/week"** | Full autonomous loop under guardrails | 8 |

## How each phase starts

Immediately before a phase, write its detailed, bite-sized TDD plan with the **writing-plans**
skill → `docs/superpowers/plans/YYYY-MM-DD-phaseN-<name>.md`, then execute via subagent-driven
development with review checkpoints. This roadmap is the map; each plan is the turn-by-turn.

---

**Next action:** begin **Phase 0** — scaffold the monorepo and stand up the DB + auth + shared
package skeletons.
