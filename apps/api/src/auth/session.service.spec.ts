import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import { AppError, type Role } from '@brandpilot/core';
import { type Database } from '@brandpilot/db';

import { SessionService } from './session.service';
import { generateOneTimeToken, hashOneTimeToken } from './one-time-token';

/**
 * Behavioural tests for the session lifecycle. A fake Database records inserts
 * (new refresh rows) and updates (revocations) so we can assert the security
 * invariants without a live Postgres: only a hash is ever stored, rotation
 * revokes-and-links the old token, and replaying an already-rotated token nukes
 * every session for the user rather than minting a new one.
 */

interface RefreshRow {
  id: string;
  userId: string;
  orgId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

interface Rec {
  inserts: Array<{ values: Record<string, unknown> }>;
  updates: Array<{ set: Record<string, unknown> }>;
}

function fakeDb(opts: {
  tokenRow?: RefreshRow;
  membership?: { role: Role };
  claimLoss?: boolean;
}): { db: Database; rec: Rec } {
  const rec: Rec = { inserts: [], updates: [] };
  const db = {
    query: {
      refreshTokens: { findFirst: async () => opts.tokenRow },
      memberships: { findFirst: async () => opts.membership },
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        rec.inserts.push({ values });
        return { returning: async () => [{ id: 'new-refresh-id' }] };
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        // `where` is both awaitable (revoke / link updates) and exposes
        // `.returning()` (the atomic rotation claim). `claimLoss` simulates a
        // concurrent rotation winning the claim first (0 rows returned).
        where: () => {
          rec.updates.push({ set });
          const rows = opts.claimLoss ? [] : [{ id: 'claimed-id' }];
          return Object.assign(Promise.resolve(rows), {
            returning: async () => rows,
          });
        },
      }),
    }),
  } as unknown as Database;
  return { db, rec };
}

const jwt = { sign: vi.fn(() => 'signed.access') } as unknown as JwtService;

function makeService(
  opts: { tokenRow?: RefreshRow; membership?: { role: Role }; claimLoss?: boolean } = {},
) {
  const { db, rec } = fakeDb(opts);
  return { service: new SessionService(db, jwt), rec };
}

const USER_ID = 'user-1';
const ORG_ID = 'org-1';

/** A live (unexpired, un-revoked) refresh token + the row a lookup would return. */
function liveToken(): { raw: string; row: RefreshRow } {
  const { raw, hash } = generateOneTimeToken();
  return {
    raw,
    row: {
      id: 'old-id',
      userId: USER_ID,
      orgId: ORG_ID,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedById: null,
    },
  };
}

beforeEach(() => {
  (jwt.sign as ReturnType<typeof vi.fn>).mockClear();
});

describe('SessionService.issue', () => {
  it('signs an access token and persists ONLY a hash of the refresh token', async () => {
    const { service, rec } = makeService();

    const result = await service.issue({ sub: USER_ID, orgId: ORG_ID, role: 'owner' });

    expect(result.accessToken).toBe('signed.access');
    expect(typeof result.refreshToken).toBe('string');
    expect(result.refreshToken.length).toBeGreaterThan(20);

    expect(rec.inserts).toHaveLength(1);
    const stored = rec.inserts[0]?.values;
    expect(stored?.userId).toBe(USER_ID);
    expect(stored?.orgId).toBe(ORG_ID);
    // The raw token is never persisted — only its digest.
    expect(stored?.tokenHash).toBe(hashOneTimeToken(result.refreshToken));
    expect(stored?.tokenHash).not.toBe(result.refreshToken);
    expect(stored?.expiresAt).toBeInstanceOf(Date);
    // A fresh login is not a rotation → no prior token revoked.
    expect(rec.updates).toHaveLength(0);
  });
});

describe('SessionService.rotate', () => {
  it('rotates a valid token: issues a new pair and revokes + links the old token', async () => {
    const { raw, row } = liveToken();
    const { service, rec } = makeService({ tokenRow: row, membership: { role: 'admin' } });

    const result = await service.rotate(raw);

    expect(result.accessToken).toBe('signed.access');
    expect(result.refreshToken.length).toBeGreaterThan(20);
    // The access token is re-signed with the CURRENT role from membership.
    expect(jwt.sign).toHaveBeenCalledWith({ sub: USER_ID, orgId: ORG_ID, role: 'admin' });
    // The old token is atomically claimed (revoked), a new row is inserted, and
    // the old row is linked to it: a claim update, an insert, then a link update.
    expect(rec.inserts).toHaveLength(1);
    expect(rec.updates).toHaveLength(2);
    expect(rec.updates[0]?.set.revokedAt).toBeInstanceOf(Date); // atomic claim
    expect(rec.updates[1]?.set.replacedById).toBe('new-refresh-id'); // lineage link
  });

  it('rejects WITHOUT nuking sessions when it loses the atomic rotation race', async () => {
    const { raw, row } = liveToken();
    const { service, rec } = makeService({
      tokenRow: row,
      membership: { role: 'owner' },
      claimLoss: true,
    });

    await expect(service.rotate(raw)).rejects.toBeInstanceOf(AppError);
    // The claim was attempted (1 update) but lost, so NOTHING new was minted and
    // the user's other sessions were NOT bulk-revoked — a benign multi-tab race
    // must not force a global logout.
    expect(rec.inserts).toHaveLength(0);
    expect(rec.updates).toHaveLength(1);
  });

  it('detects reuse of an already-rotated token: revokes ALL sessions and refuses', async () => {
    const { raw, row } = liveToken();
    row.revokedAt = new Date(Date.now() - 1000); // already rotated/revoked
    const { service, rec } = makeService({ tokenRow: row });

    await expect(service.rotate(raw)).rejects.toBeInstanceOf(AppError);
    // One bulk revoke of the user's sessions, and NOTHING new issued.
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0]?.set.revokedAt).toBeInstanceOf(Date);
    expect(rec.inserts).toHaveLength(0);
  });

  it('rejects an expired token without issuing anything', async () => {
    const { raw, row } = liveToken();
    row.expiresAt = new Date(Date.now() - 1000);
    const { service, rec } = makeService({ tokenRow: row });

    await expect(service.rotate(raw)).rejects.toBeInstanceOf(AppError);
    expect(rec.inserts).toHaveLength(0);
  });

  it('rejects an unknown token', async () => {
    const { service } = makeService({ tokenRow: undefined });
    await expect(service.rotate('not-a-real-token')).rejects.toBeInstanceOf(AppError);
  });

  it('ends the session when the membership is gone (user removed from the org)', async () => {
    const { raw, row } = liveToken();
    const { service, rec } = makeService({ tokenRow: row, membership: undefined });

    await expect(service.rotate(raw)).rejects.toBeInstanceOf(AppError);
    // The presented token is revoked; no new pair minted.
    expect(rec.inserts).toHaveLength(0);
    expect(rec.updates).toHaveLength(1);
  });
});

describe('SessionService.revoke', () => {
  it('marks the presented token revoked (logout)', async () => {
    const { service, rec } = makeService();
    await service.revoke('some-token');
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0]?.set.revokedAt).toBeInstanceOf(Date);
  });
});
