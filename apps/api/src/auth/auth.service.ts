import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import {
  organizations,
  users,
  memberships,
  withOrgScope,
  type Database,
} from '@brandpilot/db';
import { AppError, type Role } from '@brandpilot/core';
import { logger } from '@brandpilot/observability';
import { DATABASE } from '../db/db.provider';
import { SessionService, type AuthResult } from './session.service';

export type { AuthResult };

/**
 * A real argon2id hash of a random throwaway value, using argon2's default
 * parameters (v=19, m=65536, t=3, p=4). When a login references an unknown
 * email we still run `argon2.verify` against this constant so the not-found
 * path costs the same as the wrong-password path, closing a user-enumeration
 * timing side-channel. It intentionally never matches any real credential.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZVJhbmRvbVNhbHRWYWx1ZQ$Zt3nZ5uYq0Xr7wQK4mCq7hK9m0mB0Wq1jS7iXk8hVng';

export interface RegisterInput {
  email: string;
  password: string;
  name?: string;
  orgName: string;
}

export interface LoginInput {
  email: string;
  password: string;
  /** Optional: pick a specific org when the user belongs to several. */
  orgId?: string;
}

export interface GoogleLoginInput {
  email: string;
  emailVerified: boolean;
  name?: string;
}

/** Either a normal login/registration result, or a refusal to auto-link. */
export type GoogleAuthOutcome = AuthResult | { error: 'email_registered' };

/**
 * Authentication service. Passwords are hashed with argon2id; access tokens are
 * signed with AUTH_SECRET (configured on the JwtModule). The first user of a new
 * org is provisioned as its 'owner'.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly session: SessionService,
  ) {}

  /** Create an org + owner user, returning an access token scoped to that org. */
  async register(input: RegisterInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();

    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existing) {
      throw new AppError('conflict', 'An account with this email already exists');
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const role: Role = 'owner';

    // Provision org + owner user + membership atomically. The org id is
    // pre-generated so withOrgScope can set the `app.org_id` GUC before the
    // inserts: `organizations` (RLS-isolated on id) and `memberships` (on
    // org_id) gate INSERTs via their policy's WITH CHECK, so provisioning must
    // run org-scoped to succeed under FORCE ROW LEVEL SECURITY. Running it in one
    // transaction also makes signup all-or-nothing — any failure rolls the whole
    // org back instead of orphaning an org/user or wedging a now-taken email.
    const orgId = randomUUID();
    const userId = await withOrgScope(this.db, orgId, async (tx) => {
      await tx
        .insert(organizations)
        .values({ id: orgId, name: input.orgName, slug: this.slugify(input.orgName) });

      const [user] = await tx
        .insert(users)
        .values({ email, name: input.name ?? null, passwordHash, authProvider: 'password' })
        .returning({ id: users.id });
      if (!user) throw new AppError('internal_error', 'Failed to create user');

      await tx.insert(memberships).values({ orgId, userId: user.id, role });
      return user.id;
    });

    const result = await this.session.issue({ sub: userId, orgId, role });
    logger.info({ orgId, userId }, 'organization registered');
    return result;
  }

  /** Verify credentials + membership, returning an access token for the org. */
  async login(input: LoginInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();

    const user = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });
    // Guard against user enumeration: whether or not the account exists, run a
    // real argon2 verification so both paths take ~equal time, and return an
    // identical generic error.
    if (!user?.passwordHash) {
      await argon2.verify(DUMMY_PASSWORD_HASH, input.password).catch(() => false);
      throw new AppError('unauthorized', 'Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, input.password);
    if (!valid) {
      throw new AppError('unauthorized', 'Invalid credentials');
    }

    // Resolve the membership (and thus the org + role) to scope the token.
    const membershipWhere = input.orgId
      ? and(eq(memberships.userId, user.id), eq(memberships.orgId, input.orgId))
      : eq(memberships.userId, user.id);
    const membership = await this.db.query.memberships.findFirst({ where: membershipWhere });
    if (!membership) {
      throw new AppError('forbidden', 'User has no active organization membership');
    }

    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

    return this.session.issue({ sub: user.id, orgId: membership.orgId, role: membership.role });
  }

  /**
   * Sign in (or register) via "Continue with Google". The caller (the
   * `GoogleOAuthController` callback) has already verified the OAuth `state`
   * and exchanged the code for a Google-confirmed profile — this only ever
   * sees a trusted `email` / `emailVerified` / `name`.
   *
   * SECURITY INVARIANT: an existing account whose `authProvider` is NOT
   * `'google'` (e.g. a password account) is NEVER auto-linked or logged into
   * here. Silently attaching a Google identity to an existing email would let
   * anyone who controls that Gmail inbox take over the account without ever
   * knowing its password — a classic OAuth account-takeover vector. That case
   * is rejected with `{ error: 'email_registered' }` and makes ZERO writes.
   */
  async loginOrRegisterViaGoogle(input: GoogleLoginInput): Promise<GoogleAuthOutcome> {
    const email = input.email.trim().toLowerCase();

    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (existing) {
      if (existing.authProvider !== 'google') {
        return { error: 'email_registered' };
      }

      // Resolve the membership (and thus the org + role) to scope the token,
      // mirroring login(). A Google user with no membership (e.g. removed from
      // their org) is rejected the same way a password user would be.
      const membership = await this.db.query.memberships.findFirst({
        where: eq(memberships.userId, existing.id),
      });
      if (!membership) {
        throw new AppError('forbidden', 'User has no active organization membership');
      }

      await this.db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, existing.id));

      return this.session.issue({ sub: existing.id, orgId: membership.orgId, role: membership.role });
    }

    // New user: provision org + user + membership atomically, mirroring
    // register(). Google's own verified-email flag is a real trust signal (a
    // password signup never gets this "for free" — theirs relies on the
    // separate email-verification flow), so it seeds `emailVerifiedAt` directly.
    const localPart = email.split('@')[0] ?? email;
    const orgName = `${input.name || localPart}'s workspace`;
    const role: Role = 'owner';

    const orgId = randomUUID();
    const userId = await withOrgScope(this.db, orgId, async (tx) => {
      await tx
        .insert(organizations)
        .values({ id: orgId, name: orgName, slug: this.slugify(orgName) });

      const [user] = await tx
        .insert(users)
        .values({
          email,
          name: input.name ?? null,
          passwordHash: null,
          authProvider: 'google',
          emailVerifiedAt: input.emailVerified ? new Date() : null,
        })
        .returning({ id: users.id });
      if (!user) throw new AppError('internal_error', 'Failed to create user');

      await tx.insert(memberships).values({ orgId, userId: user.id, role });
      return user.id;
    });

    const result = await this.session.issue({ sub: userId, orgId, role });
    logger.info({ orgId, userId }, 'registered via google');
    return result;
  }

  private slugify(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    // Suffix keeps slugs unique without a round-trip; the column is UNIQUE.
    return `${base || 'org'}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
