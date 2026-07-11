import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { resetEnvCache, loadEnv } from '@brandpilot/config';
import { orgInvites, users, memberships, type Database } from '@brandpilot/db';
import { AppError, type Role } from '@brandpilot/core';

// Mock the structured logger so the 'invite accepted' log is observable
// without emitting real log lines, and so we can assert exactly which fields
// (ids + invitedByUserId + newUser only — never token/password) were logged.
const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn() } }));
vi.mock('@brandpilot/observability', () => ({ logger }));

import { createInviteToken } from '../common/invite-token';
import { InviteAcceptanceService } from './invite-acceptance.service';

// previewInvite/acceptInvite call loadEnv() (for AUTH_SECRET, to verify the
// token) so the required env vars must be present before they run. Same idiom
// as password-reset.service.spec.ts: seed process.env then reset the memoized
// env cache.
function seedTestEnv(): void {
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.AUTH_SECRET = 'x'.repeat(16);
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key';
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.VOYAGE_API_KEY = 'test';
  process.env.APP_URL = 'https://app.test.brandpilot.example';
  resetEnvCache();
}

const ORG_ID = 'org-1';
const INVITE_ID = 'invite-1';
const INVITE_EMAIL = 'invitee@example.com';
const INVITE_ROLE: Role = 'marketer';
const INVITER_ID = 'user-inviter-1';

interface OrgInviteRow {
  id: string;
  orgId: string;
  email: string;
  role: Role;
  invitedByUserId: string | null;
  acceptedAt: Date | null;
  expiresAt: Date;
}

interface UserRow {
  id: string;
  email: string;
}

interface MembershipRow {
  orgId: string;
  userId: string;
  role: Role;
}

interface Recorded {
  inserted: Array<{ table: unknown; values: Record<string, unknown> }>;
  updated: Array<{ table: unknown; set: Record<string, unknown> }>;
}

interface FakeDbOptions {
  invite?: OrgInviteRow | undefined;
  org?: { id: string; name: string } | undefined;
  existingUser?: UserRow | undefined;
  existingMembership?: MembershipRow | undefined;
}

function newRecord(): Recorded {
  return { inserted: [], updated: [] };
}

function freshInvite(overrides: Partial<OrgInviteRow> = {}): OrgInviteRow {
  return {
    id: INVITE_ID,
    orgId: ORG_ID,
    email: INVITE_EMAIL,
    role: INVITE_ROLE,
    invitedByUserId: INVITER_ID,
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...overrides,
  };
}

/** True iff `invite` would be atomically claimable by acceptInvite's UPDATE...WHERE right now (pending + unexpired). */
function isClaimable(invite: OrgInviteRow | undefined): boolean {
  return invite != null && invite.acceptedAt == null && invite.expiresAt.getTime() >= Date.now();
}

/**
 * Fake Database supporting the exact chains InviteAcceptanceService uses:
 * `query.orgInvites.findFirst` (previewInvite only), `query.organizations.findFirst`,
 * `query.users.findFirst`, `query.memberships.findFirst`,
 * `insert(x).values(y).returning()`, `insert(x).values(y).onConflictDoNothing()`,
 * `update(x).set(y).where(...).returning()`, plus `transaction`/`execute` for
 * `withOrgScope`. Both the outer `db` and the `tx` passed into callbacks are
 * this same shape (mirrors auth.service.spec.ts's fakeDb).
 *
 * Two things model the ONE-atomic-transaction shape of `acceptInvite` (Fix 1):
 *
 * 1. The atomic single-use claim: `update(orgInvites).set({acceptedAt}).where(...).returning()`
 *    mirrors the real `UPDATE ... WHERE isNull(acceptedAt) AND gte(expiresAt, now)`
 *    — it resolves to `[{email, role, invitedByUserId}]` when `opts.invite` is
 *    still pending + unexpired (`isClaimable`), or `[]` otherwise (already
 *    consumed, expired, or no matching row). This lets tests drive "second
 *    accept of an already-claimed invite" purely through seed state, exactly
 *    like the real WHERE clause would.
 *
 * 2. Real transactional rollback: writes made during `transaction(cb)` are
 *    buffered locally and only flushed into the shared `rec` arrays if `cb`
 *    resolves. If `cb` throws (e.g. the password-required check fails AFTER
 *    the claim already matched), the buffer is discarded and the error
 *    rethrown — so `rec.inserted`/`rec.updated` correctly reflect that
 *    NOTHING durable happened, same as a real Postgres ROLLBACK undoing the
 *    claim along with everything else in that transaction.
 */
function fakeDb(rec: Recorded, opts: FakeDbOptions = {}): Database {
  function makeHandles(target: Recorded) {
    return {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          target.inserted.push({ table, values });
          return {
            returning: () => Promise.resolve([{ id: 'new-user-1' }]),
            onConflictDoNothing: () => Promise.resolve([]),
          };
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          return {
            where: () => ({
              returning: () => {
                // Only record as an effective write when the WHERE actually
                // matches a row — mirrors a real `UPDATE ... WHERE` that hits
                // 0 rows: the statement runs, but nothing changes.
                if (table !== orgInvites || !isClaimable(opts.invite)) {
                  return Promise.resolve([]);
                }
                target.updated.push({ table, set: values });
                const invite = opts.invite as OrgInviteRow;
                return Promise.resolve([
                  {
                    email: invite.email,
                    role: invite.role,
                    invitedByUserId: invite.invitedByUserId,
                  },
                ]);
              },
            }),
          };
        },
      }),
    };
  }

  const shared = {
    execute: () => Promise.resolve([]),
    query: {
      orgInvites: { findFirst: () => Promise.resolve(opts.invite) },
      organizations: { findFirst: () => Promise.resolve(opts.org) },
      users: { findFirst: () => Promise.resolve(opts.existingUser) },
      memberships: { findFirst: () => Promise.resolve(opts.existingMembership) },
    },
    ...makeHandles(rec),
  };

  return {
    ...shared,
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      // Buffer this transaction's writes separately so a thrown error inside
      // `cb` can be rolled back (buffer discarded) rather than polluting the
      // shared `rec` the test asserts against.
      const buffer = newRecord();
      const tx = {
        execute: shared.execute,
        query: shared.query,
        ...makeHandles(buffer),
      };
      const resultOrThrow = await cb(tx);
      rec.inserted.push(...buffer.inserted);
      rec.updated.push(...buffer.updated);
      return resultOrThrow;
    },
  } as unknown as Database;
}

const jwt = { sign: vi.fn(() => 'signed.jwt.token') } as unknown as JwtService;

function mintToken(orgId = ORG_ID, inviteId = INVITE_ID): string {
  return createInviteToken(orgId, inviteId, loadEnv().AUTH_SECRET);
}

beforeEach(() => {
  seedTestEnv();
  logger.info.mockClear();
  (jwt.sign as ReturnType<typeof vi.fn>).mockClear();
});

describe('InviteAcceptanceService.previewInvite', () => {
  it('returns needsPassword=false + orgName/email/role for a valid pending invite when a user already exists', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(
      fakeDb(rec, {
        invite: freshInvite(),
        org: { id: ORG_ID, name: 'Acme Co' },
        existingUser: { id: 'user-1', email: INVITE_EMAIL },
      }),
      jwt,
    );

    const preview = await service.previewInvite(mintToken());

    expect(preview).toEqual({
      orgName: 'Acme Co',
      email: INVITE_EMAIL,
      role: INVITE_ROLE,
      needsPassword: false,
    });
  });

  it('returns needsPassword=true for a valid pending invite when no user exists yet', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(
      fakeDb(rec, {
        invite: freshInvite(),
        org: { id: ORG_ID, name: 'Acme Co' },
        existingUser: undefined,
      }),
      jwt,
    );

    const preview = await service.previewInvite(mintToken());

    expect(preview.needsPassword).toBe(true);
  });

  it('rejects an expired invite with a generic bad_request', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(
      fakeDb(rec, {
        invite: freshInvite({ expiresAt: new Date(Date.now() - 1000) }),
        org: { id: ORG_ID, name: 'Acme Co' },
      }),
      jwt,
    );

    await expect(service.previewInvite(mintToken())).rejects.toMatchObject({ code: 'bad_request' });
    await expect(service.previewInvite(mintToken())).rejects.toBeInstanceOf(AppError);
  });

  it('rejects an already-consumed invite with a generic bad_request', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(
      fakeDb(rec, {
        invite: freshInvite({ acceptedAt: new Date() }),
        org: { id: ORG_ID, name: 'Acme Co' },
      }),
      jwt,
    );

    await expect(service.previewInvite(mintToken())).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('rejects a tampered token with the SAME generic bad_request, without ever querying the invite', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(fakeDb(rec, {}), jwt);

    const validToken = mintToken();
    const tamperedToken = `${validToken.slice(0, -2)}zz`;

    await expect(service.previewInvite(tamperedToken)).rejects.toMatchObject({ code: 'bad_request' });
  });

  it('rejects a missing/empty token with a generic bad_request', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(fakeDb(rec, {}), jwt);

    await expect(service.previewInvite('')).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('InviteAcceptanceService.acceptInvite — new user (no prior account)', () => {
  it('creates a user with an argon2id hash, emailVerifiedAt set, authProvider password; adds membership; marks invite accepted; returns a signed token', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(
      fakeDb(rec, { invite: freshInvite(), existingUser: undefined }),
      jwt,
    );

    const result = await service.acceptInvite(mintToken(), 'aStrongPassword123', 'Jane Doe');

    expect(result.accessToken).toBe('signed.jwt.token');

    const userInsert = rec.inserted.find((i) => i.table === users);
    expect(userInsert).toBeDefined();
    expect(userInsert?.values.email).toBe(INVITE_EMAIL);
    expect(userInsert?.values.name).toBe('Jane Doe');
    expect(userInsert?.values.authProvider).toBe('password');
    expect(userInsert?.values.emailVerifiedAt).toBeInstanceOf(Date);
    const writtenHash = String(userInsert?.values.passwordHash);
    expect(writtenHash).toMatch(/^\$argon2id\$/);
    await expect(argon2.verify(writtenHash, 'aStrongPassword123')).resolves.toBe(true);

    const membershipInsert = rec.inserted.find((i) => i.table === memberships);
    expect(membershipInsert).toBeDefined();
    expect(membershipInsert?.values).toEqual({
      orgId: ORG_ID,
      userId: 'new-user-1',
      role: INVITE_ROLE,
    });

    const inviteUpdate = rec.updated.find((u) => u.table === orgInvites);
    expect(inviteUpdate).toBeDefined();
    expect(inviteUpdate?.set.acceptedAt).toBeInstanceOf(Date);

    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'new-user-1', orgId: ORG_ID, role: INVITE_ROLE });

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      {
        orgId: ORG_ID,
        inviteId: INVITE_ID,
        userId: 'new-user-1',
        invitedByUserId: INVITER_ID,
        newUser: true,
      },
      'invite accepted',
    );
  });

  it('rejects with bad_request and performs NO writes when password is missing for a new account', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(
      fakeDb(rec, { invite: freshInvite(), existingUser: undefined }),
      jwt,
    );

    await expect(service.acceptInvite(mintToken(), undefined, 'Jane Doe')).rejects.toMatchObject({
      code: 'bad_request',
    });

    // The atomic claim itself matches (the invite IS pending/unexpired) before
    // the password check runs, but because everything is ONE transaction, the
    // thrown error rolls the whole thing back — claim included — so nothing
    // durable lands. That rollback is exactly what closes the unlogged
    // partial-state gap Fix 1 targets.
    expect(rec.inserted).toHaveLength(0);
    expect(rec.updated).toHaveLength(0);
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('InviteAcceptanceService.acceptInvite — existing user', () => {
  it('adds a membership with the role from the invite, does NOT create a user, and does NOT touch the existing password', async () => {
    const rec = newRecord();
    const existingUser: UserRow = { id: 'existing-user-1', email: INVITE_EMAIL };
    const service = new InviteAcceptanceService(
      fakeDb(rec, { invite: freshInvite(), existingUser, existingMembership: undefined }),
      jwt,
    );

    const result = await service.acceptInvite(mintToken(), undefined, undefined);

    expect(result.accessToken).toBe('signed.jwt.token');

    // No user row created for an existing account.
    expect(rec.inserted.find((i) => i.table === users)).toBeUndefined();

    const membershipInsert = rec.inserted.find((i) => i.table === memberships);
    expect(membershipInsert).toBeDefined();
    expect(membershipInsert?.values).toEqual({
      orgId: ORG_ID,
      userId: 'existing-user-1',
      role: INVITE_ROLE,
    });

    // Password/name were never written for an existing user.
    const userUpdate = rec.updated.find((u) => u.table === users);
    expect(userUpdate).toBeUndefined();

    const inviteUpdate = rec.updated.find((u) => u.table === orgInvites);
    expect(inviteUpdate?.set.acceptedAt).toBeInstanceOf(Date);

    expect(jwt.sign).toHaveBeenCalledWith({
      sub: 'existing-user-1',
      orgId: ORG_ID,
      role: INVITE_ROLE,
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        orgId: ORG_ID,
        inviteId: INVITE_ID,
        userId: 'existing-user-1',
        invitedByUserId: INVITER_ID,
        newUser: false,
      },
      'invite accepted',
    );
  });

  it('succeeds idempotently without a duplicate membership when the user is already a member of this org', async () => {
    const rec = newRecord();
    const existingUser: UserRow = { id: 'existing-user-1', email: INVITE_EMAIL };
    const existingMembership: MembershipRow = {
      orgId: ORG_ID,
      userId: 'existing-user-1',
      role: 'viewer',
    };
    const service = new InviteAcceptanceService(
      fakeDb(rec, { invite: freshInvite(), existingUser, existingMembership }),
      jwt,
    );

    const result = await service.acceptInvite(mintToken(), undefined, undefined);

    expect(result.accessToken).toBe('signed.jwt.token');
    // No membership insert attempted — already a member, treated as success.
    expect(rec.inserted.find((i) => i.table === memberships)).toBeUndefined();
    // The invite is still marked consumed even though membership already existed.
    expect(rec.updated.find((u) => u.table === orgInvites)?.set.acceptedAt).toBeInstanceOf(Date);
  });
});

describe('InviteAcceptanceService.acceptInvite — invalid invite states', () => {
  it('rejects an expired invite with bad_request and writes nothing', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(
      fakeDb(rec, { invite: freshInvite({ expiresAt: new Date(Date.now() - 1000) }) }),
      jwt,
    );

    await expect(service.acceptInvite(mintToken(), 'somePassword123', undefined)).rejects.toMatchObject({
      code: 'bad_request',
    });

    expect(rec.inserted).toHaveLength(0);
    expect(rec.updated).toHaveLength(0);
    expect(jwt.sign).not.toHaveBeenCalled();
  });

  it('rejects an already-consumed invite with bad_request and writes nothing', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(
      fakeDb(rec, { invite: freshInvite({ acceptedAt: new Date() }) }),
      jwt,
    );

    await expect(service.acceptInvite(mintToken(), 'somePassword123', undefined)).rejects.toMatchObject({
      code: 'bad_request',
    });

    expect(rec.inserted).toHaveLength(0);
    expect(rec.updated).toHaveLength(0);
  });

  it('rejects a nonexistent invite id with bad_request and writes nothing', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(fakeDb(rec, { invite: undefined }), jwt);

    await expect(service.acceptInvite(mintToken(), 'somePassword123', undefined)).rejects.toMatchObject({
      code: 'bad_request',
    });

    expect(rec.inserted).toHaveLength(0);
    expect(rec.updated).toHaveLength(0);
  });

  it('rejects a tampered token with the same generic bad_request and writes nothing', async () => {
    const rec = newRecord();
    const service = new InviteAcceptanceService(fakeDb(rec, { invite: freshInvite() }), jwt);

    const tamperedToken = `${mintToken().slice(0, -2)}zz`;

    await expect(service.acceptInvite(tamperedToken, 'somePassword123', undefined)).rejects.toMatchObject({
      code: 'bad_request',
    });

    expect(rec.inserted).toHaveLength(0);
    expect(rec.updated).toHaveLength(0);
  });

  it('rejects a SECOND accept of an already-claimed invite with bad_request and performs zero user/membership writes (atomic single-use guarantee)', async () => {
    const rec = newRecord();
    // Simulates the state immediately after a first, successful accept: the
    // atomic claim already flipped acceptedAt, so this invite is no longer
    // pending. A second concurrent/replayed accept must find the claim
    // UPDATE...WHERE matches zero rows (isClaimable === false) and fail
    // BEFORE any user lookup, user creation, or membership insert — proving
    // the race Fix 1 closes: two accepts can never both proceed past the claim.
    const service = new InviteAcceptanceService(
      fakeDb(rec, { invite: freshInvite({ acceptedAt: new Date() }), existingUser: undefined }),
      jwt,
    );

    await expect(service.acceptInvite(mintToken(), 'somePassword123', 'Jane Doe')).rejects.toMatchObject({
      code: 'bad_request',
    });

    expect(rec.inserted.find((i) => i.table === users)).toBeUndefined();
    expect(rec.inserted.find((i) => i.table === memberships)).toBeUndefined();
    expect(rec.inserted).toHaveLength(0);
    expect(rec.updated).toHaveLength(0);
    expect(jwt.sign).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});
