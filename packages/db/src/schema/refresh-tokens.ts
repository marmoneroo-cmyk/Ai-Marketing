import {
  pgTable,
  uuid,
  text,
  timestamp,
  unique,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';
import { users, organizations } from './identity';

/**
 * Refresh tokens for long-lived, revocable sessions. GLOBAL table (looked up by
 * a globally-unique hash with no JWT/org context at refresh time, exactly like
 * `password_reset_tokens`), so it is intentionally NOT listed in
 * `ORG_SCOPED_TABLES` in `rls.ts` — the refresh endpoint is pre-auth and never
 * sets the `app.org_id` GUC that RLS keys off. `org_id` is carried only so a
 * rotation can re-mint an access token scoped to the same org without a second
 * lookup.
 *
 * Only a SHA-256 hex digest of the raw token is ever persisted; the raw value is
 * shown to the client exactly once. Rotation marks the old row `revoked_at` and
 * points `replaced_by_id` at its successor, so replaying an already-rotated
 * token is detectable as theft (see SessionService.rotate).
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(), // sha256(raw token), hex — never the raw token
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }), // null = active
    // Rotation lineage: the token that superseded this one. Self-referential;
    // SET NULL on delete so pruning an old row never cascades into its successor.
    replacedById: uuid('replaced_by_id').references((): AnyPgColumn => refreshTokens.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    // Lookup key: collision-proof and the only way a refresh request resolves to a session.
    unique('refresh_tokens_hash_uq').on(t.tokenHash),
    // Supports revoking every session for a user (logout-all / reuse response).
    index('refresh_tokens_user_idx').on(t.userId),
  ],
);
