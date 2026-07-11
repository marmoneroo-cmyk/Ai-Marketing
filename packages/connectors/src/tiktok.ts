import { loadEnv, connectorRouteUrl } from '@brandpilot/config';
import { AppError } from '@brandpilot/core';
import type {
  AuthTokens,
  Connector,
  ConnectResult,
  PulledItem,
  PullOptions,
  PushAction,
  PushResult,
} from './types';

/**
 * TikTok connector over the TikTok API v2 (Login Kit + Display API).
 *
 * REAL: OAuth `code` → access-token exchange (`connect`), user-info lookup,
 * refresh-token rotation (`refreshAuth`), and reading a user's own videos via
 * the Display API (`pull('videos')`). Auth material is passed in explicitly for
 * `pull`, never read from module state.
 *
 * DEFERRED: `push` (publishing) and `subscribeWebhooks` require the Content
 * Posting API, which is gated behind TikTok app audit / approval. They throw a
 * clear AppError until that approval is in place — mirroring how MetaConnector
 * defers unavailable capabilities. Documented as the next increment.
 *
 * @see https://developers.tiktok.com/doc/oauth-user-access-token-management
 * @see https://developers.tiktok.com/doc/display-api-get-video-list
 */

const OAUTH_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const API_BASE = 'https://open.tiktokapis.com/v2';
const DEFAULT_PULL_LIMIT = 20;
const USER_INFO_FIELDS = 'open_id,union_id,display_name,avatar_url,username';
const VIDEO_LIST_FIELDS = [
  'id',
  'title',
  'video_description',
  'create_time',
  'cover_image_url',
  'share_url',
  'view_count',
  'like_count',
  'comment_count',
  'share_count',
] as const;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // seconds
  refresh_expires_in?: number; // seconds
  scope?: string;
  open_id?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/** v2 endpoints wrap failures in a top-level `error` object. */
interface ApiErrorEnvelope {
  error?: { code?: string; message?: string; log_id?: string };
}

interface UserInfoResponse extends ApiErrorEnvelope {
  data?: {
    user?: {
      open_id?: string;
      union_id?: string;
      display_name?: string;
      avatar_url?: string;
      username?: string;
    };
  };
}

interface VideoNode {
  id?: string;
  title?: string;
  video_description?: string;
  create_time?: number; // unix seconds
  cover_image_url?: string;
  share_url?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
}

interface VideoListResponse extends ApiErrorEnvelope {
  data?: {
    videos?: VideoNode[];
    cursor?: number;
    has_more?: boolean;
  };
}

/**
 * POST form-encoded params to the OAuth token endpoint. Surfaces TikTok OAuth
 * errors (top-level `error` / `error_description`) as AppError.
 */
async function oauthPost(params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) body.set(key, value);

  let response: Response;
  try {
    response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown network error';
    throw new AppError('bad_request', `TikTok OAuth request failed: ${message}`);
  }
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || json.error) {
    const detail = json.error_description ?? json.error ?? `HTTP ${response.status}`;
    throw new AppError('bad_request', `TikTok OAuth error: ${detail}`);
  }
  return json;
}

/**
 * POST JSON to a v2 API endpoint with a bearer access token. The requested
 * fields are passed as a query string (TikTok convention). Surfaces API errors
 * (top-level `error.message`, `error.code !== 'ok'`) as AppError.
 */
async function apiPost<T extends ApiErrorEnvelope>(
  path: string,
  accessToken: string,
  fields: string,
  jsonBody: Record<string, unknown>,
): Promise<T> {
  const url = new URL(`${API_BASE}/${path.replace(/^\//, '')}`);
  url.searchParams.set('fields', fields);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jsonBody),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown network error';
    throw new AppError('bad_request', `TikTok API request failed: ${message}`);
  }
  const json = (await response.json().catch(() => ({}))) as T;
  const code = json.error?.code;
  if (!response.ok || (code !== undefined && code !== 'ok')) {
    const detail = json.error?.message ?? `HTTP ${response.status}`;
    throw new AppError('bad_request', `TikTok API error: ${detail}`);
  }
  return json;
}

/** GET a v2 API endpoint with a bearer access token (used for user info). */
async function apiGet<T extends ApiErrorEnvelope>(
  path: string,
  accessToken: string,
  fields: string,
): Promise<T> {
  const url = new URL(`${API_BASE}/${path.replace(/^\//, '')}`);
  url.searchParams.set('fields', fields);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown network error';
    throw new AppError('bad_request', `TikTok API request failed: ${message}`);
  }
  const json = (await response.json().catch(() => ({}))) as T;
  const code = json.error?.code;
  if (!response.ok || (code !== undefined && code !== 'ok')) {
    const detail = json.error?.message ?? `HTTP ${response.status}`;
    throw new AppError('bad_request', `TikTok API error: ${detail}`);
  }
  return json;
}

export class TikTokConnector implements Connector {
  readonly provider = 'tiktok' as const;

  /**
   * Exchange an OAuth authorization `code` for access + refresh tokens, then
   * identify the user behind them. Requires TIKTOK_CLIENT_KEY /
   * TIKTOK_CLIENT_SECRET. The redirect_uri MUST be byte-identical to the one the
   * authorize step sent (ConnectorsController) — both come from
   * `connectorRouteUrl`, so they cannot drift.
   */
  async connect(code: string): Promise<ConnectResult> {
    const env = loadEnv();
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
      throw new AppError('bad_request', 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not configured');
    }
    const redirectUri = connectorRouteUrl(env, 'tiktok/callback');

    const token = await oauthPost({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    if (!token.access_token) {
      const detail = token.error_description ?? token.error ?? 'no access_token in response';
      throw new AppError('bad_request', `TikTok token exchange failed: ${detail}`);
    }
    const accessToken = token.access_token;

    // Identify the user (open_id + display_name) behind the token.
    const info = await apiGet<UserInfoResponse>('user/info/', accessToken, USER_INFO_FIELDS);
    const user = info.data?.user ?? {};
    const externalId = user.open_id ?? token.open_id ?? '';

    const account: ConnectResult['account'] =
      user.username !== undefined || user.display_name !== undefined
        ? {
            externalId,
            ...(user.username !== undefined ? { handle: user.username } : {}),
            ...(user.display_name !== undefined ? { displayName: user.display_name } : {}),
            raw: info,
          }
        : { externalId, raw: info };

    return { tokens: toTokens(token), account };
  }

  /**
   * Rotate the refresh token for a fresh access + refresh token pair
   * (`grant_type=refresh_token`).
   *
   * @see https://developers.tiktok.com/doc/oauth-user-access-token-management
   */
  async refreshAuth(refreshToken: string): Promise<AuthTokens> {
    const env = loadEnv();
    if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) {
      throw new AppError('bad_request', 'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not configured');
    }

    const token = await oauthPost({
      client_key: env.TIKTOK_CLIENT_KEY,
      client_secret: env.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (!token.access_token) {
      const detail = token.error_description ?? token.error ?? 'no access_token in response';
      throw new AppError('bad_request', `TikTok token refresh failed: ${detail}`);
    }
    return toTokens(token);
  }

  /**
   * Pull the authenticated user's own `videos` via the Display API
   * (`POST /v2/video/list/`). `opts.accessToken` is the user's token;
   * `opts.cursor` is the numeric cursor returned by a previous page (as string).
   */
  async pull(resource: string, opts: PullOptions): Promise<PulledItem[]> {
    if (resource !== 'videos') {
      throw new AppError('bad_request', `TikTokConnector.pull: unsupported resource '${resource}' (expected 'videos')`);
    }
    const maxCount = opts.limit ?? DEFAULT_PULL_LIMIT;
    const cursor = opts.cursor !== undefined ? Number(opts.cursor) : undefined;

    const res = await apiPost<VideoListResponse>('video/list/', opts.accessToken, VIDEO_LIST_FIELDS.join(','), {
      max_count: maxCount,
      ...(cursor !== undefined && !Number.isNaN(cursor) ? { cursor } : {}),
    });

    const videos = res.data?.videos ?? [];
    return videos.map((node) => {
      const externalId = node.id ?? '';
      const timestamp = node.create_time !== undefined ? new Date(node.create_time * 1000) : new Date();
      const metrics: Record<string, number> = {};
      if (typeof node.view_count === 'number') metrics.views = node.view_count;
      if (typeof node.like_count === 'number') metrics.likes = node.like_count;
      if (typeof node.comment_count === 'number') metrics.comments = node.comment_count;
      if (typeof node.share_count === 'number') metrics.shares = node.share_count;

      const base = { kind: 'video', externalId, raw: node, capturedAt: timestamp };
      return Object.keys(metrics).length > 0 ? { ...base, metrics } : base;
    });
  }

  /**
   * Publishing to TikTok requires the Content Posting API, which is gated behind
   * app audit / approval. Deferred to the next increment; throws until enabled.
   *
   * @see https://developers.tiktok.com/doc/content-posting-api-get-started
   */
  async push(_action: PushAction): Promise<PushResult> {
    throw new AppError('bad_request', 'TikTok publishing requires Content Posting API approval — not yet enabled');
  }

  /**
   * TikTok webhook subscriptions are configured through the developer portal and
   * tied to the Content Posting API scope. Deferred alongside {@link push}.
   */
  async subscribeWebhooks(_topics: string[]): Promise<void> {
    throw new AppError('bad_request', 'TikTok publishing requires Content Posting API approval — not yet enabled');
  }
}

/** Map a TikTok OAuth token response into provider-agnostic AuthTokens. */
function toTokens(token: TokenResponse): AuthTokens {
  const accessToken = token.access_token ?? '';
  const scopes = token.scope ? token.scope.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  return {
    accessToken,
    ...(token.refresh_token !== undefined ? { refreshToken: token.refresh_token } : {}),
    ...(token.expires_in !== undefined
      ? { expiresAt: new Date(Date.now() + token.expires_in * 1000) }
      : {}),
    ...(scopes !== undefined && scopes.length > 0 ? { scopes } : {}),
  };
}
