import { pgTable, uuid, text, timestamp, unique, index } from 'drizzle-orm/pg-core';
import { primaryId } from './_shared';
import { users } from './identity';

/**
 * Password-reset tokens. GLOBAL table (no `org_id`) — a reset happens with no
 * JWT/org context, exactly like `users`, so it is intentionally NOT listed in
 * `ORG_SCOPED_TABLES` in `rls.ts` (see that file's comment on tables without
 * org linkage). Only a SHA-256 hex digest of the raw token is ever persisted;
 * the raw token is single-use and shown to the user exactly once.
 */
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(), // sha256(raw token), hex — never the raw token
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }), // null = unused
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Lookup key: collision-proof and the only way a reset request is resolved to a user.
    unique('password_reset_tokens_hash_uq').on(t.tokenHash),
    // Supports invalidating/cleaning up all of a user's outstanding tokens.
    index('password_reset_tokens_user_idx').on(t.userId),
  ],
);
