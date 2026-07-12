import { loadEnv, connectorRouteUrl } from '@brandpilot/config';
import { AppError } from '@brandpilot/core';
import type {
  AudienceStats,
  AuthTokens,
  Connector,
  ConnectResult,
  PulledItem,
  PullOptions,
  PushAction,
  PushResult,
} from './types';

/**
 * Instagram connector over the "Instagram API with Instagram Login" flow — the
 * modern path that authenticates DIRECTLY against Instagram, so it needs no
 * linked Facebook Page. It uses the Instagram-app credentials
 * (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET, distinct from the Facebook
 * META_APP_* the {@link MetaConnector} uses) and the `graph.instagram.com` host.
 *
 * Flow: authorization `code` → short-lived token (`api.instagram.com`) →
 * long-lived 60-day token (`graph.instagram.com`) → identify the account.
 * Publishing is the standard two-step container + publish. Auth material is
 * always passed in explicitly, never read from module state.
 *
 * @see https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
 */

const IG_TOKEN_URL = 'https://api.instagram.com/oauth/access_token';
const IG_GRAPH_BASE = 'https://graph.instagram.com';
const IG_GRAPH_VERSION = 'v21.0';
/** Instagram long-lived tokens last 60 days; used as the fallback when a response omits expires_in. */
const LONG_LIVED_TTL_SEC = 60 * 24 * 60 * 60;
const DEFAULT_PULL_LIMIT = 25;

/** Short-lived exchange (api.instagram.com) uses flat error_type/error_message, not an `error` object. */
interface ShortLivedTokenResponse {
  access_token?: string;
  user_id?: number | string;
  // Instagram returns this as an ARRAY of scope strings (older docs showed a
  // comma-joined string) — normalizePermissions() handles both.
  permissions?: string | string[];
  error_type?: string;
  error_message?: string;
}
interface IgErrorEnvelope {
  error?: { message?: string; type?: string; code?: number };
}
interface LongLivedTokenResponse extends IgErrorEnvelope {
  access_token?: string;
  token_type?: string;
  expires_in?: number; // seconds
}
interface MeResponse extends IgErrorEnvelope {
  user_id?: string;
  username?: string;
  id?: string;
}
/** `/me` audience fields — available for Business/Creator accounts on Instagram Login. */
interface IgAudienceResponse extends IgErrorEnvelope {
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}
interface IgIdResponse extends IgErrorEnvelope {
  id?: string;
}
interface IgMediaNode {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}
interface IgCommentNode {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
}
interface IgListResponse extends IgErrorEnvelope {
  data?: IgMediaNode[];
  paging?: { cursors?: { after?: string } };
}
interface IgCommentListResponse extends IgErrorEnvelope {
  data?: IgCommentNode[];
  paging?: { cursors?: { after?: string } };
}

/** Build a versioned graph.instagram.com URL with query params. */
function igUrl(path: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(`${IG_GRAPH_BASE}/${IG_GRAPH_VERSION}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** GET a graph.instagram.com endpoint, surfacing Instagram errors as AppError. */
async function igGet<T extends IgErrorEnvelope>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown network error';
    throw new AppError('bad_request', `Instagram request failed: ${message}`);
  }
  const json = (await response.json().catch(() => ({}))) as T;
  if (!response.ok || json.error) {
    throw new AppError(
      'bad_request',
      `Instagram API error: ${json.error?.message ?? `HTTP ${response.status}`}`,
    );
  }
  return json;
}

/** POST form-encoded params to a graph.instagram.com endpoint (access token in the body). */
async function igPost<T extends IgErrorEnvelope>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const url = `${IG_GRAPH_BASE}/${IG_GRAPH_VERSION}/${path.replace(/^\//, '')}`;
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, String(value));
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown network error';
    throw new AppError('bad_request', `Instagram request failed: ${message}`);
  }
  const json = (await response.json().catch(() => ({}))) as T;
  if (!response.ok || json.error) {
    throw new AppError(
      'bad_request',
      `Instagram API error: ${json.error?.message ?? `HTTP ${response.status}`}`,
    );
  }
  return json;
}

export class InstagramLoginConnector implements Connector {
  readonly provider = 'instagram' as const;

  /**
   * Exchange an OAuth `code` for a long-lived Instagram token and identify the
   * account. Requires INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET. The redirect_uri
   * MUST be byte-identical to the authorize step's (both come from
   * `connectorRouteUrl('instagram/callback')`, so they cannot drift).
   */
  async connect(code: string): Promise<ConnectResult> {
    const env = loadEnv();
    if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET) {
      throw new AppError(
        'bad_request',
        'INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET are not configured',
      );
    }
    const redirectUri = connectorRouteUrl(env, 'instagram/callback');

    // 1. code → short-lived token (+ the IG user id).
    const shortBody = new URLSearchParams({
      client_id: env.INSTAGRAM_APP_ID,
      client_secret: env.INSTAGRAM_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    });
    let shortRes: Response;
    try {
      shortRes = await fetch(IG_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: shortBody,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown network error';
      throw new AppError('bad_request', `Instagram token exchange failed: ${message}`);
    }
    const short = (await shortRes.json().catch(() => ({}))) as ShortLivedTokenResponse;
    if (!shortRes.ok || !short.access_token || short.user_id === undefined) {
      const detail = short.error_message ?? `HTTP ${shortRes.status}`;
      throw new AppError('bad_request', `Instagram token exchange failed: ${detail}`);
    }
    const fallbackUserId = String(short.user_id);

    // 2. short-lived → long-lived (60 days).
    const long = await igGet<LongLivedTokenResponse>(
      `${IG_GRAPH_BASE}/access_token?grant_type=ig_exchange_token` +
        `&client_secret=${encodeURIComponent(env.INSTAGRAM_APP_SECRET)}` +
        `&access_token=${encodeURIComponent(short.access_token)}`,
    );
    const accessToken = long.access_token ?? short.access_token;
    const expiresInSec = long.expires_in ?? LONG_LIVED_TTL_SEC;

    // 3. identify the account (username + canonical id).
    const me = await igGet<MeResponse>(
      `${IG_GRAPH_BASE}/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`,
    );
    const externalId = me.user_id ?? me.id ?? fallbackUserId;
    const handle = me.username;
    const scopes = normalizePermissions(short.permissions);

    const tokens: AuthTokens = {
      accessToken,
      expiresAt: new Date(Date.now() + expiresInSec * 1000),
      ...(scopes && scopes.length > 0 ? { scopes } : {}),
    };
    const account: ConnectResult['account'] =
      handle !== undefined
        ? { externalId, handle, raw: { short, me } }
        : { externalId, raw: { short, me } };

    return { tokens, account };
  }

  /**
   * Refresh a long-lived token for another 60 days. Unlike Meta's re-exchange,
   * Instagram has a dedicated `ig_refresh_token` grant; the incoming string is
   * the current long-lived token.
   */
  async refreshAuth(refreshToken: string): Promise<AuthTokens> {
    const res = await igGet<LongLivedTokenResponse>(
      `${IG_GRAPH_BASE}/refresh_access_token?grant_type=ig_refresh_token` +
        `&access_token=${encodeURIComponent(refreshToken)}`,
    );
    if (!res.access_token) {
      throw new AppError('bad_request', 'Instagram token refresh returned no access_token');
    }
    return {
      accessToken: res.access_token,
      expiresAt: new Date(Date.now() + (res.expires_in ?? LONG_LIVED_TTL_SEC) * 1000),
    };
  }

  /**
   * Pull an Instagram account's recent `media` (`opts.accountId` = IG user id),
   * or the `comments` on one media (`opts.accountId` = media id). Reading
   * comments requires the `instagram_business_manage_comments` scope.
   */
  async pull(resource: string, opts: PullOptions): Promise<PulledItem[]> {
    if (resource === 'media') {
      const url = igUrl(`${opts.accountId}/media`, {
        fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
        limit: opts.limit ?? DEFAULT_PULL_LIMIT,
        after: opts.cursor,
        access_token: opts.accessToken,
      });
      const res = await igGet<IgListResponse>(url);
      return (res.data ?? []).map((node) => {
        const capturedAt = node.timestamp ? new Date(node.timestamp) : new Date();
        const metrics: Record<string, number> = {};
        if (typeof node.like_count === 'number') metrics.likes = node.like_count;
        if (typeof node.comments_count === 'number') metrics.comments = node.comments_count;
        const base: PulledItem = { kind: 'media', externalId: node.id, raw: node, capturedAt };
        return Object.keys(metrics).length > 0 ? { ...base, metrics } : base;
      });
    }

    if (resource === 'comments') {
      // `accountId` here is the media id whose comments we read.
      const url = igUrl(`${opts.accountId}/comments`, {
        fields: 'id,text,username,timestamp,like_count',
        limit: opts.limit ?? DEFAULT_PULL_LIMIT,
        after: opts.cursor,
        access_token: opts.accessToken,
      });
      const res = await igGet<IgCommentListResponse>(url);
      return (res.data ?? []).map((node) => {
        const capturedAt = node.timestamp ? new Date(node.timestamp) : new Date();
        const base: PulledItem = { kind: 'comment', externalId: node.id, raw: node, capturedAt };
        return typeof node.like_count === 'number'
          ? { ...base, metrics: { likes: node.like_count } }
          : base;
      });
    }

    throw new AppError(
      'bad_request',
      `InstagramLoginConnector.pull: unsupported resource '${resource}' (expected 'media' | 'comments')`,
    );
  }

  /**
   * Fetch account audience stats (follower/following/media counts) from the
   * `/me` node. `opts.accountId` is unused (the token identifies the account),
   * kept for interface symmetry. Business/Creator accounts expose
   * `followers_count`; a personal account simply omits it → `undefined`.
   */
  async fetchAudience(opts: PullOptions): Promise<AudienceStats> {
    const res = await igGet<IgAudienceResponse>(
      `${IG_GRAPH_BASE}/me?fields=followers_count,follows_count,media_count` +
        `&access_token=${encodeURIComponent(opts.accessToken)}`,
    );
    const stats: AudienceStats = {};
    if (typeof res.followers_count === 'number') stats.followers = res.followers_count;
    if (typeof res.follows_count === 'number') stats.follows = res.follows_count;
    if (typeof res.media_count === 'number') stats.mediaCount = res.media_count;
    return stats;
  }

  /**
   * Publish an image post: create a media container (`POST /{ig-user-id}/media`
   * with `image_url` + `caption`) then publish it (`POST
   * /{ig-user-id}/media_publish`). `action.accountId` is the IG user id.
   *
   * @see https://developers.facebook.com/docs/instagram-platform/content-publishing
   */
  async push(action: PushAction): Promise<PushResult> {
    const { accountId, accessToken, payload } = action;
    const imageUrl = asString(payload.imageUrl) ?? asString(payload.image_url);
    const caption = asString(payload.caption) ?? asString(payload.message);
    if (imageUrl === undefined) {
      throw new AppError('bad_request', 'InstagramLoginConnector.push: publishing requires an imageUrl');
    }
    const container = await igPost<IgIdResponse>(`${accountId}/media`, {
      image_url: imageUrl,
      ...(caption !== undefined ? { caption } : {}),
      access_token: accessToken,
    });
    if (!container.id) {
      throw new AppError('bad_request', 'InstagramLoginConnector.push: media container returned no id');
    }
    const published = await igPost<IgIdResponse>(`${accountId}/media_publish`, {
      creation_id: container.id,
      access_token: accessToken,
    });
    const externalId = published.id ?? container.id;
    return { externalId, raw: { container, published } };
  }

  /** Instagram Login webhooks are configured at the app level (developer portal), not per-connect. */
  async subscribeWebhooks(_topics: string[]): Promise<void> {
    // Intentionally a no-op — nothing to subscribe per account.
  }
}

/** Narrow an unknown payload field to `string`, or `undefined` when absent/other. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Normalize the granted `permissions` from the short-lived token response into a
 * string[]. Instagram returns an array (`["instagram_business_basic", …]`), but
 * older docs showed a comma-joined string — accept either, and anything else
 * yields undefined so a shape surprise never crashes the connect flow.
 */
function normalizePermissions(permissions: unknown): string[] | undefined {
  const list = Array.isArray(permissions)
    ? permissions.map((p) => String(p).trim())
    : typeof permissions === 'string'
      ? permissions.split(',').map((s) => s.trim())
      : [];
  const scopes = list.filter(Boolean);
  return scopes.length > 0 ? scopes : undefined;
}
