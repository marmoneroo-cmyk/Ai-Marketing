import { pgTable, text, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import type { Role } from '@brandpilot/core';
import { primaryId } from './_shared';
import { orgRef, users } from './identity';

/**
 * Pending invitations for a teammate to join an org with a given role. The
 * emailed link carries a SIGNED token (HMAC, org- + invite-bound — see the API's
 * invite-token module, mirroring oauth-state) rather than a stored hash, because
 * the accept flow is pre-auth: the invitee has no JWT, so the signature is what
 * proves the org + invite and lets the accept endpoint set the org scope before
 * touching this (RLS-isolated) table. `acceptedAt` makes each invite single-use.
 */
export const orgInvites = pgTable(
  'org_invites',
  {
    id: primaryId(),
    orgId: orgRef(),
    email: text('email').notNull(), // invited address, lowercased
    role: text('role').$type<Role>().notNull(),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }), // null = pending
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('org_invites_org_idx').on(t.orgId)], // list an org's pending invites
);
