import { createHash } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resetEnvCache } from '@brandpilot/config';
import { users, type Database } from '@brandpilot/db';
import { AppError } from '@brandpilot/core';
import type { EmailMessage, EmailSender } from '../email/email-sender';

// Mock the structured logger so 'email verification sent' / 'email verified'
// logs are observable without emitting real log lines, and so we can assert
// exactly which fields (userId only — never token/link/body) were logged.
const { logger } = vi.hoisted(() => ({ logger: { info: vi.fn() } }));
vi.mock('@brandpilot/observability', () => ({ logger }));

import { EmailVerificationService } from './email-verification.service';

// sendVerification()/resendVerification() call loadEnv() to build the
// verification link's APP_URL base, so the required env vars must be present
// before they run. Same idiom as password-reset.service.spec.ts: seed
// process.env then reset the memoized env cache. APP_URL is fixed so the link
// assertions below are deterministic.
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
 * Behavioural tests for EmailVerificationService. The key invariants under
 * test:
 *  - anti-enumeration: an unknown email never throws, never writes, never
 *    sends an email;
 *  - idempotency: an already-verified user never gets a re-send, whether
 *    reached by email (sendVerification) or userId (resendVerification);
 *  - only the SHA-256 hash of the raw token is ever persisted, never the raw
 *    token itself;
 *  - verifyEmail rejects unknown / expired tokens with the SAME generic
 *    `bad_request` AppError, and never writes in those cases;
 *  - a successful verifyEmail sets emailVerifiedAt and clears both token
 *    columns (single-use).
 *
 * A fake Database records updates; a fake EmailSender records every sent
 * EmailMessage so the raw token can be recovered from the link in `text` and
 * compared against the hash that was actually persisted.
 */

interface Recorded {
  updated: Array<{ table: unknown; set: Record<string, unknown> }>;
}

interface UserRow {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  emailVerificationTokenHash?: string | null;
  emailVerificationExpiresAt?: Date | null;
}

/**
 * Each test configures exactly ONE of these — matching the service's actual
 * call pattern, where a given method issues exactly one `findFirst` lookup
 * (by email, by id, or by token hash). Drizzle's `where` clause is an opaque
 * SQL AST object with no reliable string form, so rather than parse it to
 * decide which fixture to return, the fake simply returns whichever single
 * fixture the test provided.
 */
type FakeDbOptions =
  | { userByEmail: UserRow | undefined }
  | { userById: UserRow | undefined }
  | { userByTokenHash: UserRow | undefined };

function newRecord(): Recorded {
  return { updated: [] };
}

/**
 * Fake Database supporting the exact chains EmailVerificationService uses:
 * `query.users.findFirst` and `update(users).set(y).where(...)`.
 */
function fakeDb(rec: Recorded, opts: FakeDbOptions): Database {
  const row = Object.values(opts)[0] as UserRow | undefined;
  return {
    query: {
      users: {
        findFirst: () => Promise.resolve(row),
      },
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        rec.updated.push({ table, set: values });
        return { where: () => Promise.resolve([]) };
      },
    }),
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

describe('EmailVerificationService.sendVerification', () => {
  beforeEach(() => {
    seedTestEnv();
    logger.info.mockClear();
  });

  it('resolves silently for an unknown email: no write, no email sent, never throws', async () => {
    const rec = newRecord();
    const emailSender = fakeEmailSender();
    const service = new EmailVerificationService(fakeDb(rec, { userByEmail: undefined }), emailSender);

    await expect(service.sendVerification('nobody@example.com')).resolves.toBeUndefined();

    expect(rec.updated).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('resolves silently for an already-verified user: no re-send, no write', async () => {
    const rec = newRecord();
    const emailSender = fakeEmailSender();
    const userByEmail: UserRow = {
      id: 'user-1',
      email: 'verified@example.com',
      emailVerifiedAt: new Date(),
    };
    const service = new EmailVerificationService(fakeDb(rec, { userByEmail }), emailSender);

    await expect(service.sendVerification('verified@example.com')).resolves.toBeUndefined();

    expect(rec.updated).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('for a fresh unverified user, stores the HASH of the emailed raw token (never the raw token) plus an expiry, and logs only the userId', async () => {
    const rec = newRecord();
    const emailSender = fakeEmailSender();
    const userByEmail: UserRow = {
      id: 'user-1',
      email: 'fresh@example.com',
      emailVerifiedAt: null,
    };
    const service = new EmailVerificationService(fakeDb(rec, { userByEmail }), emailSender);

    await service.sendVerification('Fresh@Example.com');

    // Exactly one update, on the users table, scoped by the where clause (not
    // asserted here — the fake routes all updates to a single recorder).
    expect(rec.updated).toHaveLength(1);
    const updateValues = rec.updated[0]?.set;
    expect(rec.updated[0]?.table).toBe(users);
    expect(updateValues?.emailVerificationExpiresAt).toBeInstanceOf(Date);

    // One email sent, to the normalized (lowercased) address, linking to the
    // configured APP_URL (never the API's own origin).
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.to).toBe('fresh@example.com');
    expect(emailSender.sent[0]?.subject).toBe('Verify your BrandPilot email');
    expect(emailSender.sent[0]?.text).toContain(`${TEST_APP_URL}/verify-email?token=`);
    expect(emailSender.sent[0]?.text).toContain('expires in 24 hours');

    // The critical invariant: the STORED value is the hash, never the raw
    // token. Recover the raw token from the email link and hash it — it must
    // equal what was persisted.
    const rawToken = extractRawToken(emailSender.sent[0]?.text ?? '');
    expect(updateValues?.emailVerificationTokenHash).toBe(sha256Hex(rawToken));
    // And the raw token itself must never appear in what was persisted.
    expect(updateValues?.emailVerificationTokenHash).not.toBe(rawToken);

    // Success is observable via a structured log carrying only the userId.
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ userId: 'user-1' }, 'email verification sent');
  });
});

describe('EmailVerificationService.verifyEmail', () => {
  beforeEach(() => {
    seedTestEnv();
    logger.info.mockClear();
  });

  it('on a valid unexpired token: sets emailVerifiedAt and clears both token columns', async () => {
    const rec = newRecord();
    const userByTokenHash: UserRow = {
      id: 'user-1',
      email: 'known@example.com',
      emailVerifiedAt: null,
      emailVerificationTokenHash: 'irrelevant-because-lookup-is-faked',
      emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };
    const service = new EmailVerificationService(fakeDb(rec, { userByTokenHash }), fakeEmailSender());

    await service.verifyEmail('some-raw-token');

    expect(rec.updated).toHaveLength(1);
    const update = rec.updated[0];
    expect(update?.table).toBe(users);
    expect(update?.set.emailVerifiedAt).toBeInstanceOf(Date);
    expect(update?.set.emailVerificationTokenHash).toBeNull();
    expect(update?.set.emailVerificationExpiresAt).toBeNull();

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ userId: 'user-1' }, 'email verified');
  });

  it('rejects an unknown token with a generic bad_request AppError and writes nothing', async () => {
    const rec = newRecord();
    const service = new EmailVerificationService(
      fakeDb(rec, { userByTokenHash: undefined }),
      fakeEmailSender(),
    );

    await expect(service.verifyEmail('nonexistent-token')).rejects.toMatchObject({
      code: 'bad_request',
    });
    await expect(service.verifyEmail('nonexistent-token')).rejects.toBeInstanceOf(AppError);

    expect(rec.updated).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('rejects an expired token with a generic bad_request AppError and writes nothing', async () => {
    const rec = newRecord();
    const userByTokenHash: UserRow = {
      id: 'user-1',
      email: 'known@example.com',
      emailVerifiedAt: null,
      emailVerificationTokenHash: 'hash',
      emailVerificationExpiresAt: new Date(Date.now() - 1000), // already expired
    };
    const service = new EmailVerificationService(fakeDb(rec, { userByTokenHash }), fakeEmailSender());

    await expect(service.verifyEmail('expired-token')).rejects.toMatchObject({
      code: 'bad_request',
    });

    expect(rec.updated).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe('EmailVerificationService.resendVerification', () => {
  beforeEach(() => {
    seedTestEnv();
    logger.info.mockClear();
  });

  it('resolves silently for an unknown userId: no write, no email sent', async () => {
    const rec = newRecord();
    const emailSender = fakeEmailSender();
    const service = new EmailVerificationService(fakeDb(rec, { userById: undefined }), emailSender);

    await expect(service.resendVerification('nonexistent-user')).resolves.toBeUndefined();

    expect(rec.updated).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('resolves silently for an already-verified user: no re-send', async () => {
    const rec = newRecord();
    const emailSender = fakeEmailSender();
    const userById: UserRow = {
      id: 'user-1',
      email: 'verified@example.com',
      emailVerifiedAt: new Date(),
    };
    const service = new EmailVerificationService(fakeDb(rec, { userById }), emailSender);

    await expect(service.resendVerification('user-1')).resolves.toBeUndefined();

    expect(rec.updated).toHaveLength(0);
    expect(emailSender.sent).toHaveLength(0);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('reissues and sends for an unverified user, storing the hash of the newly emailed raw token', async () => {
    const rec = newRecord();
    const emailSender = fakeEmailSender();
    const userById: UserRow = {
      id: 'user-1',
      email: 'unverified@example.com',
      emailVerifiedAt: null,
    };
    const service = new EmailVerificationService(fakeDb(rec, { userById }), emailSender);

    await service.resendVerification('user-1');

    expect(rec.updated).toHaveLength(1);
    expect(emailSender.sent).toHaveLength(1);
    expect(emailSender.sent[0]?.to).toBe('unverified@example.com');

    const rawToken = extractRawToken(emailSender.sent[0]?.text ?? '');
    expect(rec.updated[0]?.set.emailVerificationTokenHash).toBe(sha256Hex(rawToken));

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ userId: 'user-1' }, 'email verification sent');
  });
});
