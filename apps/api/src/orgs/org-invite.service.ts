import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull } from 'drizzle-orm';
import { orgInvites, memberships, users, withOrgScope, type Database } from '@brandpilot/db';
import { AppError, type Role } from '@brandpilot/core';
import { loadEnv, ORG_INVITE_TTL_MS } from '@brandpilot/config';
import { logger } from '@brandpilot/observability';
import { DATABASE } from '../db/db.provider';
import { EMAIL_SENDER, type EmailSender } from '../email/email-sender';
import { createInviteToken } from '../common/invite-token';

/** Roles an org member may invite a teammate into. `owner` is excluded — you cannot invite another owner. */
export const ASSIGNABLE_ROLES = ['admin', 'marketer', 'sales', 'viewer'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

function isAssignableRole(role: string): role is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(role);
}

/** A pending invite as surfaced to the Settings team roster. */
export interface InviteView {
  id: string;
  email: string;
  role: Role;
  status: 'pending';
  invitedAt: string;
}

/**
 * Team-invite flow: send an invite (signed token emailed to the invitee),
 * list an org's pending invites, and revoke one before it's accepted. The
 * accept flow itself (consuming the token, pre-auth) is a separate, later
 * unit — this service only issues and manages invites.
 */
@Injectable()
export class OrgInviteService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  /**
   * Invite `email` to join `orgId` with `role`. Rejects `owner` (and any other
   * non-assignable role) and an email that already belongs to a member of this
   * org (conflict — inviting an existing teammate makes no sense). Any prior
   * PENDING invite for the same (org, email) is dropped first so at most one
   * active invite exists per email. On success, mints a signed invite token
   * (see `invite-token.ts`) and emails the accept link.
   */
  async createInvite(
    orgId: string,
    invitedByUserId: string,
    email: string,
    role: string,
  ): Promise<void> {
    if (!isAssignableRole(role)) {
      logger.debug({ orgId, role }, 'invite rejected: role not assignable');
      throw new AppError('bad_request', `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
    }
    const normalizedEmail = email.trim().toLowerCase();

    const inviteId = await withOrgScope(this.db, orgId, async (tx) => {
      const existingMember = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.orgId, orgId), eq(users.email, normalizedEmail)))
        .limit(1);
      if (existingMember.length > 0) {
        logger.debug({ orgId, email: normalizedEmail }, 'invite rejected: already a member');
        throw new AppError('conflict', 'That person is already a member of this organization.');
      }

      // One active invite per email: drop any prior unconsumed one before
      // minting the new one (same idiom as PasswordResetService).
      await tx
        .delete(orgInvites)
        .where(
          and(
            eq(orgInvites.orgId, orgId),
            eq(orgInvites.email, normalizedEmail),
            isNull(orgInvites.acceptedAt),
          ),
        );

      const [inserted] = await tx
        .insert(orgInvites)
        .values({
          orgId,
          email: normalizedEmail,
          role,
          invitedByUserId,
          expiresAt: new Date(Date.now() + ORG_INVITE_TTL_MS),
        })
        .returning({ id: orgInvites.id });
      if (!inserted) {
        throw new AppError('internal_error', 'Failed to create invite');
      }
      return inserted.id;
    });

    const token = createInviteToken(orgId, inviteId, loadEnv().AUTH_SECRET);
    const link = `${loadEnv().APP_URL}/accept-invite?token=${token}`;
    await this.emailSender.send({
      to: normalizedEmail,
      subject: "You're invited to BrandPilot",
      text:
        `You've been invited to join a team on BrandPilot. Click the link below to accept:\n\n${link}\n\n` +
        `This invite expires in 7 days. If you weren't expecting this, you can safely ignore this email.`,
    });

    // orgId/inviteId/role only — never the token, link, or email body.
    logger.info({ orgId, inviteId, role }, 'team invite created');
  }

  /** List an org's PENDING (unaccepted, unexpired) invites for the Settings team roster. */
  async listInvites(orgId: string): Promise<InviteView[]> {
    const rows = await withOrgScope(this.db, orgId, (tx) =>
      tx
        .select({
          id: orgInvites.id,
          email: orgInvites.email,
          role: orgInvites.role,
          createdAt: orgInvites.createdAt,
        })
        .from(orgInvites)
        .where(
          and(
            eq(orgInvites.orgId, orgId),
            isNull(orgInvites.acceptedAt),
            gte(orgInvites.expiresAt, new Date()),
          ),
        ),
    );

    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      status: 'pending' as const,
      invitedAt: row.createdAt.toISOString(),
    }));
  }

  /** Revoke a pending invite. Throws `not_found` if no matching invite exists in this org. */
  async revokeInvite(orgId: string, inviteId: string): Promise<void> {
    const deleted = await withOrgScope(this.db, orgId, (tx) =>
      tx
        .delete(orgInvites)
        .where(and(eq(orgInvites.id, inviteId), eq(orgInvites.orgId, orgId)))
        .returning({ id: orgInvites.id }),
    );
    if (deleted.length === 0) {
      throw new AppError('not_found', 'Invite not found');
    }
    logger.info({ orgId, inviteId }, 'team invite revoked');
  }
}
