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
 * WhatsApp Cloud API connector over the Graph API v21.0.
 *
 * REAL: `connect` validates the permanent-token + phone-number-id configuration
 * and returns the phone number id as the account (no OAuth exchange — WhatsApp
 * Cloud uses a permanent access token, not an authorization `code`). `push`
 * sends an outbound text message. `subscribeWebhooks` performs a real app
 * subscription (`POST /{app-id}/subscriptions`).
 *
 * NOT APPLICABLE: `pull` returns `[]` — WhatsApp is webhook-driven, inbound
 * messages arrive at the webhook and are handled by the Conversation AI, not
 * polled. `refreshAuth` throws — the token is permanent and never rotates.
 *
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

interface GraphErrorEnvelope {
  error?: { message?: string; type?: string; code?: number };
}

interface MessagesResponse extends GraphErrorEnvelope {
  messaging_product?: string;
  messages?: { id?: string }[];
  contacts?: { input?: string; wa_id?: string }[];
}

/** The request body for a WhatsApp Cloud text message. */
export interface WhatsAppTextMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'text';
  text: { body: string };
}

/**
 * Build the request body for an outbound WhatsApp text message. Pure — no I/O —
 * so it can be unit-tested and reused by callers that batch sends.
 */
export function buildTextMessage(to: string, body: string): WhatsAppTextMessage {
  return {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body },
  };
}

/**
 * POST JSON to a Graph endpoint with a bearer token. Surfaces Graph errors as
 * AppError, mirroring the MetaConnector helpers.
 */
async function graphPostJson<T extends GraphErrorEnvelope>(
  path: string,
  accessToken: string,
  jsonBody: unknown,
): Promise<T> {
  const url = `${GRAPH_API_BASE}/${path.replace(/^\//, '')}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jsonBody),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown network error';
    throw new AppError('bad_request', `WhatsApp Graph request failed: ${message}`);
  }
  const json = (await response.json().catch(() => ({}))) as T;
  if (!response.ok || json.error) {
    const detail = json.error?.message ?? `HTTP ${response.status}`;
    throw new AppError('bad_request', `WhatsApp Graph API error: ${detail}`);
  }
  return json;
}

/** Narrow an unknown payload field to `string`, or `undefined` when absent/other. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export class WhatsAppConnector implements Connector {
  readonly provider = 'whatsapp' as const;

  /**
   * WhatsApp Cloud uses a permanent access token, so there is no `code` to
   * exchange. Validate that WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID are
   * configured and return the phone number id as the connected account. The
   * `code` argument is accepted for interface conformance and ignored.
   */
  async connect(_code: string): Promise<ConnectResult> {
    const env = loadEnv();
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
      throw new AppError('bad_request', 'WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not configured');
    }
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;

    return {
      tokens: { accessToken: env.WHATSAPP_TOKEN },
      account: {
        externalId: phoneNumberId,
        raw: { phoneNumberId },
      },
    };
  }

  /**
   * WhatsApp Cloud permanent tokens do not expire and cannot be refreshed via an
   * OAuth flow — rotate them in the Meta app dashboard instead.
   */
  async refreshAuth(_refreshToken: string): Promise<AuthTokens> {
    throw new AppError('bad_request', 'WhatsApp Cloud uses a permanent token — refreshAuth is not supported');
  }

  /**
   * WhatsApp is webhook-driven, not pollable: inbound messages are delivered to
   * the configured webhook and handled by the Conversation AI. There is no
   * read/list endpoint to pull from, so this returns an empty page.
   */
  async pull(_resource: string, _opts: PullOptions): Promise<PulledItem[]> {
    return [];
  }

  /**
   * Send an outbound text message via
   * `POST /{WHATSAPP_PHONE_NUMBER_ID}/messages`. `action.payload.to` is the
   * recipient (E.164 msisdn) and `action.payload.body` is the message text.
   * `action.accessToken` is used when provided, otherwise WHATSAPP_TOKEN.
   *
   * @see https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
   */
  async push(action: PushAction): Promise<PushResult> {
    const env = loadEnv();
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
    if (!phoneNumberId) {
      throw new AppError('bad_request', 'WHATSAPP_PHONE_NUMBER_ID is not configured');
    }
    const accessToken = action.accessToken || env.WHATSAPP_TOKEN;
    if (!accessToken) {
      throw new AppError('bad_request', 'WHATSAPP_TOKEN is not configured');
    }

    const to = asString(action.payload.to);
    const body = asString(action.payload.body) ?? asString(action.payload.text);
    if (to === undefined) {
      throw new AppError('bad_request', 'WhatsAppConnector.push: payload.to (recipient) is required');
    }
    if (body === undefined) {
      throw new AppError('bad_request', 'WhatsAppConnector.push: payload.body (message text) is required');
    }

    const res = await graphPostJson<MessagesResponse>(
      `${phoneNumberId}/messages`,
      accessToken,
      buildTextMessage(to, body),
    );

    const externalId = res.messages?.[0]?.id;
    return externalId !== undefined ? { externalId, raw: res } : { raw: res };
  }

  /**
   * Subscribe the app to WhatsApp webhook fields on the app object
   * (`POST /{app-id}/subscriptions`). Real call; surfaces Graph errors as
   * AppError. Requires META_APP_ID / META_APP_SECRET (the WhatsApp product lives
   * under the same Meta app) and WHATSAPP_TOKEN.
   *
   * @see https://developers.facebook.com/docs/graph-api/webhooks/subscriptions
   */
  async subscribeWebhooks(topics: string[]): Promise<void> {
    const env = loadEnv();
    if (!env.META_APP_ID || !env.META_APP_SECRET) {
      throw new AppError('bad_request', 'META_APP_ID / META_APP_SECRET are not configured');
    }
    if (!env.WHATSAPP_TOKEN) {
      throw new AppError('bad_request', 'WHATSAPP_TOKEN is not configured');
    }
    if (!env.WHATSAPP_VERIFY_TOKEN) {
      throw new AppError('bad_request', 'WHATSAPP_VERIFY_TOKEN is not configured');
    }
    const callbackUrl = connectorRouteUrl(env, 'whatsapp/webhook');
    await graphPostJson<GraphErrorEnvelope>(`${env.META_APP_ID}/subscriptions`, env.WHATSAPP_TOKEN, {
      object: 'whatsapp_business_account',
      callback_url: callbackUrl,
      fields: topics.join(','),
      // MUST match the inbound GET handshake's expected token; dedicated secret,
      // not the token-encryption key.
      verify_token: env.WHATSAPP_VERIFY_TOKEN,
      access_token: `${env.META_APP_ID}|${env.META_APP_SECRET}`,
    });
  }
}
