/**
 * Typed fetch client for the BrandPilot NestJS API.
 *
 * - Unwraps the standard `{ success, data, error }` envelope.
 * - Attaches a Bearer token read from localStorage (mirrored to a cookie so
 *   the value survives a hard navigation and is visible to the route proxy).
 * - Honesty: in DEMO mode, data functions fall back to realistic mock data on
 *   connectivity failure so the app renders without a backend. Outside demo
 *   mode, failures throw (so error boundaries fire) and empty API responses
 *   surface real empty states — nothing is fabricated.
 */
import { API_BASE, DEMO_MODE } from "./env";
import type {
  AnalyticsSnapshot,
  ApiResponse,
  CalendarEntry,
  ConnectedChannel,
  ContentItem,
  ConversationMessage,
  ConversationSummary,
  DashboardSnapshot,
  InvitePreview,
  Lead,
  LeadSummary,
  LoginResult,
  OrgInvite,
  OrgMember,
  OrgProfile,
  Paginated,
  PendingApproval,
} from "./types";
import {
  mockAllApprovals,
  mockAnalytics,
  mockCalendarPage,
  mockChannels,
  mockContentPage,
  mockConversationMessages,
  mockConversationsPage,
  mockDashboard,
  mockInvitePreview,
  mockInvites,
  mockLeadsPage,
  mockLeadSummary,
  mockLogin,
  mockMembers,
  mockOrgProfile,
} from "./mock";

const TOKEN_KEY = "brandpilot_token";
const REQUEST_TIMEOUT_MS = 8000;

/** Defaults for paginated list requests (mirror the API's paginationSchema). */
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

/** Build a `?page&limit` query string for a list endpoint. */
function pageQuery(page: number, limit: number): string {
  return `?page=${page}&limit=${limit}`;
}

/** Providers with a real OAuth start route on the API. */
export const OAUTH_PROVIDERS = ["instagram", "facebook", "tiktok"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

// ─── Token storage ───────────────────────────────────────────────────────

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
    // Non-HttpOnly mirror so the value is available before hydration and to
    // the route-protection proxy (apps/web/src/proxy.ts).
    document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
  } catch {
    // Storage may be unavailable (private mode); ignore.
  }
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    document.cookie = `${TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // ignore
  }
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

// ─── Core request helper ─────────────────────────────────────────────────

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

/**
 * Perform a request and return the unwrapped `data` payload.
 * Throws on non-2xx, network failure, or `success: false`.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    const payload = (await response
      .json()
      .catch(() => null)) as ApiResponse<T> | null;

    if (!response.ok || !payload || payload.success !== true) {
      const message =
        payload?.error?.message ?? `Request failed with status ${response.status}`;
      throw new Error(message);
    }

    return payload.data as T;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Run a data request, returning a mock fallback ONLY in demo mode. Outside demo
 * mode the underlying error propagates so error boundaries and retry UI engage.
 */
async function withFallback<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error: unknown) {
    if (DEMO_MODE) return fallback;
    throw error instanceof Error ? error : new Error(getErrorMessage(error));
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────

/**
 * Log in against `/auth/login`. On success the token is persisted.
 * In demo mode, a mock session is minted on a connectivity error so the flow
 * works without a backend; genuine credential rejections always surface.
 */
export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  try {
    const result = await request<LoginResult>("/auth/login", {
      method: "POST",
      body: { email, password },
      auth: false,
    });
    setToken(result.accessToken);
    return result;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    // Surface genuine credential rejections regardless of mode.
    if (/invalid|unauthor|credential|password|forbidden/i.test(message)) {
      throw new Error("Invalid email or password.");
    }
    if (DEMO_MODE) {
      setToken(mockLogin.accessToken);
      return mockLogin;
    }
    throw new Error(
      "Could not reach the server. Please check your connection and try again.",
    );
  }
}

/**
 * Register a new organization + owner against `/auth/register`, then sign the new
 * owner straight in (the token is persisted). Genuine registration rejections
 * (e.g. the email is already registered, a weak password) always surface; in demo
 * mode a mock session is minted on a pure connectivity error so the flow is
 * explorable without a backend.
 */
export async function register(input: {
  orgName: string;
  email: string;
  password: string;
  name?: string;
}): Promise<LoginResult> {
  try {
    const result = await request<LoginResult>("/auth/register", {
      method: "POST",
      body: input,
      auth: false,
    });
    setToken(result.accessToken);
    return result;
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    // Surface real registration rejections (duplicate email, validation) in any mode.
    if (/exist|already|taken|registered|conflict|valid|password|email/i.test(message)) {
      throw new Error(message);
    }
    if (DEMO_MODE) {
      setToken(mockLogin.accessToken);
      return mockLogin;
    }
    throw new Error(
      "Could not reach the server. Please check your connection and try again.",
    );
  }
}

export function logout(): void {
  clearToken();
}

/**
 * Request a password reset email for `email` via `/auth/forgot-password`.
 * The API always returns a generic success envelope regardless of whether the
 * email exists (anti-enumeration), so this never throws — including on a pure
 * connectivity failure — because the UI shows the same generic confirmation
 * either way and a thrown error here would otherwise leak account existence.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  try {
    await request<{ ok: boolean }>("/auth/forgot-password", {
      method: "POST",
      body: { email },
      auth: false,
    });
  } catch {
    // Swallow all failures (network error, timeout, non-2xx): the caller
    // always shows the generic "check your inbox" confirmation.
  }
}

/**
 * Complete a password reset via `/auth/reset-password`. Genuine token
 * rejections (invalid/expired/used) always surface so the page can show a real
 * error; in demo mode a pure connectivity failure resolves as success so the
 * flow is explorable without a backend.
 */
export async function resetPassword(
  token: string,
  password: string,
): Promise<void> {
  try {
    await request<{ ok: boolean }>("/auth/reset-password", {
      method: "POST",
      body: { token, password },
      auth: false,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    // Surface genuine token/validation rejections in any mode.
    if (/invalid|expir|used|token|forbidden|valid|password/i.test(message)) {
      throw new Error(message);
    }
    if (DEMO_MODE) return;
    throw new Error(
      "Could not reach the server. Please check your connection and try again.",
    );
  }
}

/**
 * Confirm an email address via `/auth/verify-email`. Genuine token rejections
 * (invalid/expired/used) always surface so the page can show a real error; in
 * demo mode a pure connectivity failure resolves as success so the flow is
 * explorable without a backend.
 */
export async function verifyEmail(token: string): Promise<void> {
  try {
    await request<{ ok: boolean }>("/auth/verify-email", {
      method: "POST",
      body: { token },
      auth: false,
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    // Surface genuine token/validation rejections in any mode.
    if (/invalid|expir|used|token|forbidden|valid/i.test(message)) {
      throw new Error(message);
    }
    if (DEMO_MODE) return;
    throw new Error(
      "Could not reach the server. Please check your connection and try again.",
    );
  }
}

/**
 * Resend the verification email for the signed-in user via
 * `/auth/resend-verification`. Throws on failure so the caller (the dashboard
 * banner) can show an error toast; in demo mode a connectivity failure
 * resolves as success so the flow is explorable without a backend.
 */
export async function resendVerification(): Promise<void> {
  try {
    await request<{ ok: boolean }>("/auth/resend-verification", {
      method: "POST",
      auth: true,
    });
  } catch (error: unknown) {
    if (DEMO_MODE) return;
    throw error instanceof Error ? error : new Error(getErrorMessage(error));
  }
}

/**
 * Resolve an invite token to its preview (org, invited email/role, and whether
 * the invitee needs to set a password) via `/auth/invite`. Genuine token
 * rejections (invalid/expired) always surface so the page can show the real
 * error state; in demo mode a pure connectivity failure resolves to a mock
 * preview so the flow is explorable without a backend.
 */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  try {
    return await request<InvitePreview>(
      `/auth/invite?token=${encodeURIComponent(token)}`,
      { auth: false },
    );
  } catch (error: unknown) {
    if (DEMO_MODE) return mockInvitePreview;
    throw error instanceof Error ? error : new Error(getErrorMessage(error));
  }
}

/**
 * Accept an invite via `/auth/accept-invite`, then sign the invitee straight
 * in (the token is persisted, mirroring `register`). Genuine rejections
 * (invalid/expired token, missing password for a new user) always surface; in
 * demo mode a pure connectivity failure mints a mock session so the flow is
 * explorable without a backend.
 */
export async function acceptInvite(input: {
  token: string;
  password?: string;
  name?: string;
}): Promise<{ token: string }> {
  try {
    const result = await request<{ accessToken: string }>(
      "/auth/accept-invite",
      { method: "POST", body: input, auth: false },
    );
    setToken(result.accessToken);
    return { token: result.accessToken };
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    // Surface genuine token/validation rejections (invalid/expired invite,
    // missing password) in any mode.
    if (/invalid|expir|used|token|forbidden|valid|password/i.test(message)) {
      throw new Error(message);
    }
    if (DEMO_MODE) {
      setToken(mockLogin.accessToken);
      return { token: mockLogin.accessToken };
    }
    throw new Error(
      "Could not reach the server. Please check your connection and try again.",
    );
  }
}

// ─── Dashboard read models ───────────────────────────────────────────────

export async function getDashboard(): Promise<DashboardSnapshot> {
  return withFallback(
    () => request<DashboardSnapshot>("/dashboard/summary"),
    mockDashboard,
  );
}

export async function getContent(
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
): Promise<Paginated<ContentItem>> {
  return withFallback(
    () => request<Paginated<ContentItem>>(`/content${pageQuery(page, limit)}`),
    mockContentPage(page, limit),
  );
}

/**
 * Kick off asynchronous generation of this week's content plan. `formats`,
 * when non-empty, is the owner's preferred content formats for this run;
 * omitted (or empty) sends no body at all, matching today's exact behavior
 * (model decides). Surfaces real errors (no mock fallback) so the caller can
 * show a failure toast.
 */
export async function generateContentPlan(
  formats?: string[],
): Promise<{ jobId: string }> {
  return request<{ jobId: string }>("/content/plan", {
    method: "POST",
    ...(formats && formats.length > 0 ? { body: { formats } } : {}),
  });
}

/**
 * Schedule an approved variant for auto-publishing at `scheduledFor` (ISO
 * timestamp). Optionally targets a specific connected account; otherwise the
 * API resolves one from the variant's platform. Surfaces real errors so the
 * caller can toast them (e.g. the "no connected account" case); in demo mode it
 * no-ops with a synthetic id like the other mutations.
 */
export async function scheduleVariant(
  variantId: string,
  scheduledFor: string,
  socialAccountId?: string,
): Promise<{ scheduledPostId: string }> {
  try {
    return await request<{ scheduledPostId: string }>(
      `/content/variants/${variantId}/schedule`,
      {
        method: "POST",
        body: {
          scheduledFor,
          ...(socialAccountId ? { socialAccountId } : {}),
        },
      },
    );
  } catch (error: unknown) {
    if (DEMO_MODE) return { scheduledPostId: "demo-scheduled-post" };
    throw error instanceof Error ? error : new Error(getErrorMessage(error));
  }
}

/** Edit an AI-generated variant's caption (and optionally hashtags) before scheduling. */
export async function updateVariant(
  variantId: string,
  input: { caption: string; hashtags?: string[] },
): Promise<{ id: string; caption: string; hashtags: string[] }> {
  try {
    return await request<{ id: string; caption: string; hashtags: string[] }>(
      `/content/variants/${variantId}`,
      { method: "PATCH", body: input },
    );
  } catch (error: unknown) {
    // Demo mode: echo the edit back so the edit flow works without a backend.
    if (DEMO_MODE) {
      return { id: variantId, caption: input.caption, hashtags: input.hashtags ?? [] };
    }
    throw error instanceof Error ? error : new Error(getErrorMessage(error));
  }
}

// ─── Inbox / Conversations ───────────────────────────────────────────────

export async function getConversations(
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
): Promise<Paginated<ConversationSummary>> {
  return withFallback(
    () =>
      request<Paginated<ConversationSummary>>(
        `/conversations${pageQuery(page, limit)}`,
      ),
    mockConversationsPage(page, limit),
  );
}

export async function getConversationMessages(
  id: string,
): Promise<ConversationMessage[]> {
  return withFallback(
    () => request<ConversationMessage[]>(`/conversations/${id}/messages`),
    mockConversationMessages,
  );
}

/**
 * Post a human reply on a conversation thread via `POST /conversations/:id/messages`.
 * Throws on failure (outside demo mode) so the composer can show an error toast
 * and keep the drafted text; in demo mode a pure connectivity failure
 * synthesizes a local outbound message so the reply flow is explorable without
 * a backend.
 */
export async function sendReply(
  conversationId: string,
  body: string,
): Promise<ConversationMessage> {
  try {
    return await request<ConversationMessage>(
      `/conversations/${conversationId}/messages`,
      { method: "POST", body: { body } },
    );
  } catch (error: unknown) {
    if (DEMO_MODE) {
      return {
        id: `demo-reply-${Date.now()}`,
        direction: "outbound",
        author: "human",
        body,
        createdAt: new Date().toISOString(),
      };
    }
    throw error instanceof Error ? error : new Error(getErrorMessage(error));
  }
}

// ─── Leads ───────────────────────────────────────────────────────────────

export async function getLeads(
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
): Promise<Paginated<Lead>> {
  return withFallback(
    () => request<Paginated<Lead>>(`/leads${pageQuery(page, limit)}`),
    mockLeadsPage(page, limit),
  );
}

/**
 * Pipeline KPIs across ALL leads (not just the current page), so the CRM header
 * tiles stay accurate under pagination. Falls back to demo aggregates in demo mode.
 */
export async function getLeadSummary(): Promise<LeadSummary> {
  return withFallback(
    () => request<LeadSummary>("/leads/summary"),
    mockLeadSummary,
  );
}

// ─── Analytics ───────────────────────────────────────────────────────────

export async function getAnalytics(): Promise<AnalyticsSnapshot> {
  return withFallback(
    () => request<AnalyticsSnapshot>("/analytics"),
    mockAnalytics,
  );
}

// ─── Calendar ────────────────────────────────────────────────────────────

export async function getCalendar(
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
): Promise<Paginated<CalendarEntry>> {
  return withFallback(
    () => request<Paginated<CalendarEntry>>(`/calendar${pageQuery(page, limit)}`),
    mockCalendarPage(page, limit),
  );
}

// ─── Settings ────────────────────────────────────────────────────────────

export async function getChannels(): Promise<ConnectedChannel[]> {
  return withFallback(
    () => request<ConnectedChannel[]>("/connectors"),
    mockChannels,
  );
}

export async function getOrgProfile(): Promise<OrgProfile> {
  return withFallback(() => request<OrgProfile>("/orgs/profile"), mockOrgProfile);
}

export async function getMembers(): Promise<OrgMember[]> {
  return withFallback(
    () => request<OrgMember[]>("/orgs/me/members"),
    mockMembers,
  );
}

export async function getInvites(): Promise<OrgInvite[]> {
  return withFallback(
    () => request<OrgInvite[]>("/orgs/invites"),
    mockInvites,
  );
}

/**
 * Invite a member by email with the given role. Genuine rejections (e.g. the
 * email is already a member, validation failures) always surface so the invite
 * form can show the real server message; in demo mode a pure connectivity
 * failure resolves as success so the flow is explorable without a backend.
 */
export async function createInvite(email: string, role: string): Promise<void> {
  try {
    await request<{ ok: boolean }>("/orgs/invites", {
      method: "POST",
      body: { email, role },
    });
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    // Surface real conflict/validation rejections in any mode.
    if (/exist|already|member|taken|conflict|valid|email|role/i.test(message)) {
      throw new Error(message);
    }
    if (DEMO_MODE) return;
    throw new Error(
      "Could not reach the server. Please check your connection and try again.",
    );
  }
}

/** Revoke a pending invite. Throws on failure (outside demo mode) so the caller can roll back optimistic UI. */
export async function revokeInvite(id: string): Promise<void> {
  try {
    await request<{ ok: boolean }>(`/orgs/invites/${id}`, { method: "DELETE" });
  } catch (error: unknown) {
    if (DEMO_MODE) return;
    throw error instanceof Error ? error : new Error(getErrorMessage(error));
  }
}

// ─── Approvals ───────────────────────────────────────────────────────────

/**
 * List pending approvals for the current org (all target types — content,
 * publish, quote — up to the API's recent-items limit). Backs the `/approvals`
 * page; the dashboard's own snapshot comes from `getDashboard` instead.
 */
export async function getApprovals(): Promise<PendingApproval[]> {
  return withFallback(
    () => request<PendingApproval[]>("/approvals"),
    mockAllApprovals,
  );
}

/**
 * Approve/reject a pending item. Throws on failure (outside demo mode) so the
 * caller can surface the error and roll back optimistic UI. In demo mode the
 * decision is treated as accepted locally.
 */
export async function decideApproval(
  id: string,
  decision: "approve" | "reject",
): Promise<void> {
  try {
    await request<unknown>(`/approvals/${id}/${decision}`, { method: "POST" });
  } catch (error: unknown) {
    if (DEMO_MODE) return;
    throw error instanceof Error ? error : new Error(getErrorMessage(error));
  }
}

/**
 * Approve/reject up to ~100 pending items in one call via `POST
 * /approvals/batch`. Returns the ids the server actually transitioned — a
 * cross-tenant or already-decided id is silently skipped server-side (never
 * thrown), so callers should reconcile against `decided`, not against the
 * `ids` they sent. Throws on failure (outside demo mode) so the caller can
 * surface the error and roll back its optimistic UI. In demo mode there's no
 * backend to actually decide anything, so every requested id is reported decided.
 */
export async function decideApprovals(
  ids: string[],
  decision: "approve" | "reject",
): Promise<{ decided: string[] }> {
  return withFallback(
    () =>
      request<{ decided: string[] }>("/approvals/batch", {
        method: "POST",
        body: { ids, decision },
      }),
    { decided: ids },
  );
}

/** Change the autonomy mode. Throws on failure (outside demo mode). */
export async function setAutonomy(
  mode: DashboardSnapshot["autonomy"],
): Promise<void> {
  try {
    await request<unknown>("/settings/autonomy", {
      method: "PATCH",
      body: { mode },
    });
  } catch (error: unknown) {
    if (DEMO_MODE) return;
    throw error instanceof Error ? error : new Error(getErrorMessage(error));
  }
}

// ─── Connectors (OAuth) ──────────────────────────────────────────────────

/** True when a provider has a real OAuth start route on the API. */
export function hasOAuthStart(provider: string): provider is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(provider);
}

/** Map a connectable provider to its OAuth route family (Meta serves IG + FB). */
function oauthRouteFamily(provider: OAuthProvider): "meta" | "tiktok" {
  return provider === "tiktok" ? "tiktok" : "meta";
}

/**
 * Begin the OAuth connect flow and return the provider's authorize URL.
 *
 * This is an AUTHENTICATED request (Bearer token) rather than a top-level
 * navigation, because a navigation can't carry the `Authorization` header the
 * API requires. The caller redirects the browser to the returned URL to reach
 * the provider's consent screen.
 *
 * The `meta` route family serves both `instagram` and `facebook`, so the
 * actual button's platform is forwarded as `?provider=` — without it the API
 * can't tell which one the user clicked and the connected account would
 * always be persisted as `instagram`.
 */
export async function startConnect(provider: OAuthProvider): Promise<string> {
  const family = oauthRouteFamily(provider);
  const query = family === "meta" ? `?provider=${encodeURIComponent(provider)}` : "";
  const { url } = await request<{ url: string }>(`/connectors/${family}/start${query}`);
  return url;
}

// ─── Discovery / Onboarding ──────────────────────────────────────────────

export interface DiscoveryInput {
  websiteUrl?: string;
  social?: {
    provider: "instagram" | "facebook" | "tiktok";
    accountId: string;
    accessToken: string;
  };
}

export interface BusinessDna {
  profile:
    | { description?: string; mission?: string; usp?: string; categories?: string[] }
    | null;
  personas: Array<{ name?: string; painPoints?: string[] }>;
  competitors: Array<{ name?: string; positioning?: string }>;
}

/** Kick off asynchronous business discovery. Surfaces real errors (no mock fallback). */
export async function runDiscovery(input: DiscoveryInput): Promise<{ jobId: string }> {
  return request<{ jobId: string }>("/discovery/run", { method: "POST", body: input });
}

/** Read the synthesized Business DNA (empty until the worker finishes). */
export async function getDna(): Promise<BusinessDna> {
  return withFallback(() => request<BusinessDna>("/discovery/dna"), {
    profile: null,
    personas: [],
    competitors: [],
  });
}
