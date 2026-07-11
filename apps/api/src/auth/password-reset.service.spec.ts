import { createHash } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as argon2 from 'argon2';
import { resetEnvCache } from '@brandpilot/config';
import { users, passwordResetTokens, type Database } from '@brandpilot/db';
import { AppError } from '@brandpilot/core';
import type { EmailMessage, EmailSender } from '../email/email-sender';

// Mock the structured logger so 'password reset requested' / 'password reset
// completed' logs are observable without emitting real log lines, and so we
// can assert exactly which fields (userId only — never token/link/body) were
// logged.
const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn() } }));
vi.mock('@brandpilot/observability', () => ({ logger }));

import { PasswordResetService } from './password-reset.service';

// requestPasswordReset() calls loadEnv() to build the reset link's APP_URL
// base, so the required env vars must be present before it runs. Same idiom
// as packages/connectors/src/crypto.test.ts: seed process.env then reset the
// memoized env cache. APP_URL is set to a fixed value so the link assertions
// below are deterministic.
const TEST_APP_URL = 'https://app.test.brandpilot.example';

function seedTestEnv(): void {
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.AUTH_SECRET = 'x'.repeat(16);
  process.env.TOKEN_ENCRYPTION_KEY = 'test-key';
  process.env.ANTHROPIC_API_KEY = 'test';
  process.env.VOYAGE_API_KEY = 'test';
  process.env.APP_URL = TEST_APP_URL;
  resetEnvCache();
}

/**
 * Behavioural tests for PasswordResetService. The key invariants under test:
 *  - anti-enumeration: an unknown email never throws, never inserts a token,
 *    never sends an email;
 *  - only the SHA-256 hash of the raw token is ever persisted, never the raw
 *    token itself;
 *  - prior tokens are invalidated before a new one is minted, and all tokens
 *    are invalidated again once a reset completes (single active token,
 *    single use);
 *  - resetPassword rejects unknown / expired / already-consumed tokens with
 *    the SAME generic `bad_request` AppError, and never writes a password in
 *    those cases.
 *
 * A fake Database records inserts/updates/deletes; a fake EmailSender records
 * every sent EmailMessage so the raw token can be recovered from the link in
 * `text` and compared against the hash that was actually persisted.
 */

interface Recorded {
  inserted: Array<{ table: unknown; values: Record<string, unknown> }>;
  updated: Array<{ table: unknown; set: Record<string, unknown> }>;
  deleted: Array<{ table: unknown }>;
}

interface FakeDbOptions {
  existingUser?: { id: string; email: string } | undefined;
  existingToken?:
    | { id: string; userId: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null }
    | undefined;
}

function newRecord(): Recorded {
  return { inserted: [], updated: [], deleted: [] };
}

/**
 * Fake Database supporting the exact chains PasswordResetService uses:
 * `query.users.findFirst`, `query.passwordResetTokens.findFirst`,
 * `insert(x).values(y)`, `update(x).set(y).where(...)`, `delete(x).where(...)`.
 */
function fakeDb(rec: Recorded, opts: FakeDbOptions = {}): Database {
  return {
    query: {
      users: { findFirst: () => Promise.resolve(opts.existingUser) },
      passwordResetTokens: { findFirst: () => Promise.resolve(opts.existingToken) },
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        rec.inserted.push({ table, values });
        return Promise.resolve([]);
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        rec.updated.push({ table, set: values });
        return { where: () => Promise.resolve([]) };
      },
    }),
    delete: (table: unknown) => {
      rec.deleted.push({ table });
      return { where: () => Promise.resolve([]) };
    },
  } as unknown as Database;
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

/** Pull the raw token out of a sent email's link (?token=<raw>). */
function extractRawToken(text: string): string {
  const match = /[?&]token=([^\s&]+)/.exec(text);
  if (!match?.[1]) throw new Error('no token found in email text');
  return match[1];
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('PasswordResetService.requestPasswordReset', () => {
  beforeEach(() => {
    seedTestEnv();
    logger.info.mockClear();
  });

  it('resolves silently for an unknown email: no token inserted, no email sent, never throws', async () => {
    const rec = newRecord();
    const emailSender = fakeEmailSender();
    const service = new PasswordResetService(fakeDb(rec, { existingUser: undefined }), emailSender);

    await expect(service.requestPasswordReset('nobody@example.com')).resolves.toBeUndefined();

    expect(rec.inserted).toHaveLength(0);
    expect(rec.deleted).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('for a known email, deletes prior tokens, inserts a token whose stored hash matches the emailed raw token, and logs only the userId', async () => {
    const rec = newRecord();
    const emailSender = fakeEmailSender();
    const existingUser = { id: 'user-1', email: 'known@example.com' };
    const service = new PasswordResetService(fakeDb(rec, { existingUser }), emailSender);

    await service.requestPasswordReset('Known@Example.com');

    // Prior tokens for this user were invalidated first.
    expect(rec.deleted).toHaveLength(1);
    expect(rec.deleted[0]?.table).toBe(passwordResetTokens);

    // Exactly one token row inserted, scoped to the user, with an expiry set.
    expect(rec.inserted).toHaveLength(1);
    const insertedValues = rec.inserted[0]?.values;
    expect(rec.inserted[0]?.table).toBe(passwordResetTokens);
    expect(insertedValues?.userId).toBe('user-1');
    expect(insertedValues?.expiresAt).toBeInstanceOf(Date);

    // One email sent, to the normalized (lowercased) address, linking to the
    // configured APP_URL (never the API's own origin).
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.to).toBe('known@example.com');
    expect(emailSender.sent[0]?.text).toContain(`${TEST_APP_URL}/reset-password?token=`);

    // The critical invariant: the STORED value is the hash, never the raw
    // token. Recover the raw token from the email link and hash it — it must
    // equal what was persisted.
    const rawToken = extractRawToken(emailSender.sent[0]?.text ?? '');
    expect(insertedValues?.tokenHash).toBe(sha256Hex(rawToken));
    // And the raw token itself must never appear in what was persisted.
    expect(insertedValues?.tokenHash).not.toBe(rawToken);

    // Success is observable via a structured log carrying only the userId.
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ userId: 'user-1' }, 'password reset requested');
  });
});

describe('PasswordResetService.resetPassword', () => {
  beforeEach(() => {
    seedTestEnv();
    logger.info.mockClear();
  });

  it('on a valid unconsumed, unexpired token: writes a new argon2id password hash, marks the token consumed, and deletes remaining tokens', async () => {
    const rec = newRecord();
    const existingToken = {
      id: 'token-1',
      userId: 'user-1',
      tokenHash: 'irrelevant-because-lookup-is-faked',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      consumedAt: null,
    };
    const service = new PasswordResetService(
      fakeDb(rec, { existingToken }),
      fakeEmailSender(),
    );

    await service.resetPassword('some-raw-token', 'newSecurePassword123');

    // A new argon2id hash was generated and written to `users.passwordHash`:
    // verify it's a genuine argon2id hash of the exact new password (not the
    // plaintext, not a stale/reused hash).
    const userUpdate = rec.updated.find((u) => u.table === users);
    expect(userUpdate).toBeDefined();
    const writtenHash = userUpdate?.set.passwordHash;
    expect(typeof writtenHash).toBe('string');
    expect(writtenHash).not.toBe('newSecurePassword123');
    expect(String(writtenHash)).toMatch(/^\$argon2id\$/);
    await expect(argon2.verify(String(writtenHash), 'newSecurePassword123')).resolves.toBe(true);

    // The token itself was marked consumed.
    const tokenUpdate = rec.updated.find((u) => u.table === passwordResetTokens);
    expect(tokenUpdate).toBeDefined();
    expect(tokenUpdate?.set.consumedAt).toBeInstanceOf(Date);

    // Remaining tokens for the user were invalidated (delete ran once).
    expect(rec.deleted).toHaveLength(1);
    expect(rec.deleted[0]?.table).toBe(passwordResetTokens);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ userId: 'user-1' }, 'password reset completed');
  });

  it('rejects an unknown token with a generic bad_request AppError and writes nothing', async () => {
    const rec = newRecord();
    const service = new PasswordResetService(
      fakeDb(rec, { existingToken: undefined }),
      fakeEmailSender(),
    );

    await expect(service.resetPassword('nonexistent-token', 'newPassword123')).rejects.toMatchObject({
      code: 'bad_request',
    });
    await expect(service.resetPassword('nonexistent-token', 'newPassword123')).rejects.toBeInstanceOf(
      AppError,
    );

    expect(rec.updated).toHaveLength(0);
    expect(rec.deleted).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('rejects an expired token with a generic bad_request AppError and writes nothing', async () => {
    const rec = newRecord();
    const existingToken = {
      id: 'token-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() - 1000), // already expired
      consumedAt: null,
    };
    const service = new PasswordResetService(
      fakeDb(rec, { existingToken }),
      fakeEmailSender(),
    );

    await expect(service.resetPassword('expired-token', 'newPassword123')).rejects.toMatchObject({
      code: 'bad_request',
    });

    expect(rec.updated).toHaveLength(0);
    expect(rec.deleted).toHaveLength(0);
  });

  it('rejects an already-consumed token with a generic bad_request AppError and writes nothing', async () => {
    const rec = newRecord();
    const existingToken = {
      id: 'token-1',
      userId: 'user-1',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      consumedAt: new Date(), // already used
    };
    const service = new PasswordResetService(
      fakeDb(rec, { existingToken }),
      fakeEmailSender(),
    );

    await expect(service.resetPassword('consumed-token', 'newPassword123')).rejects.toMatchObject({
      code: 'bad_request',
    });

    expect(rec.updated).toHaveLength(0);
    expect(rec.deleted).toHaveLength(0);
  });
});
