import { describe, it, expect } from 'vitest';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  passwordSchema,
  validatePasswordStrength,
} from './password';

describe('validatePasswordStrength', () => {
  it('rejects a password shorter than the minimum length', () => {
    const result = validatePasswordStrength('Ab1!'); // every class present, but only 4 chars
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['length']);
  });

  it('rejects a password missing an uppercase letter', () => {
    const result = validatePasswordStrength('lowercase1!');
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['uppercase']);
  });

  it('rejects a password missing a lowercase letter', () => {
    const result = validatePasswordStrength('UPPERCASE1!');
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['lowercase']);
  });

  it('rejects a password missing a digit', () => {
    const result = validatePasswordStrength('NoDigitsHere!');
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['number']);
  });

  it('rejects a password missing a special character', () => {
    const result = validatePasswordStrength('NoSpecial123');
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(['special']);
  });

  it('reports every failing rule at once for a fully weak password', () => {
    const result = validatePasswordStrength('password');
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(['uppercase', 'number', 'special']));
  });

  it('accepts a password satisfying every rule', () => {
    const result = validatePasswordStrength('Correct-Horse-1');
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('exposes exactly 5 rules with distinct ids and human-readable labels', () => {
    expect(PASSWORD_RULES).toHaveLength(5);
    expect(new Set(PASSWORD_RULES.map((rule) => rule.id)).size).toBe(5);
    expect(PASSWORD_RULES.map((rule) => rule.label)).toEqual([
      'At least 8 characters',
      'An uppercase letter',
      'A lowercase letter',
      'A number',
      'A special character',
    ]);
  });
});

describe('passwordSchema', () => {
  it('throws for a weak password (e.g. "password")', () => {
    expect(() => passwordSchema.parse('password')).toThrow();
  });

  it('throws for a password shorter than the minimum length', () => {
    expect(() => passwordSchema.parse('Ab1!')).toThrow();
  });

  it('throws for a password longer than the maximum length even if otherwise strong', () => {
    const tooLong = `Aa1!${'a'.repeat(PASSWORD_MAX_LENGTH)}`;
    expect(tooLong.length).toBeGreaterThan(PASSWORD_MAX_LENGTH);
    expect(() => passwordSchema.parse(tooLong)).toThrow();
  });

  it('parses a strong password and returns it unchanged', () => {
    const strong = 'Correct-Horse-1';
    expect(strong.length).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
    expect(passwordSchema.parse(strong)).toBe(strong);
  });
});
