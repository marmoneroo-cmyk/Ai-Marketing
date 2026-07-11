/** A single outbound email. `html` is optional — plain-text-only sends are valid. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Outbound-email port. Concrete implementations (dev logging sink, or a real
 * transactional-email provider) are swapped in via DI using the `EMAIL_SENDER`
 * token below — callers only ever depend on this interface.
 */
export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

/** DI injection token for the active `EmailSender` implementation. */
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
