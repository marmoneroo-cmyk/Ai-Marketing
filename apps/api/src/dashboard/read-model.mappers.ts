import { and, eq, inArray } from 'drizzle-orm';
import type { AutonomyMode } from '@brandpilot/core';
import { resolvePlanCaps, type OrgPlan } from '@brandpilot/config';
import { quotes, type Database } from '@brandpilot/db';

/**
 * Mapping helpers that translate internal DB enum values into the exact string
 * unions the web dashboard (apps/web/src/lib/types.ts) expects. The web read
 * model uses a narrower, presentation-oriented vocabulary than the canonical
 * domain enums, so every value crossing the boundary is normalized here.
 */

/** Platforms the web client renders badges for. */
export type WebPlatform =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'youtube'
  | 'google'
  | 'email';

/** Content lifecycle states the web client renders. */
export type WebContentStatus =
  | 'draft'
  | 'scheduled'
  | 'needs_approval'
  | 'published'
  | 'failed';

/** Approval kinds the web client renders. */
export type WebApprovalKind = 'content' | 'publish' | 'quote';

/** Autonomy values the web client toggles between. */
export type WebAutonomy = 'observe' | 'suggest' | 'auto';

/** Owner-facing publishing/spend caps surfaced on the Settings screen. */
export interface WebCaps {
  dailyPosts: number;
  monthlyBudget: number;
  maxQuoteValue: number;
}

const PLATFORM_MAP: Record<string, WebPlatform> = {
  instagram: 'instagram',
  facebook: 'facebook',
  tiktok: 'tiktok',
  youtube: 'youtube',
  google: 'google',
  gbp: 'google',
  gbp_post: 'google',
  google_business: 'google',
  email: 'email',
};

/**
 * Map an internal publish platform / content format to a web platform badge.
 * Unknown or unsupported platforms (linkedin, pinterest, blog) fall back to
 * `instagram` so the badge always renders.
 */
export function toWebPlatform(platform: string | null | undefined): WebPlatform {
  if (!platform) return 'instagram';
  return PLATFORM_MAP[platform] ?? 'instagram';
}

const CONTENT_STATUS_MAP: Record<string, WebContentStatus> = {
  idea: 'draft',
  drafted: 'draft',
  draft: 'draft',
  approved: 'scheduled',
  scheduled: 'scheduled',
  published: 'published',
  rejected: 'failed',
  failed: 'failed',
};

/**
 * Map an internal content item status to the web content status. `approved`
 * (owner said yes, awaiting the scheduler) is surfaced as `scheduled`;
 * `rejected` is surfaced as `failed`.
 */
export function toWebContentStatus(status: string | null | undefined): WebContentStatus {
  if (!status) return 'draft';
  return CONTENT_STATUS_MAP[status] ?? 'draft';
}

const APPROVAL_KIND_MAP: Record<string, WebApprovalKind> = {
  content: 'content',
  publish: 'publish',
  quote: 'quote',
  payment: 'quote',
  reply: 'content',
  workflow: 'content',
};

/** Map an internal approval kind to one of the three kinds the web renders. */
export function toWebApprovalKind(kind: string | null | undefined): WebApprovalKind {
  if (!kind) return 'content';
  return APPROVAL_KIND_MAP[kind] ?? 'content';
}

/**
 * Map an internal autonomy mode to the web's tri-state toggle. Both scoped and
 * broad autonomy collapse to `auto` for display.
 */
export function toWebAutonomy(mode: string | null | undefined): WebAutonomy {
  if (mode === 'observe' || mode === 'suggest') return mode;
  if (mode === 'auto_scoped' || mode === 'auto_broad') return 'auto';
  // Conservative fallback for null/unknown — never fail OPEN to 'auto' on a
  // safety-sensitive setting.
  return 'suggest';
}

/**
 * Map an incoming web autonomy value to the canonical domain `AutonomyMode`
 * persisted on `organizations.autonomyMode`. `auto` (the web's single "on"
 * state) maps to the conservative `auto_scoped`. Canonical values pass through.
 */
export function fromWebAutonomy(mode: string): AutonomyMode {
  switch (mode) {
    case 'observe':
      return 'observe';
    case 'suggest':
      return 'suggest';
    case 'auto':
    case 'auto_scoped':
      return 'auto_scoped';
    case 'auto_broad':
      return 'auto_broad';
    default:
      return 'suggest';
  }
}

/**
 * Resolve the owner-facing caps shown on Settings from an org's `plan` and
 * `settings` JSON. Delegates to {@link resolvePlanCaps} (the single source of
 * truth also used by the channel-limit gate, SpendGuard, and the sales
 * approval gate) so the displayed caps always match what's enforced, and
 * narrows the result to the subset of fields the Settings screen renders.
 */
export function resolveCaps(plan: OrgPlan, settings: unknown): WebCaps {
  const { dailyPosts, monthlyBudget, maxQuoteValue } = resolvePlanCaps(plan, settings);
  return { dailyPosts, monthlyBudget, maxQuoteValue };
}

/** A channel row as the web Settings screen renders it. */
export interface WebChannel {
  provider: WebPlatform;
  status: 'connected' | 'disconnected' | 'error';
  handle: string | null;
  connectedAt: string | null;
  /** Latest follower count from the account's stored metadata; null when unknown. */
  followers: number | null;
}

/**
 * Stored `social_accounts.provider` values mapped to the web vocabulary.
 * Providers the Settings grid doesn't surface (whatsapp, linkedin) map to
 * `undefined` and are skipped — never collapsed onto another provider's badge.
 */
const SOCIAL_PROVIDER_TO_WEB: Record<string, WebPlatform | undefined> = {
  instagram: 'instagram',
  facebook: 'facebook',
  tiktok: 'tiktok',
  google_business: 'google',
  gbp: 'google',
  youtube: 'youtube',
};

/** Providers shown on the Settings channel grid, in display order. */
export const DISPLAY_CHANNELS: readonly WebPlatform[] = [
  'instagram',
  'facebook',
  'tiktok',
  'google',
  'youtube',
  'email',
];

interface SocialAccountRow {
  provider: string;
  handle: string | null;
  status: string;
  connectedAt: Date | string | null;
  /** `social_accounts.metadata` jsonb — may carry a `followers` count. */
  metadata?: unknown;
}

/** Read a numeric `followers` field out of an account's jsonb metadata, or null. */
function readFollowers(metadata: unknown): number | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const value = (metadata as Record<string, unknown>).followers;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Build the Settings channel grid from an org's `social_accounts` rows: exactly
 * one entry per displayed provider — the connected account when present
 * (preferring a healthy `connected` row over an errored/expired one), otherwise
 * a `disconnected` placeholder so the owner can start a connect flow. Providers
 * with no OAuth account (e.g. email) surface as disconnected; unsurfaced
 * providers (whatsapp/linkedin) are ignored.
 */
export function buildChannelList(rows: readonly SocialAccountRow[]): WebChannel[] {
  const best = new Map<WebPlatform, WebChannel>();

  for (const row of rows) {
    const provider = SOCIAL_PROVIDER_TO_WEB[row.provider];
    if (!provider) continue;

    const status: WebChannel['status'] =
      row.status === 'connected' ? 'connected' : 'error';
    const connectedAt =
      row.connectedAt instanceof Date
        ? row.connectedAt.toISOString()
        : typeof row.connectedAt === 'string'
          ? row.connectedAt
          : null;

    const existing = best.get(provider);
    // Keep the first row seen (callers pass newest-first), but let a healthy
    // `connected` row replace a previously-seen errored one.
    if (!existing || (existing.status !== 'connected' && status === 'connected')) {
      best.set(provider, {
        provider,
        status,
        handle: row.handle,
        connectedAt,
        followers: readFollowers(row.metadata),
      });
    }
  }

  return DISPLAY_CHANNELS.map(
    (provider) =>
      best.get(provider) ?? {
        provider,
        status: 'disconnected',
        handle: null,
        connectedAt: null,
        followers: null,
      },
  );
}

/**
 * Convert a Drizzle `numeric` confidence (stored 0..1, string-typed) into the
 * 0..100 integer the web expects. Null/unparseable values yield 0.
 */
export function confidenceToPercent(value: string | number | null | undefined): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return 0;
  const scaled = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/** Parse a Drizzle `numeric`/`integer` column into a finite number (default 0). */
export function toNumber(value: string | number | null | undefined): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || Number.isNaN(n)) return 0;
  return n;
}

/**
 * Percentage delta of `current` versus `previous`, rounded to one decimal.
 * Returns 0 when there is no prior value to compare against.
 */
export function percentDelta(current: number, previous: number): number {
  if (!previous) return 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** The subset of an `approvals` row {@link loadQuoteApprovalValues} needs. */
interface QuoteApprovalRow {
  id: string;
  targetType: string;
  targetId: string;
}

/**
 * Batch-load the `quotes.total` dollar figure for every `quote`-typed approval
 * in `rows`, keyed by the APPROVAL's id (not the quote's) so callers can look
 * up `value` per row with a plain `Map.get`. Shared by the dashboard and
 * approvals read models — both list `approvals` and neither table carries an
 * amount column; the figure only exists on the linked `quotes` row.
 *
 * One `inArray` lookup for the whole page (never N+1), org-scoped the same way
 * as the surrounding `approvals` query. Approvals with no matching quote row
 * (deleted, or simply not `kind: 'quote'`) are absent from the returned map.
 */
export async function loadQuoteApprovalValues(
  tx: Database,
  orgId: string,
  rows: readonly QuoteApprovalRow[],
): Promise<Map<string, number>> {
  const quoteApprovals = rows.filter((row) => row.targetType === 'quote');
  if (quoteApprovals.length === 0) return new Map();

  const quoteRows = await tx
    .select({ id: quotes.id, total: quotes.total })
    .from(quotes)
    .where(
      and(
        eq(quotes.orgId, orgId),
        inArray(
          quotes.id,
          quoteApprovals.map((row) => row.targetId),
        ),
      ),
    );

  const totalByQuoteId = new Map(quoteRows.map((q) => [q.id, toNumber(q.total)] as const));

  const valueByApprovalId = new Map<string, number>();
  for (const row of quoteApprovals) {
    const total = totalByQuoteId.get(row.targetId);
    if (total !== undefined) valueByApprovalId.set(row.id, total);
  }
  return valueByApprovalId;
}
