import { pgTable, uuid, text, jsonb, boolean, timestamp, customType, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { SocialProvider } from '@brandpilot/core';
import { primaryId } from './_shared';
import { orgRef } from './identity';

/** Connected social & integration accounts + their (encrypted) OAuth material. */

/**
 * Postgres `bytea` column. Drizzle has no first-class bytea builder, so we map it
 * to a `Buffer` in JS: envelope-encrypted token bytes are stored verbatim.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: primaryId(),
    orgId: orgRef(),
    provider: text('provider').$type<SocialProvider>().notNull(), // enum(instagram,facebook,tiktok,google_business,whatsapp,youtube,linkedin)
    externalId: text('external_id').notNull(), // provider account/page id
    handle: text('handle'),
    displayName: text('display_name'),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    status: text('status')
      .$type<'connected' | 'expired' | 'revoked' | 'error'>()
      .notNull()
      .default('connected'),
    metadata: jsonb('metadata').notNull().default({}),
    connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('social_accounts_org_provider_external_uq').on(t.orgId, t.provider, t.externalId),
    // Supports the plan-tier capacity check (`assertChannelCapacity`), which counts
    // WHERE org_id = ? AND status = 'connected'. The unique index above leads with
    // org_id but not status, so without this the count falls back to a filtered scan.
    index('social_accounts_org_status_idx').on(t.orgId, t.status),
    // Inbound webhook account→org resolution (webhooks.controller.ts) filters
    // (provider, external_id) with NO org_id — the org is unknown pre-resolution.
    // The unique index and the status index above both lead with org_id and can't
    // serve this, so without it the lookup falls back to a cross-tenant scan on
    // the highest-QPS path.
    index('social_accounts_provider_external_idx').on(t.provider, t.externalId),
  ],
);

/** Encrypted OAuth material, separated from the account row it belongs to. */
export const connectorTokens = pgTable('connector_tokens', {
  id: primaryId(),
  socialAccountId: uuid('social_account_id')
    .notNull()
    .references(() => socialAccounts.id, { onDelete: 'cascade' }),
  accessTokenEnc: bytea('access_token_enc').notNull(), // envelope-encrypted
  refreshTokenEnc: bytea('refresh_token_enc'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const webhookSubscriptions = pgTable('webhook_subscriptions', {
  id: primaryId(),
  orgId: orgRef(),
  provider: text('provider').notNull(),
  topic: text('topic').notNull(), // e.g. 'comments','messages','mentions'
  externalSubId: text('external_sub_id'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
