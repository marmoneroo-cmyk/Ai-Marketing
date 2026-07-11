import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, eq, gte, isNull } from 'drizzle-orm';
import {
  organizations,
  orgInvites,
  users,
  memberships,
  withOrgScope,
  type Database,
} from '@brandpilot/db';
import { AppError, type Role } from '@brandpilot/core';
import { loadEnv } from '@brandpilot/config';
import { logger } from '@brandpilot/observability';
import { DATABASE } from '../db/db.provider';
import { readInviteToken } from '../common/invite-token';
import { SessionService, type AuthResult } from './session.service';

/** The generic, non-distinguishing error for any invalid/expired/tampered invite. */
const INVALID_INVITE_MESSAGE = 'This invite is invalid or has expired.';

export interface InvitePreview {
  orgName: string;
  email: string;
  role: Role;
  /** True when no account exists yet for the invite's email (the accept form must collect a password). */
  needsPassword: boolean;
}

export type AcceptInviteResult = AuthResult;

/** Validated, still-pending invite row shape used internally between the fetch and mutate steps. */
interface PendingInvite {
  email: string;
  role: Role;
}

/**
 * Team-invite ACCEPT flow: preview an emailed invite token before the user
 * commits, then consume it to join the org (creating an account first if the
 * invitee doesn't have one yet). Pre-auth by design — the caller holds no JWT,
 * so the signed token itself (see `invite-token.ts`) is what proves both the
 * org + invite identity AND that the bearer controls the invited email
 * address, at the same trust tier as a password-reset link.
 *
 * Every failure mode (missing, tampered, expired, already-consumed invite)
 * throws the SAME generic `bad_request` — a caller must never be able to
 * distinguish "this token is garbage" from "this invite already got used" by
 * probing the endpoint. The one deliberate exception is `needsPassword` on
 * the preview response, which intentionally signals whether the invited
 * email already has an account so the web form knows which fields to show.
 */
@Injectable()
export class InviteAcceptanceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly session: SessionService,
  ) {}

  /** Resolve a raw invite token to what the accept screen needs to render, without consuming it. */
  async previewInvite(rawToken: string): Promise<InvitePreview> {
    const { orgId, inviteId } = readInviteToken(rawToken, loadEnv().AUTH_SECRET);

    const { email, role, orgName } = await withOrgScope(this.db, orgId, async (tx) => {
      const invite = await tx.query.orgInvites.findFirst({
        where: eq(orgInvites.id, inviteId),
      });
      const pending = validatePending(invite);

      const org = await tx.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
        columns: { name: true },
      });
      if (!org) {
        throw new AppError('bad_request', INVALID_INVITE_MESSAGE);
      }

      return { email: pending.email, role: pending.role, orgName: org.name };
    });

    // `users` is a global (non-org-scoped) table — see rls.ts — so this lookup
    // deliberately runs OUTSIDE withOrgScope, mirroring OrgsController.getProfile.
    const existingUser = await this.db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true },
    });

    return { orgName, email, role, needsPassword: existingUser == null };
  }

  /**
   * Consume a raw invite token: create an account for the invitee if they
   * don't have one yet (REQUIRES `password` in that case), add them as a
   * member of the invite's org, mark the invite single-use consumed, and
   * return a fresh access token scoped to that org.
   *
   * Runs as ONE atomic `withOrgScope` transaction — not fetch-then-mutate —
   * so single-use is enforced by an atomic claim (an UPDATE...WHERE that only
   * succeeds against a still-pending, unexpired row) rather than being merely
   * advisory between two separate transactions. This closes a race where two
   * concurrent accepts could both pass validation and both create a user
   * before either flips `acceptedAt`. It also means any failure anywhere in
   * the flow (e.g. a user-insert error) rolls back the claim along with
   * everything else, so the invite reverts to pending rather than leaving an
   * unlogged partial-state gap — a retry, and the audit trail, both just work.
   */
  async acceptInvite(
    rawToken: string,
    password: string | undefined,
    name: string | undefined,
  ): Promise<AcceptInviteResult> {
    const { orgId, inviteId } = readInviteToken(rawToken, loadEnv().AUTH_SECRET);

    const { userId, isNewUser, role, invitedByUserId } = await withOrgScope(
      this.db,
      orgId,
      async (tx) => {
        // Atomic single-use claim: consume ONLY if still pending + unexpired.
        // The role/email/invitedByUserId returned here are the sole source of
        // truth for the rest of this flow — never taken from the request.
        const [claimed] = await tx
          .update(orgInvites)
          .set({ acceptedAt: new Date() })
          .where(
            and(
              eq(orgInvites.id, inviteId),
              isNull(orgInvites.acceptedAt),
              gte(orgInvites.expiresAt, new Date()),
            ),
          )
          .returning({
            email: orgInvites.email,
            role: orgInvites.role,
            invitedByUserId: orgInvites.invitedByUserId,
          });
        if (!claimed) {
          throw new AppError('bad_request', INVALID_INVITE_MESSAGE);
        }

        // `users` is a global (non-RLS) table — see rls.ts — but this
        // `findFirst` runs fine inside the org-scoped tx (it just isn't
        // filtered by it), same as previewInvite's unscoped lookup does
        // outside one.
        const existingUser = await tx.query.users.findFirst({
          where: eq(users.email, claimed.email),
          columns: { id: true },
        });

        const isNewUser = existingUser == null;
        if (isNewUser && !password) {
          throw new AppError('bad_request', 'A password is required to create your account.');
        }

        const resolvedUserId = existingUser
          ? existingUser.id
          : await createInvitedUser(tx, claimed.email, name, requirePassword(password));

        // Idempotent membership: a brand-new user can never already be a
        // member, but an existing invitee might be (e.g. a re-sent or stale
        // invite link) — skip silently rather than error, since accepting an
        // invite you no longer strictly need is still a success from the
        // invitee's point of view. `onConflictDoNothing` is a backstop
        // against the same race for both branches, keying off the
        // `(orgId, userId)` unique constraint.
        const alreadyMember = existingUser
          ? await tx.query.memberships.findFirst({
              where: and(eq(memberships.orgId, orgId), eq(memberships.userId, resolvedUserId)),
            })
          : undefined;
        if (!alreadyMember) {
          await tx
            .insert(memberships)
            .values({ orgId, userId: resolvedUserId, role: claimed.role })
            .onConflictDoNothing();
        }

        return {
          userId: resolvedUserId,
          isNewUser,
          role: claimed.role,
          invitedByUserId: claimed.invitedByUserId,
        };
      },
    );

    const result = await this.session.issue({ sub: userId, orgId, role });

    // ids only — never the raw token or password.
    logger.info({ orgId, inviteId, userId, invitedByUserId, newUser: isNewUser }, 'invite accepted');

    return result;
  }
}

/**
 * Validate a fetched invite row is usable (exists, unaccepted, unexpired),
 * throwing the shared generic error otherwise. Narrows to the fields the rest
 * of the flow needs.
 */
function validatePending(
  invite: { email: string; role: Role; acceptedAt: Date | null; expiresAt: Date } | undefined,
): PendingInvite {
  if (!invite || invite.acceptedAt != null || invite.expiresAt.getTime() < Date.now()) {
    throw new AppError('bad_request', INVALID_INVITE_MESSAGE);
  }
  return { email: invite.email, role: invite.role };
}

/**
 * Narrow `password | undefined` to `password`. Only called on the new-user
 * path, after `acceptInvite` has already thrown `bad_request` when it was
 * missing — this just gives the compiler the same proof, so the create-user
 * call site needs no cast and can never silently pass `undefined` through.
 */
function requirePassword(password: string | undefined): string {
  if (!password) {
    throw new AppError('bad_request', 'A password is required to create your account.');
  }
  return password;
}

/**
 * Create a brand-new account for an invitee with no prior user row. Runs
 * inside the caller's org-scoped transaction. `emailVerifiedAt` is set to now
 * — accepting an emailed invite link already proves control of that address
 * (same trust tier as password-reset), so there is no separate verification
 * step to gate on for an account created this way.
 */
async function createInvitedUser(
  tx: Database,
  email: string,
  name: string | undefined,
  password: string,
): Promise<string> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const [created] = await tx
    .insert(users)
    .values({
      email,
      name: name ?? null,
      passwordHash,
      authProvider: 'password',
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id });
  if (!created) {
    throw new AppError('internal_error', 'Failed to create user');
  }
  return created.id;
}
