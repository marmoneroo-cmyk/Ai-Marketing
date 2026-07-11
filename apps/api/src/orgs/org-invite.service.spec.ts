import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resetEnvCache } from '@brandpilot/config';
import { orgInvites, memberships, type Database } from '@brandpilot/db';
import { AppError } from '@brandpilot/core';
import type { EmailMessage, EmailSender } from '../email/email-sender';
import { readInviteToken } from '../common/invite-token';

// Mock the structured logger so 'team invite created'/'team invite revoked'
// (info) and the routine-rejection debug lines are observable without
// emitting real log lines, and so we can assert exactly which fields
// (orgId/inviteId/role only — never token/email body) were logged.
const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn(), debug: vi.fn() } }));
vi.mock('@brandpilot/observability', () => ({ logger }));

import { OrgInviteService } from './org-invite.service';

// createInvite() calls loadEnv() to build the invite link's APP_URL base and
// sign the token with AUTH_SECRET, so the required env vars must be present
// before it runs. Same idiom as password-reset.service.spec.ts: seed
// process.env then reset the memoized env cache.
const TEST_APP_URL = 'https://app.test.brandpilot.example';
const TEST_AUTH_SECRET = 'x'.repeat(16);

function seedTestEnv(): void {
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.AUTH_SECRET = TEST_AUTH_SECRET;
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key';
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.VOYAGE_API_KEY = 'test';
  process.env.APP_URL = TEST_APP_URL;
  resetEnvCache();
}

const ORG_ID = 'org-1';
const INVITER_ID = 'user-inviter';

interface Recorded {
  inserted: Array<{ table: unknown; values: Record<string, unknown> }>;
  deleted: Array<{ table: unknown }>;
  /** Shared cross-operation sequence ('insert' | 'delete'), so ordering between
   *  inserts and deletes (which live in separate arrays above) can be asserted. */
  ops: Array<'insert' | 'delete'>;
}

interface FakeDbOptions {
  /** Rows returned by the already-member join select in createInvite. */
  existingMemberRows?: Array<{ userId: string }>;
  /** Row returned by the insert().returning() in createInvite. */
  insertedInviteRow?: { id: string } | undefined;
  /** Rows returned by the pending-invites select in listInvites. */
  pendingInviteRows?: Array<{
    id: string;
    email: string;
    role: string;
    createdAt: Date;
  }>;
  /** Rows returned by the delete().returning() in revokeInvite. */
  deletedInviteRows?: Array<{ id: string }>;
}

function newRecord(): Recorded {
  return { inserted: [], deleted: [], ops: [] };
}

/**
 * Fake Database supporting the exact chains OrgInviteService uses inside
 * `withOrgScope` (which this fake short-circuits by just invoking the
 * callback with itself — `set_config` is not exercised):
 *  - `select({...}).from(memberships).innerJoin(users).where().limit()` (member check)
 *  - `select({...}).from(orgInvites).where()` (listInvites)
 *  - `insert(orgInvites).values().returning()`
 *  - `delete(orgInvites).where()` (prior-pending cleanup, no .returning())
 *  - `delete(orgInvites).where().returning()` (revokeInvite)
 *
 * Because both delete() call shapes exist (with and without `.returning()`),
 * the returned builder supports both: `.where()` resolves directly (for the
 * prior-pending cleanup) AND carries a `.returning()` method (for revoke).
 */
function fakeDb(rec: Recorded, opts: FakeDbOptions = {}): Database {
  const db = {
    transaction: (fn: (tx: Database) => Promise<unknown>) => fn(db as unknown as Database),
    execute: () => Promise.resolve(),
    select: (_cols: unknown) => ({
      from: (table: unknown) => {
        if (table === memberships) {
          return {
            innerJoin: () => ({
              where: () => ({
                limit: () => Promise.resolve(opts.existingMemberRows ?? []),
              }),
            }),
          };
        }
        if (table === orgInvites) {
          return {
            where: () => Promise.resolve(opts.pendingInviteRows ?? []),
          };
        }
        throw new Error(`fakeDb.select: unexpected table ${String(table)}`);
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        rec.inserted.push({ table, values });
        rec.ops.push('insert');
        return {
          returning: () =>
            Promise.resolve(opts.insertedInviteRow ? [opts.insertedInviteRow] : []),
        };
      },
    }),
    delete: (table: unknown) => {
      rec.deleted.push({ table });
      rec.ops.push('delete');
      const whereResult: Promise<unknown[]> & { returning: () => Promise<unknown[]> } =
        Object.assign(Promise.resolve(opts.deletedInviteRows ?? []), {
          returning: () => Promise.resolve(opts.deletedInviteRows ?? []),
        });
      return { where: () => whereResult };
    },
  };
  return db as unknown as Database;
}

/** Fake EmailSender that records every message sent, never actually sends. */
function fakeEmailSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send: (msg: EmailMessage) => {
      sent.push(msg);
      return Promise.resolve();
    },
  };
}

/** Pull the invite token out of a sent email's link (?token=<value>). */
function extractToken(text: string): string {
  const match = /[?&]token=([^\s&]+)/.exec(text);
  if (!match?.[1]) throw new Error('no token found in email text');
  return match[1];
}

describe('OrgInviteService.createInvite', () => {
  beforeEach(() => {
    seedTestEnv();
    logger.info.mockClear();
    logger.debug.mockClear();
  });

  it('rejects the owner role', async () => {
    const rec = newRecord();
    const service = new OrgInviteService(fakeDb(rec), fakeEmailSender());

    await expect(
      service.createInvite(ORG_ID, INVITER_ID, 'new@example.com', 'owner'),
    ).rejects.toMatchObject({ code: 'bad_request' });
    await expect(
      service.createInvite(ORG_ID, INVITER_ID, 'new@example.com', 'owner'),
    ).rejects.toBeInstanceOf(AppError);

    expect(rec.inserted).toHaveLength(0);
  });

  it('rejects an invalid/unknown role', async () => {
    const rec = newRecord();
    const service = new OrgInviteService(fakeDb(rec), fakeEmailSender());

    await expect(
      service.createInvite(ORG_ID, INVITER_ID, 'new@example.com', 'superuser'),
    ).rejects.toMatchObject({ code: 'bad_request' });

    expect(rec.inserted).toHaveLength(0);
    // Routine validation friction is greppable at debug level (not a system fault).
    expect(logger.debug).toHaveBeenCalledWith(
      { orgId: ORG_ID, role: 'superuser' },
      'invite rejected: role not assignable',
    );
  });

  it('rejects an email that already belongs to a member of the org (conflict)', async () => {
    const rec = newRecord();
    const service = new OrgInviteService(
      fakeDb(rec, { existingMemberRows: [{ userId: 'user-existing' }] }),
      fakeEmailSender(),
    );

    await expect(
      service.createInvite(ORG_ID, INVITER_ID, 'existing@example.com', 'admin'),
    ).rejects.toMatchObject({ code: 'conflict' });

    expect(rec.inserted).toHaveLength(0);
    // Routine validation friction is greppable at debug level (not a system fault).
    expect(logger.debug).toHaveBeenCalledWith(
      { orgId: ORG_ID, email: 'existing@example.com' },
      'invite rejected: already a member',
    );
  });

  it('deletes any prior pending invite for the email before inserting the new one', async () => {
    const rec = newRecord();
    const emailSender = fakeEmailSender();
    const service = new OrgInviteService(
      fakeDb(rec, { existingMemberRows: [], insertedInviteRow: { id: 'invite-1' } }),
      emailSender,
    );

    await service.createInvite(ORG_ID, INVITER_ID, 'new@example.com', 'admin');

    // Prior-pending cleanup delete ran before the insert (shared cross-table
    // sequence — `rec.deleted`/`rec.inserted` are separate arrays, so their
    // OWN indices aren't comparable to each other; `rec.ops` is).
    expect(rec.deleted).toHaveLength(1);
    expect(rec.deleted[0]?.table).toBe(orgInvites);
    expect(rec.inserted).toHaveLength(1);
    expect(rec.inserted[0]?.table).toBe(orgInvites);
    expect(rec.ops).toEqual(['delete', 'insert']);
  });

  it('on success: inserts a pending row scoped to the org/email/role and sends an email whose link token decodes back to {orgId, inviteId}', async () => {
    const rec = newRecord();
    const emailSender = fakeEmailSender();
    const service = new OrgInviteService(
      fakeDb(rec, { existingMemberRows: [], insertedInviteRow: { id: 'invite-1' } }),
      emailSender,
    );

    await service.createInvite(ORG_ID, INVITER_ID, 'New@Example.com', 'admin');

    // Exactly one invite row inserted, normalized email, correct role/org/inviter.
    const insertedInvite = rec.inserted.find((i) => i.table === orgInvites);
    expect(insertedInvite).toBeDefined();
    expect(insertedInvite?.values.orgId).toBe(ORG_ID);
    expect(insertedInvite?.values.email).toBe('new@example.com');
    expect(insertedInvite?.values.role).toBe('admin');
    expect(insertedInvite?.values.invitedByUserId).toBe(INVITER_ID);
    expect(insertedInvite?.values.expiresAt).toBeInstanceOf(Date);

    // One email sent, to the normalized address, subject fixed, link to APP_URL.
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.to).toBe('new@example.com');
    expect(emailSender.sent[0]?.subject).toBe("You're invited to BrandPilot");
    expect(emailSender.sent[0]?.text).toContain(`${TEST_APP_URL}/accept-invite?token=`);
    expect(emailSender.sent[0]?.text).toContain('expires in 7 days');

    // The critical invariant: the emailed token's signature round-trips back
    // to the exact {orgId, inviteId} this invite was created for — proving the
    // signed-token wiring (createInviteToken → email → readInviteToken).
    const token = extractToken(emailSender.sent[0]?.text ?? '');
    expect(readInviteToken(token, TEST_AUTH_SECRET)).toEqual({
      orgId: ORG_ID,
      inviteId: 'invite-1',
    });

    // Success is logged with orgId/inviteId/role only — never token/email body.
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      { orgId: ORG_ID, inviteId: 'invite-1', role: 'admin' },
      'team invite created',
    );
  });
});

describe('OrgInviteService.listInvites', () => {
  it('returns only pending invites, mapped to the InviteView shape', async () => {
    const rec = newRecord();
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const service = new OrgInviteService(
      fakeDb(rec, {
        pendingInviteRows: [
          { id: 'invite-1', email: 'a@example.com', role: 'admin', createdAt },
          { id: 'invite-2', email: 'b@example.com', role: 'viewer', createdAt },
        ],
      }),
      fakeEmailSender(),
    );

    const views = await service.listInvites(ORG_ID);

    expect(views).toEqual([
      {
        id: 'invite-1',
        email: 'a@example.com',
        role: 'admin',
        status: 'pending',
        invitedAt: createdAt.toISOString(),
      },
      {
        id: 'invite-2',
        email: 'b@example.com',
        role: 'viewer',
        status: 'pending',
        invitedAt: createdAt.toISOString(),
      },
    ]);
  });

  it('returns an empty list when there are no pending invites', async () => {
    const rec = newRecord();
    const service = new OrgInviteService(fakeDb(rec, { pendingInviteRows: [] }), fakeEmailSender());

    await expect(service.listInvites(ORG_ID)).resolves.toEqual([]);
  });
});

describe('OrgInviteService.revokeInvite', () => {
  beforeEach(() => {
    logger.info.mockClear();
  });

  it('deletes the invite scoped to id + orgId and logs the revocation', async () => {
    const rec = newRecord();
    const service = new OrgInviteService(
      fakeDb(rec, { deletedInviteRows: [{ id: 'invite-1' }] }),
      fakeEmailSender(),
    );

    await expect(service.revokeInvite(ORG_ID, 'invite-1')).resolves.toBeUndefined();
    expect(rec.deleted.some((d) => d.table === orgInvites)).toBe(true);

    // Mirrors createInvite's structured log — the audit row's generic DELETE
    // is backed by a specific, greppable line.
    expect(logger.info).toHaveBeenCalledWith(
      { orgId: ORG_ID, inviteId: 'invite-1' },
      'team invite revoked',
    );
  });

  it('throws not_found when no invite matches (wrong id or wrong org), and does NOT log a revocation', async () => {
    const rec = newRecord();
    const service = new OrgInviteService(fakeDb(rec, { deletedInviteRows: [] }), fakeEmailSender());

    await expect(service.revokeInvite(ORG_ID, 'nonexistent-invite')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(service.revokeInvite(ORG_ID, 'nonexistent-invite')).rejects.toBeInstanceOf(AppError);

    expect(logger.info).not.toHaveBeenCalled();
  });
});
