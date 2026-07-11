import { Injectable } from '@nestjs/common';
import { loadEnv } from '@brandpilot/config';
import { logger } from '@brandpilot/observability';
import type { EmailMessage, EmailSender } from './email-sender';

/**
 * Default `EmailSender`: logs a structured line instead of sending real mail.
 * This is intentionally the out-of-the-box provider so the app boots with zero
 * email config. A real transactional-email provider (Resend/SES/SMTP) is a
 * documented later gated integration — swap it in by providing a different
 * `EmailSender` implementation for `EMAIL_SENDER` behind an env flag.
 *
 * Production safety: the message body (which may contain a password-reset
 * link) is NEVER logged outside development/test — only `to` + `subject` are
 * logged unconditionally. Logging a reset link in production would let anyone
 * with log access take over an account, defeating the single-use token.
 */
@Injectable()
export class LoggingEmailSender implements EmailSender {
  async send(msg: EmailMessage): Promise<void> {
    logger.info({ to: msg.to, subject: msg.subject }, 'email dispatched (dev sink)');

    if (loadEnv().NODE_ENV !== 'production') {
      logger.info({ to: msg.to, body: msg.text }, 'email body (dev only)');
    }
  }
}
