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
 * Meta (Instagram + Facebook) connector over the Graph API v21.0.
 *
 * REAL: OAuth `code` → access-token exchange (`connect`), long-lived token
 * refresh (`refreshAuth`), reading recent `media` / `comments` (`pull`),
 * publishing to Instagram / Facebook Pages (`push`), and best-effort webhook
 * subscription (`subscribeWebhooks`). Auth material is always passed in, never
 * read from module state.
 *
 * @see https://developers.facebook.com/docs/graph-api
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';
const DEFAULT_PULL_LIMIT = 25;

interface TokenExchangeResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number; // seconds
  error?: { message?: string; type?: string; code?: number };
}

interface GraphErrorEnvelope {
  error?: { message?: string; type?: string; code?: number };
}

interface GraphListResponse<T> extends GraphErrorEnvelope {
  data?: T[];
  paging?: { cursors?: { before?: string; after?: string }; next?: string };
}

interface MediaNode {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

interface CommentNode {
  id: string;
  text?: string;
  username?: string;
  timestamp?: string;
  like_count?: number;
}

/** Build a Graph API URL with query params. */
function graphUrl(path: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(`${GRAPH_API_BASE}/${path.replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** GET a Graph endpoint and surface Graph errors as AppError. */
async function graphGet<T extends GraphErrorEnvelope>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown network error';
    throw new AppError('bad_request', `Meta Graph request failed: ${message}`);
  }
  const json = (await response.json().catch(() => ({}))) as T;
  if (!response.ok || json.error) {
    const detail = json.error?.message ?? `HTTP ${response.status}`;
    throw new AppError('bad_request', `Meta Graph API error: ${detail}`);
  }
  return json;
}

/**
 * POST to a Graph endpoint with form-encoded params (the Graph API accepts
 * `application/x-www-form-urlencoded`). The access token is sent in the body.
 * Surfaces Graph errors as AppError, mirroring {@link graphGet}.
 */
async function graphPost<T extends GraphErrorEnvelope>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<T> {
  const url = `${GRAPH_API_BASE}/${path.replace(/^\//, '')}`;
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
    throw new AppError('bad_request', `Meta Graph request failed: ${message}`);
  }
  const json = (await response.json().catch(() => ({}))) as T;
  if (!response.ok || json.error) {
    const detail = json.error?.message ?? `HTTP ${response.status}`;
    throw new AppError('bad_request', `Meta Graph API error: ${detail}`);
  }
  return json;
}

/** A node the Graph API returns carrying only an `id` (create/publish endpoints). */
interface GraphIdResponse extends GraphErrorEnvelope {
  id?: string;
  post_id?: string;
}

export class MetaConnector implements Connector {
  readonly provider = 'instagram' as const;

  /**
   * Exchange an OAuth authorization `code` for an access token, then identify
   * the account it belongs to. Requires META_APP_ID / META_APP_SECRET. The
   * redirect_uri MUST be byte-identical to the one the authorize step sent
   * (ConnectorsController) — both come from `connectorRouteUrl`, so they cannot drift.
   */
  async connect(code: string): Promise<ConnectResult> {
    const env = loadEnv();
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      throw new AppError('bad_request', 'META_APP_ID / META_APP_SECRET are not configured');
    }
    const redirectUri = connectorRouteUrl(env, 'meta/callback');

    const exchangeUrl = graphUrl('oauth/access_token', {
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    });

    const token = await graphGet<TokenExchangeResponse>(exchangeUrl);
    if (!token.access_token) {
      const detail = token.error?.message ?? 'no access_token in response';
      throw new AppError('bad_request', `Meta token exchange failed: ${detail}`);
    }
    const accessToken = token.access_token;

    // Identify the account (id + username) behind the token.
    const me = await graphGet<{ id: string; username?: string; name?: string } & GraphErrorEnvelope>(
      graphUrl('me', { fields: 'id,username,name', access_token: accessToken }),
    );

    const tokens: AuthTokens =
      token.expires_in === undefined
        ? { accessToken }
        : { accessToken, expiresAt: new Date(Date.now() + token.expires_in * 1000) };

    const account: ConnectResult['account'] =
      me.username !== undefined || me.name !== undefined
        ? {
            externalId: me.id,
            ...(me.username !== undefined ? { handle: me.username } : {}),
            ...(me.name !== undefined ? { displayName: me.name } : {}),
            raw: me,
          }
        : { externalId: me.id, raw: me };

    return { tokens, account };
  }

  /**
   * Exchange a (short- or long-lived) token for a long-lived token. Meta has no
   * OAuth refresh token: you re-exchange the current access token via
   * `grant_type=fb_exchange_token`. The incoming string is therefore treated as
   * the current access token to exchange.
   *
   * @see https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
   */
  async refreshAuth(refreshToken: string): Promise<AuthTokens> {
    const env = loadEnv();
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      throw new AppError('bad_request', 'META_APP_ID / META_APP_SECRET are not configured');
    }

    const exchangeUrl = graphUrl('oauth/access_token', {
      grant_type: 'fb_exchange_token',
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      fb_exchange_token: refreshToken,
    });

    const token = await graphGet<TokenExchangeResponse>(exchangeUrl);
    if (!token.access_token) {
      const detail = token.error?.message ?? 'no access_token in response';
      throw new AppError('bad_request', `Meta long-lived token exchange failed: ${detail}`);
    }

    const accessToken = token.access_token;
    return token.expires_in === undefined
      ? { accessToken }
      : { accessToken, expiresAt: new Date(Date.now() + token.expires_in * 1000) };
  }

  /**
   * Pull recent `media` or `comments` for an Instagram/Facebook account.
   * `opts.accountId` is the IG user / page id; `opts.accessToken` is that
   * account's token.
   */
  async pull(resource: string, opts: PullOptions): Promise<PulledItem[]> {
    const limit = opts.limit ?? DEFAULT_PULL_LIMIT;

    if (resource === 'media') {
      const url = graphUrl(`${opts.accountId}/media`, {
        fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
        limit,
        after: opts.cursor,
        access_token: opts.accessToken,
      });
      const res = await graphGet<GraphListResponse<MediaNode>>(url);
      return (res.data ?? []).map((node) => toPulledItem('media', node.id, node, node.timestamp, {
        likes: node.like_count,
        comments: node.comments_count,
      }));
    }

    if (resource === 'comments') {
      // `accountId` here is the media id whose comments we read.
      const url = graphUrl(`${opts.accountId}/comments`, {
        fields: 'id,text,username,timestamp,like_count',
        limit,
        after: opts.cursor,
        access_token: opts.accessToken,
      });
      const res = await graphGet<GraphListResponse<CommentNode>>(url);
      return (res.data ?? []).map((node) => toPulledItem('comment', node.id, node, node.timestamp, {
        likes: node.like_count,
      }));
    }

    throw new AppError('bad_request', `MetaConnector.pull: unsupported resource '${resource}' (expected 'media' | 'comments')`);
  }

  /**
   * Publish an outbound post. The `action.payload` shape selects the target:
   *
   * - Instagram (`payload.target === 'instagram'`, or an `imageUrl` with no
   *   `pageId`): two-step publish — create a media container
   *   (`POST /{ig-user-id}/media` with `image_url` + `caption`) then publish it
   *   (`POST /{ig-user-id}/media_publish`). `action.accountId` is the IG user id.
   * - Facebook Page (`payload.target === 'facebook'`, or a `pageId` present):
   *   `POST /{page-id}/photos` when an `imageUrl` is given (with optional
   *   `caption`/`message`), otherwise `POST /{page-id}/feed` with `message`.
   *   The page id is `payload.pageId` when present, else `action.accountId`.
   *
   * `action.accessToken` is the IG-user / page access token.
   *
   * @see https://developers.facebook.com/docs/instagram-api/guides/content-publishing
   * @see https://developers.facebook.com/docs/pages-api/posts
   */
  async push(action: PushAction): Promise<PushResult> {
    const { accountId, accessToken, payload } = action;
    const imageUrl = asString(payload.imageUrl) ?? asString(payload.image_url);
    const caption = asString(payload.caption) ?? asString(payload.message);
    const pageId = asString(payload.pageId) ?? asString(payload.page_id);
    const target = asString(payload.target);

    const isFacebook = target === 'facebook' || (target !== 'instagram' && pageId !== undefined);

    if (isFacebook) {
      const id = pageId ?? accountId;
      if (imageUrl !== undefined) {
        const res = await graphPost<GraphIdResponse>(`${id}/photos`, {
          url: imageUrl,
          ...(caption !== undefined ? { caption } : {}),
          access_token: accessToken,
        });
        const externalId = res.post_id ?? res.id;
        return externalId !== undefined ? { externalId, raw: res } : { raw: res };
      }
      if (caption === undefined) {
        throw new AppError('bad_request', 'MetaConnector.push: Facebook feed post requires a message/caption');
      }
      const res = await graphPost<GraphIdResponse>(`${id}/feed`, {
        message: caption,
        access_token: accessToken,
      });
      const externalId = res.id ?? res.post_id;
      return externalId !== undefined ? { externalId, raw: res } : { raw: res };
    }

    // Instagram: image_url is required for the container.
    if (imageUrl === undefined) {
      throw new AppError('bad_request', 'MetaConnector.push: Instagram publish requires an imageUrl');
    }
    const container = await graphPost<GraphIdResponse>(`${accountId}/media`, {
      image_url: imageUrl,
      ...(caption !== undefined ? { caption } : {}),
      access_token: accessToken,
    });
    if (!container.id) {
      throw new AppError('bad_request', 'MetaConnector.push: Instagram media container returned no id');
    }
    const published = await graphPost<GraphIdResponse>(`${accountId}/media_publish`, {
      creation_id: container.id,
      access_token: accessToken,
    });
    const externalId = published.id ?? container.id;
    return { externalId, raw: { container, published } };
  }

  /**
   * Subscribe the app to webhook `topics` (fields) on the `page` object.
   * Best-effort: `POST /{app-id}/subscriptions` with an app access token
   * (`{app-id}|{app-secret}`). Real call; surfaces Graph errors as AppError.
   *
   * @see https://developers.facebook.com/docs/graph-api/webhooks/subscriptions
   */
  async subscribeWebhooks(topics: string[]): Promise<void> {
    const env = loadEnv();
    if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_VERIFY_TOKEN) {
      throw new AppError(
        'bad_request',
        'META_APP_ID / META_APP_SECRET / META_VERIFY_TOKEN are not configured',
      );
    }
    const callbackUrl = connectorRouteUrl(env, 'meta/webhook');
    await graphPost<GraphErrorEnvelope>(`${env.META_APP_ID}/subscriptions`, {
      object: 'page',
      callback_url: callbackUrl,
      fields: topics.join(','),
      // MUST equal the token the inbound GET handshake checks (webhooks
      // controller) — Meta echoes it back on subscribe. A dedicated secret, NOT
      // the token-encryption key (which is a separate boundary).
      verify_token: env.META_VERIFY_TOKEN,
      access_token: `${env.META_APP_ID}|${env.META_APP_SECRET}`,
    });
  }
}

/** Narrow an unknown payload field to `string`, or `undefined` when absent/other. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Map a Graph node into a provider-agnostic PulledItem, dropping empty metrics. */
function toPulledItem(
  kind: string,
  externalId: string,
  raw: unknown,
  timestamp: string | undefined,
  rawMetrics: Record<string, number | undefined>,
): PulledItem {
  const capturedAt = timestamp ? new Date(timestamp) : new Date();
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawMetrics)) {
    if (typeof value === 'number') metrics[key] = value;
  }
  const base = { kind, externalId, raw, capturedAt };
  return Object.keys(metrics).length > 0 ? { ...base, metrics } : base;
}
