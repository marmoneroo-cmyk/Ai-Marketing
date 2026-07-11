/**
 * System-wide thresholds and safety caps. Named constants — never magic numbers.
 * Per-org overrides live in `organizations.settings`; these are the defaults.
 */

/** Password-reset links expire after 1 hour. */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/** Email-verification links expire after 24 hours. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Team-invite links expire after 7 days (invitees may act on their own schedule). */
export const ORG_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Refresh tokens live 30 days and slide forward on every rotation, so an active
 * user effectively stays signed in indefinitely while an idle session lapses
 * after 30 days. This is the real session length; the access token (see
 * ACCESS_TOKEN_TTL in the API's auth.module) is deliberately short because a
 * refresh token can be revoked server-side and an access token cannot.
 */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Retrieval confidence below which customer-facing output MUST escalate to a human. */
export const MIN_GROUNDING_CONFIDENCE = 0.6;

/** Minimum brand-voice conformance score for content to be schedulable/sendable. */
export const VOICE_CONFORMANCE_THRESHOLD = 0.75;

/** Semantic memory chunking parameters. */
export const CHUNK_SIZE_TOKENS = 512;
export const CHUNK_OVERLAP_TOKENS = 64;

/** Default number of chunks retrieved per query. */
export const RETRIEVAL_TOP_K = 8;

/** Default autonomy safety caps (per org, overridable in settings). */
export const DEFAULT_MAX_AUTO_REPLIES_PER_HOUR = 30;
export const DEFAULT_MAX_QUOTE_VALUE = 5000;

/**
 * Default owner-facing publishing/spend caps surfaced on the Settings screen
 * (per org, overridable in `organizations.settings.caps`). `maxQuoteValue`
 * reuses {@link DEFAULT_MAX_QUOTE_VALUE} so the display and the sales-approval
 * ceiling never drift apart.
 */
export const DEFAULT_DAILY_POSTS = 3;
export const DEFAULT_MONTHLY_BUDGET = 1500;

/**
 * Read `settings.caps.<field>` out of an org's opaque `settings` JSON, honoring
 * only a finite, non-negative numeric override; a `0` override is respected
 * (most restrictive) so a safety-sensitive cap can never fail OPEN. Returns
 * `undefined` for missing/malformed input so callers can fall back to their own
 * default. Shared guard so every cap resolver (quote value, plan caps, ...)
 * validates overrides identically.
 *
 * SECURITY — trust boundary: an override MAY raise a cap above the plan default
 * (a deliberate, server/support-controlled escape-hatch for enterprise/custom
 * deals — mirrors how Stripe/Salesforce grant per-account entitlements above the
 * base plan). Because it can escalate, `settings.caps` is provisioned ONLY by
 * trusted server/billing/support code and MUST NEVER be populated from
 * tenant/client input: an org that could write its own `settings.caps` would
 * self-escalate every plan ceiling. Enforced at the write boundary — the org
 * settings-update path only persists `autonomyMode` and never accepts `caps`
 * from the request body (guarded by a regression test on that DTO). Do not add a
 * code path that lets a tenant write `settings.caps`.
 */
function readCapsOverride(settings: unknown, field: string): number | undefined {
  const caps =
    settings && typeof settings === 'object'
      ? (settings as { caps?: unknown }).caps
      : undefined;
  const raw =
    caps && typeof caps === 'object'
      ? (caps as Record<string, unknown>)[field]
      : undefined;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined;
}

/**
 * Resolve an org's effective max auto-finalize quote value from its `settings`
 * JSON (`settings.caps.maxQuoteValue`), falling back to
 * {@link DEFAULT_MAX_QUOTE_VALUE}. The single source of truth shared by the sales
 * approval gate and the Settings read model, so the enforced ceiling always
 * matches what the owner sees. Only a finite, non-negative override is honored;
 * a `0` override is respected (most restrictive) so it can never fail OPEN to a
 * larger default on this safety-sensitive cap.
 */
export function resolveMaxQuoteValue(settings: unknown): number {
  return readCapsOverride(settings, 'maxQuoteValue') ?? DEFAULT_MAX_QUOTE_VALUE;
}

/** Default per-org daily cost caps (overridable in settings), enforced by SpendGuard. */
export const DEFAULT_DAILY_LLM_CALLS = 2000;
export const DEFAULT_DAILY_MEDIA_CALLS = 200;

/** Escalation triggers: intents/keywords that always route to a human. */
export const ALWAYS_ESCALATE_INTENTS = ['refund', 'legal', 'complaint', 'press', 'partnership'] as const;

/** Subscription tiers, mirrored by `organizations.plan` in the db schema. */
export type OrgPlan = 'free' | 'starter' | 'pro';

/**
 * Per-tier resource ceilings, surfaced on the Settings screen. Enforcement is NOT
 * uniform across caps — be precise about which are load-bearing:
 * - `monthlyBudget` / `dailyLlmCalls` / `dailyMediaCalls`: enforced by SpendGuard
 *   (fail-closed) before every LLM/media spend.
 * - `maxQuoteValue`: enforced in the sales quote flow (over-cap quotes require approval).
 * - `maxChannels`: enforced by `assertChannelCapacity` on channel connect.
 * - `dailyPosts`: currently ADVISORY — displayed + used in planning, but NOT yet
 *   enforced at publish time (the publish tick applies no per-org daily ceiling).
 *   Real enforcement needs a `published_at` timestamp on `scheduled_posts` + a
 *   timezone-aware per-org daily count; tracked as a follow-up. Don't claim it's
 *   enforced until that lands.
 */
export interface PlanCaps {
  dailyPosts: number;
  monthlyBudget: number;
  maxQuoteValue: number;
  dailyLlmCalls: number;
  dailyMediaCalls: number;
  maxChannels: number;
}

/**
 * Per-plan resource ceilings. `free` MUST equal today's existing defaults (this
 * package's `DEFAULT_*` constants) so nothing regresses for existing orgs, which
 * all default to `plan: 'free'`. `starter`/`pro` are tunable product knobs —
 * roughly 3x/10x the free tier, rounded to clean numbers — and may be adjusted
 * without ceremony as pricing evolves.
 */
export const PLAN_CAPS: Record<OrgPlan, PlanCaps> = {
  free: {
    dailyPosts: DEFAULT_DAILY_POSTS,
    monthlyBudget: DEFAULT_MONTHLY_BUDGET,
    maxQuoteValue: DEFAULT_MAX_QUOTE_VALUE,
    dailyLlmCalls: DEFAULT_DAILY_LLM_CALLS,
    dailyMediaCalls: DEFAULT_DAILY_MEDIA_CALLS,
    maxChannels: 1,
  },
  starter: {
    dailyPosts: 10,
    monthlyBudget: 5000,
    maxQuoteValue: 15000,
    dailyLlmCalls: 6000,
    dailyMediaCalls: 600,
    maxChannels: 3,
  },
  pro: {
    dailyPosts: 30,
    monthlyBudget: 15000,
    maxQuoteValue: 50000,
    dailyLlmCalls: 20000,
    dailyMediaCalls: 2000,
    maxChannels: 10,
  },
};

/**
 * Resolve an org's effective plan caps: a valid per-org override in
 * `settings.caps.<field>` wins field-by-field over {@link PLAN_CAPS}`[plan]`,
 * using the same override-validation semantics as {@link resolveMaxQuoteValue}
 * (finite, non-negative; `0` honored as the most restrictive value; missing or
 * malformed overrides fall back to the plan default).
 */
export function resolvePlanCaps(plan: OrgPlan, settings?: unknown): PlanCaps {
  const base = PLAN_CAPS[plan];
  return {
    dailyPosts: readCapsOverride(settings, 'dailyPosts') ?? base.dailyPosts,
    monthlyBudget: readCapsOverride(settings, 'monthlyBudget') ?? base.monthlyBudget,
    maxQuoteValue: readCapsOverride(settings, 'maxQuoteValue') ?? base.maxQuoteValue,
    dailyLlmCalls: readCapsOverride(settings, 'dailyLlmCalls') ?? base.dailyLlmCalls,
    dailyMediaCalls: readCapsOverride(settings, 'dailyMediaCalls') ?? base.dailyMediaCalls,
    maxChannels: readCapsOverride(settings, 'maxChannels') ?? base.maxChannels,
  };
}
