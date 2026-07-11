import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { users, type Database } from '@brandpilot/db';
import { AppError } from '@brandpilot/core';
import { loadEnv, EMAIL_VERIFICATION_TTL_MS } from '@brandpilot/config';
import { logger } from '@brandpilot/observability';
import { DATABASE } from '../db/db.provider';
import { EMAIL_SENDER, type EmailSender } from '../email/email-sender';
import { generateOneTimeToken, hashOneTimeToken } from './one-time-token';

/**
 * Email-verification flow: send a single-use verification link, then consume
 * it to mark the account verified. Deliberately different shape from
 * `PasswordResetService`: verification state is a single per-user fact (either
 * verified or not), not a history of requests, so the active token's hash +
 * expiry live directly on the `users` row instead of a separate token table.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  /**
   * Request a verification email for `email`. Always resolves — never throws
   * and never reveals whether the account exists (anti-enumeration) or is
   * already verified (idempotent: a second call for an already-verified
   * account is a silent no-op, not a re-send).
   */
  async sendVerification(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    });
    if (!user) return;
    if (user.emailVerifiedAt != null) return;

    await this.issueAndSend(user.id, normalizedEmail);
  }

  /**
   * Consume a verification token, marking its owner's account verified. The
   * token must exist and be unexpired; any other outcome throws the SAME
   * generic `bad_request` error so a caller can't tell which case occurred
   * (invalid vs. expired vs. already used).
   *
   * Idempotency note: once consumed, the token columns are cleared (single-use
   * — see below), so a second click on the same link finds no matching row and
   * yields the same generic error. That's acceptable: the account is already
   * verified by then, and the error message doesn't claim otherwise.
   */
  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = hashOneTimeToken(rawToken);
    const user = await this.db.query.users.findFirst({
      where: eq(users.emailVerificationTokenHash, tokenHash),
    });

    const isUsable =
      user != null &&
      user.emailVerificationExpiresAt != null &&
      user.emailVerificationExpiresAt.getTime() >= Date.now();
    if (!isUsable) {
      throw new AppError('bad_request', 'This verification link is invalid or has expired.');
    }

    await this.db
      .update(users)
      .set({
        emailVerifiedAt: new Date(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
      })
      .where(eq(users.id, user.id));

    logger.info({ userId: user.id }, 'email verified');
  }

  /**
   * Reissue and send a verification email for an already-authenticated user
   * (the "resend" endpoint). Silent no-op if already verified.
   */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (!user) return;
    if (user.emailVerifiedAt != null) return;

    await this.issueAndSend(user.id, user.email);
  }

  /** Mint a fresh token, persist its hash + expiry on the user row, and email the link. */
  private async issueAndSend(userId: string, email: string): Promise<void> {
    const { raw, hash } = generateOneTimeToken();
    await this.db
      .update(users)
      .set({
        emailVerificationTokenHash: hash,
        emailVerificationExpiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      })
      .where(eq(users.id, userId));

    const link = `${loadEnv().APP_URL}/verify-email?token=${raw}`;
    await this.emailSender.send({
      to: email,
      subject: 'Verify your BrandPilot email',
      text:
        `Please verify your BrandPilot email address by clicking the link below:\n\n${link}\n\n` +
        `This link expires in 24 hours. If you didn't create this account, you can safely ignore this email.`,
    });

    // userId only — never the token, link, or email body.
    logger.info({ userId }, 'email verification sent');
  }
}
