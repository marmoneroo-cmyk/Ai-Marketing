# 05 — Reuse / Build-vs-Buy Decisions

Per the "research & reuse before building" rule, this records what we adopt vs. build. Each
decision keeps the **Business Brain as the source of truth** — anything adopted sits behind our
Connector/SDK interfaces so no vendor becomes the system of record.

| Need | Decision | Rationale |
|------|----------|-----------|
| Web/review scraping | **Adopt Firecrawl** (done) | Best-in-class extraction; wrapped in `connectors/firecrawl.ts`. |
| Embeddings | **Adopt Voyage `voyage-3`** (done) | High-retrieval-quality; behind the `Embedder` interface. |
| Reasoning/generation | **Adopt Claude** (done) | Tiered Haiku/Sonnet/Opus; behind the `LlmClient` interface. |
| Media generation | **Adopt fal.ai** (Phase 3) | Image/video breadth; behind a `MediaProvider` interface. |
| Payments | **Adopt Stripe** (Phase 6) | Standard; payment links + webhooks. |
| Queues | **Adopt BullMQ** (done) | Durable, retryable jobs on Redis. |
| Publishing/scheduling | **Build native, study Postiz/Mixpost** | We need per-post Brain grounding + approval gates their models don't express; borrow their connector patterns. |
| Conversation inbox | **Build native, study Chatwoot** | Tight Business-Brain grounding + escalation is core; a bolt-on inbox would fragment the source of truth. |
| Appointments | **Adopt Cal.com (Phase 6)** | Mature booking/availability; integrate via API rather than rebuild. |
| CRM | **Build native, reference Twenty's model** | CRM must live inside the Brain for lead scoring + briefings; keep the schema lean (doc 02 §L). |

**Validation status:** decisions are based on current ecosystem knowledge; a formal `gh search`
comparison for Postiz/Chatwoot/Cal.com/Twenty should be attached here before Phases 4–6 begin,
and any adopted OSS must pass a security review (per the security rule) before integration.

**Principle:** adopt for undifferentiated heavy lifting (scraping, embeddings, media, payments,
booking); build the parts where *grounding every action in the Business Brain* is the
differentiator (content, conversations, sales, optimization).
