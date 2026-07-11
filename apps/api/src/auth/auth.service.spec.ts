import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import { AppError } from '@brandpilot/core';
import { organizations, users, memberships, type Database } from '@brandpilot/db';

// Mock the structured logger so the success-path 'organization registered'
// log is observable without emitting real log lines during the test run.
const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn() } }));
vi.mock('@brandpilot/observability', () => ({ logger }));

import { AuthService, type GoogleAuthOutcome } from './auth.service';

/**
 * Behavioural tests for AuthService.register. The key invariants are that signup
 * provisions org + owner user + membership inside a SINGLE transaction (so a
 * partial failure can never orphan an org/user), that the pre-generated org id
 * is reused for the membership, and that a duplicate email is rejected before
 * any write. A fake Database records transaction/insert calls; the real
 * `withOrgScope` drives it end to end.
 */

interface Recorded {
  transactions: number;
  inserted: Array<{ table: unknown; values: Record<string, unknown> }>;
}

/**
 * Fake Database whose `transaction` runs its callback with a fake tx that
 * records inserts. `values()` is both awaitable and exposes `.returning()`, so
 * it supports `tx.insert(x).values(y)` and `tx.insert(x).values(y).returning()`.
 */
function fakeDb(rec: Recorded, existingUser?: unknown): Database {
  const tx = {
    execute: () => Promise.resolve([]),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        rec.inserted.push({ table, values });
        return Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([{ id: 'user-1' }]),
        });
      },
    }),
  };
  return {
    query: { users: { findFirst: () => Promise.resolve(existingUser) } },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      rec.transactions++;
      return cb(tx);
    },
  } as unknown as Database;
}

const jwt = { sign: () => 'signed.jwt.token' } as unknown as JwtService;

function newRecord(): Recorded {
  return { transactions: 0, inserted: [] };
}

describe('AuthService.register', () => {
  beforeEach(() => {
    logger.info.mockClear();
  });

  it('provisions org + owner user + membership atomically in one transaction', async () => {
    const rec = newRecord();
    const service = new AuthService(fakeDb(rec), jwt);

    const result = await service.register({
      email: 'A@Biz.CO',
      password: 'pw-123',
      orgName: 'Biz',
    });

    expect(result.accessToken).toBe('signed.jwt.token');
    // All three writes ran inside exactly one transaction.
    expect(rec.transactions).toBe(1);

    const org = rec.inserted.find((i) => i.table === organizations);
    const user = rec.inserted.find((i) => i.table === users);
    const membership = rec.inserted.find((i) => i.table === memberships);
    expect(org).toBeDefined();
    expect(user).toBeDefined();
    expect(membership).toBeDefined();

    // The pre-generated org id is reused for the membership (same tenant), and
    // the first user is provisioned as owner.
    expect(typeof org?.values.id).toBe('string');
    expect(membership?.values.orgId).toBe(org?.values.id);
    expect(membership?.values.role).toBe('owner');
    // Email is normalized to lowercase before persistence.
    expect(user?.values.email).toBe('a@biz.co');

    // Signup is observable: a structured info log with only ids (no PII) fires
    // on the success path, after the token is issued.
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { orgId: org?.values.id, userId: 'user-1' },
      'organization registered',
    );
  });

  it('rejects a duplicate email before opening a transaction', async () => {
    const rec = newRecord();
    const service = new AuthService(fakeDb(rec, { id: 'existing-user' }), jwt);

    try {
      await service.register({ email: 'taken@biz.co', password: 'pw-123', orgName: 'Biz' });
      throw new Error('expected register to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('conflict');
    }

    // No org/user/membership writes and no transaction were started.
    expect(rec.transactions).toBe(0);
    expect(rec.inserted).toHaveLength(0);
    // Rejected before signup completes: no 'organization registered' log.
    expect(logger.info).not.toHaveBeenCalled();
  });
});

/**
 * Behavioural tests for AuthService.loginOrRegisterViaGoogle. The key
 * invariants: a brand-new email provisions org + user + membership atomically
 * (authProvider 'google', emailVerifiedAt seeded from Google's own verified
 * flag) exactly like register(); an existing google-linked user logs in
 * without creating anything; and — the REQUIRED security invariant — an
 * existing account under any OTHER authProvider (password) is never
 * auto-linked or logged into, and triggers zero writes.
 */
interface GoogleRecorded {
  transactions: number;
  inserted: Array<{ table: unknown; values: Record<string, unknown> }>;
  updated: Array<{ table: unknown; values: Record<string, unknown> }>;
}

function newGoogleRecord(): GoogleRecorded {
  return { transactions: 0, inserted: [], updated: [] };
}

/**
 * Separate fake DB from `fakeDb` above (register()'s tests): this method also
 * needs `query.memberships.findFirst` and `db.update(...).set(...).where(...)`
 * (mirroring login()'s lastLoginAt bump), which the register-only fake doesn't
 * support. Kept independent so neither fake's shape can silently drift and
 * mask a regression in the other's tests.
 */
function fakeGoogleDb(
  rec: GoogleRecorded,
  existingUser?: { id: string; authProvider: string | null },
  membership?: { orgId: string; role: string },
): Database {
  const tx = {
    execute: () => Promise.resolve([]),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        rec.inserted.push({ table, values });
        return Object.assign(Promise.resolve([]), {
          returning: () => Promise.resolve([{ id: 'user-1' }]),
        });
      },
    }),
  };
  return {
    query: {
      users: { findFirst: () => Promise.resolve(existingUser) },
      memberships: { findFirst: () => Promise.resolve(membership) },
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      rec.transactions++;
      return cb(tx);
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          rec.updated.push({ table, values });
          return Promise.resolve([]);
        },
      }),
    }),
  } as unknown as Database;
}

/** Narrow the union return type down to the access-token branch, or fail loudly. */
function expectAccessToken(result: GoogleAuthOutcome): string {
  if (!('accessToken' in result)) {
    throw new Error(`expected an access token, got ${JSON.stringify(result)}`);
  }
  return result.accessToken;
}

describe('AuthService.loginOrRegisterViaGoogle', () => {
  beforeEach(() => {
    logger.info.mockClear();
  });

  it('provisions a new org + user (authProvider "google", passwordHash null, emailVerifiedAt set) and returns a token for a brand-new email', async () => {
    const rec = newGoogleRecord();
    const service = new AuthService(fakeGoogleDb(rec, undefined), jwt);

    const result = await service.loginOrRegisterViaGoogle({
      email: 'New@Biz.CO',
      emailVerified: true,
      name: 'Ava Chen',
    });

    expect(expectAccessToken(result)).toBe('signed.jwt.token');
    // All three writes ran inside exactly one transaction, like register().
    expect(rec.transactions).toBe(1);

    const org = rec.inserted.find((i) => i.table === organizations);
    const user = rec.inserted.find((i) => i.table === users);
    const membership = rec.inserted.find((i) => i.table === memberships);
    expect(org).toBeDefined();
    expect(user?.values).toMatchObject({
      email: 'new@biz.co', // normalized
      name: 'Ava Chen',
      passwordHash: null,
      authProvider: 'google',
    });
    expect(user?.values.emailVerifiedAt).toBeInstanceOf(Date);
    expect(membership?.values.role).toBe('owner');
    expect(membership?.values.orgId).toBe(org?.values.id);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { orgId: org?.values.id, userId: 'user-1' },
      'registered via google',
    );
  });

  it('leaves emailVerifiedAt null when Google reports the email as unverified, and defaults the org name from the email when no name is given', async () => {
    const rec = newGoogleRecord();
    const service = new AuthService(fakeGoogleDb(rec, undefined), jwt);

    await service.loginOrRegisterViaGoogle({ email: 'unverified@biz.co', emailVerified: false });

    const org = rec.inserted.find((i) => i.table === organizations);
    const user = rec.inserted.find((i) => i.table === users);
    expect(user?.values.emailVerifiedAt).toBeNull();
    expect(org?.values.name).toBe("unverified's workspace");
  });

  it('logs in an existing google-linked user by bumping lastLoginAt, without creating a new org', async () => {
    const rec = newGoogleRecord();
    const service = new AuthService(
      fakeGoogleDb(rec, { id: 'existing-1', authProvider: 'google' }, { orgId: 'org-9', role: 'owner' }),
      jwt,
    );

    const result = await service.loginOrRegisterViaGoogle({
      email: 'existing@biz.co',
      emailVerified: true,
    });

    expect(expectAccessToken(result)).toBe('signed.jwt.token');
    expect(rec.transactions).toBe(0);
    expect(rec.inserted).toHaveLength(0);
    expect(rec.updated).toHaveLength(1);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('REQUIRED INVARIANT: refuses to link a Google identity onto an existing password account — no login, no link, zero writes', async () => {
    const rec = newGoogleRecord();
    const service = new AuthService(
      fakeGoogleDb(rec, { id: 'existing-2', authProvider: 'password' }),
      jwt,
    );

    const result = await service.loginOrRegisterViaGoogle({
      email: 'taken@biz.co',
      emailVerified: true,
    });

    expect(result).toEqual({ error: 'email_registered' });
    expect(rec.transactions).toBe(0);
    expect(rec.inserted).toHaveLength(0);
    expect(rec.updated).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('treats a null authProvider (legacy row) the same as a non-google account: refuses to link', async () => {
    const rec = newGoogleRecord();
    const service = new AuthService(
      fakeGoogleDb(rec, { id: 'existing-3', authProvider: null }),
      jwt,
    );

    const result = await service.loginOrRegisterViaGoogle({
      email: 'legacy@biz.co',
      emailVerified: true,
    });

    expect(result).toEqual({ error: 'email_registered' });
    expect(rec.inserted).toHaveLength(0);
    expect(rec.updated).toHaveLength(0);
  });
});
