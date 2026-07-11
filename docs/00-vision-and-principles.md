# 00 — Vision & Principles

## Vision

Replace most of the daily marketing work a small-business owner does. After a one-time
connect-and-onboard, the platform runs as an autonomous marketing department: it learns the
business, produces content, converses with customers, qualifies leads, assists sales, books
appointments, and improves itself from results. The owner reviews and approves — target
**< 15 minutes per week**.

## The Core Principle

> **Understand the business first. Only then act.**

Content, replies, sales, and optimization are all *downstream* of understanding. Every action
is grounded in the **Business Brain** — the shared, continuously-updated model of the company.
A module that cannot ground an action in the Business Brain must **defer to a human**, not guess.

## What This Is Not (Non-Goals)

- ❌ Not an "AI caption generator." Generation is one output, not the product.
- ❌ Not a set of disconnected tools. Every module shares one brain.
- ❌ Not autonomous-at-all-costs. Autonomy is bounded by approval gates and guardrails.
- ❌ Not a black box. Every decision is explainable, cites its sources, and is auditable.

## Success Definition

A business owner can:
1. Connect **Instagram, Facebook, TikTok** (OAuth).
2. Answer **~20 onboarding questions** and optionally upload documents.
3. Receive a **fully operational AI marketing department within minutes** — because the
   **Discovery Engine** has already scanned and analyzed their public footprint to build a
   **Business DNA**.

The platform then **improves continuously** as more data (posts, conversations, results) flows in.

---

## The Business DNA (why onboarding is almost automatic)

Instead of relying on a manual questionnaire, the **Discovery Engine** (Module 2) scans and
analyzes, subject to permissions:

- Historical posts, reels, images, videos, captions
- Comments, likes, shares, saved/engagement patterns
- DMs and message history (where permission allows)
- Audience & engagement demographics
- The business website, landing pages, booking pages
- Customer reviews (Google, Meta, etc.)
- Google Business Profile
- Uploaded documents (PDFs, decks, price lists)
- Product/service catalogs
- Logo, colors, and fonts extracted from the site
- Key competitors and industry trends

The questionnaire only fills **gaps** the scan could not resolve. This is the platform's
biggest advantage over tools that start from an empty form.

---

## The Autonomous Loop (Module 12 example, made concrete)

```
Someone comments on a post
        │
        ▼
Conversation AI classifies intent (Haiku) ── grounded in Business Brain
        │
        ▼
Replies publicly (brand voice) + opens a DM
        │
        ▼
Collects contact info, answers questions, handles objections (approved knowledge only)
        │
        ▼
Sales AI qualifies the lead → proposes a service → books an appointment
        │
        ▼
Customer Preparation generates a 1-page consultant briefing
        │
        ▼
CRM updated · confirmation + prep material sent · follow-up scheduled
        │
        ▼
After the meeting: review request → upsell/cross-sell offer
        │
        ▼
Every step emits SIGNALS → Business Brain learns → next loop is better
```

Every arrow is a workflow step with a **trigger**, a **guardrail**, and an **audit record**.

---

## AI Operating Rules (enforced in code, not just prompts)

These are hard requirements wired into the Agent Runtime (see [01](01-system-architecture.md)).

1. **No hallucination.** Customer-facing answers must be grounded in retrieved Business Brain
   context. If retrieval confidence is below threshold → escalate to a human. Never invent
   prices, policies, availability, or claims.
2. **Reason before acting.** Every consequential action produces an internal, logged
   rationale ("why this, why now, what it references") before execution.
3. **Cite the Brain.** Every important decision records which knowledge chunks / facts it used.
4. **Preserve the voice.** All generated content passes a brand-voice conformance check before
   it can be scheduled or sent. It must never "sound AI-generated."
5. **Everything is measurable.** Every action is linked to an outcome metric so optimization
   can attribute results.
6. **Every recommendation carries a confidence score** (0–1) and the evidence behind it.
7. **Human-in-the-loop by default, autonomy by graduation.** New accounts run in
   *suggest / approve* mode. Autonomy expands per-capability only after a track record and an
   explicit owner opt-in.

## Trust, Safety & Approval Model

| Mode | Behavior | Default for |
|------|----------|-------------|
| **Observe** | Learns only; takes no external action | Onboarding / discovery |
| **Suggest** | Drafts everything; owner approves before anything leaves the platform | New accounts |
| **Auto (scoped)** | Acts autonomously for specific, opted-in capabilities (e.g. replying to FAQs) | Graduated per capability |
| **Auto (broad)** | Runs the full loop; owner reviews summaries | Mature, trusted accounts |

**Approval gates** are first-class: publishing, DMs, quotes, payment links, and any spend
default to requiring approval and are individually promotable to Auto with limits (rate caps,
value caps, business-hours windows).

**Guardrails** (always on): approved-knowledge-only answering, banned-topics list, PII
handling rules, rate limits per endpoint, escalation triggers (anger, legal, refunds, high
value), and a global kill switch per account and per capability.

---

## KPIs the platform optimizes toward

Reach · impressions · engagement · CTR · leads · appointments · sales · revenue · conversion
rate · CAC · ROAS · LTV · retention. Every module ties its outputs to these so the
**AI Optimization** module (11) can learn what actually works. See
[03 — Module Hierarchy](03-module-hierarchy.md) for how each module contributes.
