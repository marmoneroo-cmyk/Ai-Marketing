import { pgTable, uuid, text, jsonb, numeric, timestamp, unique, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Role, AutonomyMode, ActorType } from '@brandpilot/core';
import { primaryId, timestamps } from './_shared';

export const organizations = pgTable('organizations', {
  id: primaryId(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  industry: text('industry'),
  timezone: text('timezone').notNull().default('UTC'),
  locale: text('locale').notNull().default('en'),
  autonomyMode: text('autonomy_mode').$type<AutonomyMode>().notNull().default('suggest'),
  // Subscription tier; caps resolve from PLAN_CAPS[plan] unless settings.caps overrides.
  plan: text('plan').$type<'free' | 'starter' | 'pro'>().notNull().default('free'),
  settings: jsonb('settings').notNull().default({}),
  ...timestamps(),
});

/** Reusable FK column to the owning organization (cascade delete). */
export const orgRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

export const users = pgTable('users', {
  id: primaryId(),
  email: text('email').notNull().unique(), // exact-match unique; case-insensitive uniqueness enforced by users_email_lower_uq (below)
  name: text('name'),
  passwordHash: text('password_hash'),
  authProvider: text('auth_provider'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  // Email verification: null = unverified (the durable flag). Deliberately NOT
  // a separate token table like password-reset — verification is a single
  // per-user state, not a history of requests, so the active token's hash +
  // expiry live directly on the row it verifies.
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  // sha256(raw token), hex — never the raw token. Null when no verification is
  // outstanding (never sent, or already consumed).
  emailVerificationTokenHash: text('email_verification_token_hash'),
  emailVerificationExpiresAt: timestamp('email_verification_expires_at', { withTimezone: true }),
}, (t) => [
  // Case-insensitive email uniqueness: the app lowercases every email before it
  // touches the DB, but that's only an app-layer convention — without this the
  // plain UNIQUE("email") is case-SENSITIVE, so `alice@x.com` and `Alice@x.com`
  // would be two distinct accounts, breaking the "one canonical user per email"
  // invariant every auth flow (login, reset, verify, invite) relies on and
  // undermining `emailVerifiedAt` as a trust signal. This makes it a real DB
  // guarantee, not a hope.
  uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
]);

export const memberships = pgTable(
  'memberships',
  {
    id: primaryId(),
    orgId: orgRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<Role>().notNull().default('viewer'),
  },
  (t) => [unique('memberships_org_user_uq').on(t.orgId, t.userId)],
);

export const permissions = pgTable('permissions', {
  id: primaryId(),
  membershipId: uuid('membership_id')
    .notNull()
    .references(() => memberships.id, { onDelete: 'cascade' }),
  permission: text('permission').notNull(),
});

export const apiKeys = pgTable('api_keys', {
  id: primaryId(),
  orgId: orgRef(),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull(),
  scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** Append-only audit trail for every consequential action (who/what/when/why/refs). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: primaryId(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    actorType: text('actor_type').$type<ActorType>().notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    rationale: text('rationale'),
    confidence: numeric('confidence', { precision: 4, scale: 3 }),
    citedChunkIds: uuid('cited_chunk_ids').array(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('audit_logs_org_created_idx').on(t.orgId, t.createdAt)],
);
