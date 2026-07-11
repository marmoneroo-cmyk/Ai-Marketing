import type { ConversationChannel, ConversationInboundJobData } from '@brandpilot/core';

/**
 * Minimal shapes of the Meta webhook payloads we consume. Meta sends far more
 * than this; we read defensively and ignore anything we don't recognize.
 */
interface MetaWhatsAppMessage {
  from?: string;
  id?: string;
  text?: { body?: string };
}

interface MetaWhatsAppContact {
  wa_id?: string;
  profile?: { name?: string };
}

interface MetaChange {
  field?: string;
  value?: {
    // comments
    from?: { id?: string; username?: string; name?: string };
    comment_id?: string;
    post_id?: string;
    message?: string;
    text?: string;
    // whatsapp
    messaging_product?: string;
    metadata?: { phone_number_id?: string };
    contacts?: MetaWhatsAppContact[];
    messages?: MetaWhatsAppMessage[];
  };
}

interface MetaMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  message?: { text?: string; mid?: string };
}

interface MetaEntry {
  id?: string; // page / IG account / WABA id — the key we map to an org
  changes?: MetaChange[];
  messaging?: MetaMessagingEvent[];
}

interface MetaWebhookBody {
  object?: string;
  entry?: MetaEntry[];
}

/**
 * A parsed inbound message plus the provider account id that produced it. The
 * controller resolves `accountId` → `orgId` (via social_accounts) before
 * enqueueing, since the webhook body carries no org id.
 */
export interface ParsedInbound {
  accountId: string;
  channel: ConversationChannel;
  externalThreadId: string;
  /** Provider's unique id for this message/event (mid / message.id / comment_id). */
  messageExternalId?: string;
  text: string;
  contact?: ConversationInboundJobData['contact'];
}

/** Narrow unknown JSON to the loose Meta webhook envelope. */
function asWebhookBody(body: unknown): MetaWebhookBody {
  return body && typeof body === 'object' ? (body as MetaWebhookBody) : {};
}

function trimmed(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

function buildContact(
  handle: string | undefined,
  name: string | undefined,
): ConversationInboundJobData['contact'] {
  const h = trimmed(handle);
  const n = trimmed(name);
  if (!h && !n) return undefined;
  return { ...(h ? { handle: h } : {}), ...(n ? { name: n } : {}) };
}

/** Assemble one parsed record, dropping events missing a thread id or text. */
function record(
  accountId: string | undefined,
  channel: ConversationChannel,
  externalThreadId: string | undefined,
  messageExternalId: string | undefined,
  text: string | undefined,
  contact: ConversationInboundJobData['contact'],
): ParsedInbound | null {
  const account = trimmed(accountId);
  const thread = trimmed(externalThreadId);
  const body = trimmed(text);
  if (!account || !thread || !body) return null;
  const msgId = trimmed(messageExternalId);
  return {
    accountId: account,
    channel,
    externalThreadId: thread,
    text: body,
    ...(msgId ? { messageExternalId: msgId } : {}),
    ...(contact ? { contact } : {}),
  };
}

/** Parse Facebook/Instagram comment + Messenger events. */
function parseMetaEntries(entries: MetaEntry[]): ParsedInbound[] {
  const out: ParsedInbound[] = [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value) continue;
      // `field` is e.g. "comments" (both FB & IG use it); default to fb_comment.
      const channel: ConversationChannel = change.field === 'comments' ? 'fb_comment' : 'ig_comment';
      const rec = record(
        entry.id,
        channel,
        value.comment_id ?? value.post_id,
        value.comment_id ?? value.post_id,
        value.message ?? value.text,
        buildContact(value.from?.username, value.from?.name),
      );
      if (rec) out.push(rec);
    }

    for (const event of entry.messaging ?? []) {
      const senderId = trimmed(event.sender?.id);
      // Thread key is the PERSON (sender), not the message: `mid` is unique per
      // message, so using it as the thread would open a new conversation for every
      // DM. `mid` is the per-message dedup id instead.
      const rec = record(
        entry.id,
        'messenger',
        senderId,
        event.message?.mid,
        event.message?.text,
        buildContact(senderId, undefined),
      );
      if (rec) out.push(rec);
    }
  }

  return out;
}

/** Parse a WhatsApp Cloud API webhook (messages + contacts). */
function parseWhatsAppEntries(entries: MetaEntry[]): ParsedInbound[] {
  const out: ParsedInbound[] = [];

  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;
      // Prefer the phone_number_id (the account key we store) over the WABA id.
      const accountId = trimmed(value.metadata?.phone_number_id) ?? trimmed(entry.id);
      const profileName = trimmed(value.contacts?.[0]?.profile?.name);

      for (const message of value.messages) {
        const from = trimmed(message.from);
        // Thread is the sender's number; `message.id` is the per-message dedup id.
        const rec = record(
          accountId,
          'whatsapp',
          from,
          message.id,
          message.text?.body,
          buildContact(from, profileName),
        );
        if (rec) out.push(rec);
      }
    }
  }

  return out;
}

/**
 * Parse a Meta webhook body into inbound records. `channelHint` selects the
 * WhatsApp parser (whose payload nests messages differently from Facebook/
 * Instagram comment + messaging events).
 */
export function parseMetaWebhook(body: unknown, channelHint: 'meta' | 'whatsapp'): ParsedInbound[] {
  const entries = asWebhookBody(body).entry ?? [];
  return channelHint === 'whatsapp' ? parseWhatsAppEntries(entries) : parseMetaEntries(entries);
}
