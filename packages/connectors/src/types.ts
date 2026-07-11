import type { SocialProvider } from '@brandpilot/core';

/**
 * Uniform connector contract. Every provider integration (Meta, TikTok,
 * WhatsApp, ...) implements this so the Discovery / Publishing / Conversation
 * engines can treat all channels through one interface.
 *
 * Runtime note: connectors use the Node 20 global `fetch` — no HTTP client dep.
 */

/** OAuth tokens returned by an auth exchange or refresh. */
export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry; omitted when the provider issues a non-expiring token. */
  expiresAt?: Date;
  scopes?: string[];
}

/** Result of exchanging an OAuth `code` for tokens + the identified account. */
export interface ConnectResult {
  tokens: AuthTokens;
  account: {
    externalId: string;
    handle?: string;
    displayName?: string;
    /** Raw provider account/user payload, kept for later normalization. */
    raw: unknown;
  };
}

/** A single raw item pulled from a provider (post, comment, review, ...). */
export interface PulledItem {
  /** Provider-agnostic kind: post | reel | story | image | video | comment | review | page | media. */
  kind: string;
  externalId: string;
  /** Untouched provider payload — normalized downstream by the Discovery Engine. */
  raw: unknown;
  capturedAt: Date;
  /** Engagement metrics when the provider returns them inline. */
  metrics?: Record<string, number>;
}

/** Options accepted by `pull` — the account + credentials to read on behalf of. */
export interface PullOptions {
  accountId: string;
  accessToken: string;
  /** Max items to fetch this page (provider caps still apply). */
  limit?: number;
  /** Opaque provider cursor for pagination. */
  cursor?: string;
}

/** An outbound action (publish, reply, react). Shape is provider-agnostic. */
export interface PushAction {
  kind: string;
  accountId: string;
  accessToken: string;
  payload: Record<string, unknown>;
}

/** Result of an outbound push (e.g. the created external post id). */
export interface PushResult {
  externalId?: string;
  raw: unknown;
}

/**
 * The interface every connector implements. Methods return promises and use the
 * global `fetch`; auth material is passed in explicitly (never read from module
 * state) so the same connector instance can serve many orgs.
 */
export interface Connector {
  readonly provider: SocialProvider;
  connect(code: string): Promise<ConnectResult>;
  refreshAuth(refreshToken: string): Promise<AuthTokens>;
  pull(resource: string, opts: PullOptions): Promise<PulledItem[]>;
  push(action: PushAction): Promise<PushResult>;
  subscribeWebhooks(topics: string[]): Promise<void>;
}
