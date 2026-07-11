import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { users, passwordResetTokens, type Database } from '@brandpilot/db';
import { AppError } from '@brandpilot/core';
import { loadEnv, PASSWORD_RESET_TTL_MS } from '@brandpilot/config';
import { logger } from '@brandpilot/observability';
import { DATABASE } from '../db/db.provider';
import { EMAIL_SENDER, type EmailSender } from '../email/email-sender';
import { generateOneTimeToken, hashOneTimeToken } from './one-time-token';

/**
 * Password-reset flow: request a reset link by email, then consume the
 * single-use token to set a new password. Deliberately separate from
 * `AuthService` so the login/register surface stays untouched.
 */
@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(EMAIL_SENDER) private readonly emailSender: EmailSender,
  ) {}

  /**
   * Request a password reset for `email`. Always resolves — never throws and
   * never reveals whether the account exists (anti-enumeration). Only when a
   * matching user is found do we invalidate their outstanding tokens, mint a
   * new one, and email the link.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.db.query.users.findFirst({
      where: eq(users.email, normalizedEmail),
    });
    if (!user) return;

    // Only one active reset token at a time: drop any prior unconsumed ones
    // before minting the new one.
    await this.db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

    const { raw, hash } = generateOneTimeToken();
    await this.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    });

    const link = `${loadEnv().APP_URL}/reset-password?token=${raw}`;
    await this.emailSender.send({
      to: normalizedEmail,
      subject: 'Reset your BrandPilot password',
      text:
        `We received a request to reset your BrandPilot password. Click the link below to choose a new one:\n\n${link}\n\n` +
        `This link expires in 1 hour. If you didn't request this, you can safely ignore this email.`,
    });

    // userId only — never the token, link, or email body.
    logger.info({ userId: user.id }, 'password reset requested');
  }

  /**
   * Consume a password-reset token, setting `newPassword` for its owner. The
   * token must exist, be unconsumed, and be unexpired; any other outcome
   * throws the SAME generic `bad_request` error so a caller can't tell which
   * case occurred (invalid vs. expired vs. already used).
   */
  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashOneTimeToken(rawToken);
    const row = await this.db.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.tokenHash, tokenHash),
    });

    const isUsable = row != null && row.consumedAt == null && row.expiresAt.getTime() >= Date.now();
    if (!isUsable) {
      throw new AppError('bad_request', 'This reset link is invalid or has expired.');
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, row.userId));
    await this.db
      .update(passwordResetTokens)
      .set({ consumedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));

    // Invalidate any other outstanding tokens for this user now that the
    // password has changed. Note: existing JWTs are stateless and are NOT
    // revoked here — a known v1 limitation. A `tokenVersion` column on `users`
    // (checked in the JWT strategy) is the future upgrade to invalidate
    // already-issued access tokens on password change.
    await this.db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, row.userId));

    logger.info({ userId: row.userId }, 'password reset completed');
  }
}
