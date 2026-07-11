import { z } from 'zod';

/**
 * Shared password-strength policy for every flow that sets a NEW password
 * (signup, reset-password, accept-invite). Login intentionally does NOT use
 * this module — it authenticates against a stored hash, so enforcing today's
 * complexity policy there would lock out existing users whose passwords
 * predate this policy.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/** A single named password-strength check, with a human-readable label for UI checklists. */
export interface PasswordRule {
  id: string;
  label: string;
  test: (pw: string) => boolean;
}

/**
 * The rules a NEW password must satisfy: minimum length, plus at least one
 * character from each of four classes. Shared by `validatePasswordStrength`
 * (and, through it, `passwordSchema`) AND by the web checklist UI, so the
 * server-enforced policy and what the user sees can never drift apart.
 */
export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: 'At least 8 characters',
    test: (pw) => pw.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: 'uppercase',
    label: 'An uppercase letter',
    test: (pw) => /[A-Z]/.test(pw),
  },
  {
    id: 'lowercase',
    label: 'A lowercase letter',
    test: (pw) => /[a-z]/.test(pw),
  },
  {
    id: 'number',
    label: 'A number',
    test: (pw) => /[0-9]/.test(pw),
  },
  {
    id: 'special',
    label: 'A special character',
    test: (pw) => /[^A-Za-z0-9]/.test(pw),
  },
];

/**
 * Pure, framework-free check of every rule against a candidate password.
 * Returns the ids of any failing rules (empty when `ok` is true). Safe to
 * call from both the API (Node) and the web app (browser).
 */
export function validatePasswordStrength(pw: string): { ok: boolean; failures: string[] } {
  const failures = PASSWORD_RULES.filter((rule) => !rule.test(pw)).map((rule) => rule.id);
  return { ok: failures.length === 0, failures };
}

/**
 * Zod schema for any NEW password field. Built on the SAME rules as
 * `validatePasswordStrength`/`PASSWORD_RULES` (via `.refine`) so the schema
 * can never disagree with the checklist the user sees.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine((pw) => validatePasswordStrength(pw).ok, {
    message: 'Password must include an uppercase letter, a lowercase letter, a number, and a special character.',
  });
