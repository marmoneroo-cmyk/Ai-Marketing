/**
 * Shared read-model types for the dashboard.
 * These mirror the shapes the NestJS API exposes for Module 13 (apps/web).
 */

export type AutonomyMode = "observe" | "suggest" | "auto";

export type Platform =
  | "instagram"
  | "facebook"
  | "tiktok"
  | "youtube"
  | "google"
  | "email";

export type ApprovalKind = "content" | "publish" | "quote";

export type ContentStatus =
  | "draft"
  | "scheduled"
  | "needs_approval"
  | "published"
  | "failed";

/** Standard API envelope (matches apps/api ApiResponse<T>). */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  /** Error payload on failure — an object `{ code, message }`, not a bare string. */
  error?: { code: string; message: string; details?: unknown };
  meta?: {
    total: number;
    page: number;
    limit: number;
  };
}

/**
 * A page of results (mirrors `Paginated<T>` in @brandpilot/core). List endpoints
 * return this as their `data` payload so the caller has the total for paging.
 */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface LoginResult {
  /**
   * Bearer JWT. Matches the API's `{ accessToken }` auth response EXACTLY — the
   * web must read `accessToken`; the API never sends a `token`/`user` shape, so
   * reading `.token` silently persisted `"undefined"` and broke real login.
   */
  accessToken: string;
}

export interface KpiSummary {
  reach: number;
  reachDelta: number;
  leads: number;
  leadsDelta: number;
  appointments: number;
  appointmentsDelta: number;
  revenue: number;
  revenueDelta: number;
}

export interface ScoreTrio {
  marketing: number;
  sales: number;
  growth: number;
}

export interface PendingApproval {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  platform?: Platform;
  value?: number;
  confidence: number;
  createdAt: string;
}

export interface Recommendation {
  id: string;
  title: string;
  detail: string;
  confidence: number;
  impact: "high" | "medium" | "low";
  module: string;
}

export interface CompletedTask {
  id: string;
  label: string;
  module: string;
  at: string;
}

export interface DashboardSnapshot {
  kpis: KpiSummary;
  scores: ScoreTrio;
  approvals: PendingApproval[];
  recommendations: Recommendation[];
  completedTasks: CompletedTask[];
  autonomy: AutonomyMode;
}

/** An AI-generated, per-platform variant of a content item. */
export interface ContentVariant {
  id: string;
  platform: Platform;
  caption: string;
  hook: string;
  cta: string;
  hashtags: string[];
  /** Brand-voice conformance, 0..100. */
  voiceScore: number;
  status: ContentStatus;
}

/** A generated visual (image or video/reel) attached to a content item's format. */
export interface ContentMedia {
  /** Loadable URL — a `data:` URI in the demo, a served asset URL in production. */
  url: string;
  kind: "image" | "video";
  /** Screen-reader description of the generated visual. */
  alt: string;
  /** Aspect-ratio hint for layout. */
  aspect?: "portrait" | "square" | "landscape";
}

export interface ContentItem {
  id: string;
  title: string;
  platform: Platform;
  /** The AI-chosen content format, e.g. post/carousel/reel. */
  format: string;
  status: ContentStatus;
  scheduledFor: string;
  caption: string;
  /**
   * The related approval row id used to approve/reject this item's variants.
   * Null when no approval has been created yet.
   */
  approvalId: string | null;
  /** The generated visual for this item's format (image/reel), when one exists. */
  media?: ContentMedia;
  /** Per-platform variants (empty when none have been generated). */
  variants: ContentVariant[];
}

// ─── Inbox / Conversations ─────────────────────────────────────────────────

export interface ConversationSummary {
  id: string;
  channel: string;
  status: string;
  intent: string | null;
  lastMessageAt: string | null;
  contactHandle: string | null;
}

export interface ConversationMessage {
  id: string;
  direction: string;
  author: string;
  body: string;
  createdAt: string;
}

// ─── Leads ─────────────────────────────────────────────────────────────────

export interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  source: string | null;
  score: number;
  status: string;
  stage: string | null;
  dealAmount: number | null;
  dealStatus: string | null;
  createdAt: string;
}

/**
 * Pipeline KPIs aggregated across ALL of an org's leads (mirrors the API's
 * `/leads/summary`). Kept separate from the paginated list so the header tiles
 * stay accurate no matter which page of the table is shown.
 */
export interface LeadSummary {
  total: number;
  qualified: number;
  openPipeline: number;
  won: number;
}

// ─── Analytics ─────────────────────────────────────────────────────────────

export interface KpiPoint {
  day: string;
  reach: number;
  engagement: number;
  leads: number;
  revenue: number;
}

export interface TopPost {
  id: string;
  platform: Platform;
  reach: number;
  engagement: number;
  capturedAt: string;
}

export interface AnalyticsSnapshot {
  series: KpiPoint[];
  topPosts: TopPost[];
}

// ─── Calendar ──────────────────────────────────────────────────────────────

export interface CalendarEntry {
  id: string;
  platform: Platform;
  scheduledFor: string;
  status: string;
  caption: string;
  format: string | null;
}

// ─── Settings ────────────────────────────────────────────────────────────────

export type ChannelStatus = "connected" | "disconnected" | "error";

export interface ConnectedChannel {
  provider: Platform;
  status: ChannelStatus;
  handle: string | null;
  connectedAt: string | null;
}

export interface OrgProfile {
  orgName: string;
  ownerName: string;
  ownerEmail: string;
  autonomy: AutonomyMode;
  /** Per-period spend/action caps that bound "auto" mode. */
  caps: {
    dailyPosts: number;
    monthlyBudget: number;
    maxQuoteValue: number;
  };
  /** Subscription tier — determines the caps above. */
  plan: "free" | "starter" | "pro";
  /** Whether the current user's email is confirmed. */
  emailVerified: boolean;
}

/** A member of the current organization. */
export interface OrgMember {
  userId: string;
  email: string;
  name: string | null;
  role: string;
}

/** Roles assignable to a new invite (mirrors the API's invite validation). */
export const ASSIGNABLE_ROLES = [
  "admin",
  "marketer",
  "sales",
  "viewer",
] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** A pending invitation to join the current organization. */
export interface OrgInvite {
  id: string;
  email: string;
  role: string;
  status: "pending";
  invitedAt: string;
}

/**
 * Preview of a pending invite, resolved from an invite token (mirrors the
 * API's `GET /auth/invite`). Drives the /accept-invite page: `needsPassword`
 * distinguishes a brand-new invitee (who must set a password) from an
 * existing user accepting an invite to an additional org (who just confirms).
 */
export interface InvitePreview {
  orgName: string;
  email: string;
  role: string;
  needsPassword: boolean;
}
