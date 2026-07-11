import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAILY_LLM_CALLS,
  DEFAULT_DAILY_MEDIA_CALLS,
  DEFAULT_DAILY_POSTS,
  DEFAULT_MAX_QUOTE_VALUE,
  DEFAULT_MONTHLY_BUDGET,
  PLAN_CAPS,
  resolveMaxQuoteValue,
  resolvePlanCaps,
} from './constants';

/**
 * `resolveMaxQuoteValue` is the single source of truth for the auto-finalize
 * ceiling, shared by the sales approval gate and the Settings read model — so
 * the enforced cap always matches what the owner sees.
 */
describe('resolveMaxQuoteValue', () => {
  it('returns the config default for empty / missing / malformed settings', () => {
    expect(resolveMaxQuoteValue({})).toBe(DEFAULT_MAX_QUOTE_VALUE);
    expect(resolveMaxQuoteValue(null)).toBe(DEFAULT_MAX_QUOTE_VALUE);
    expect(resolveMaxQuoteValue(undefined)).toBe(DEFAULT_MAX_QUOTE_VALUE);
    expect(resolveMaxQuoteValue('nope')).toBe(DEFAULT_MAX_QUOTE_VALUE);
    expect(resolveMaxQuoteValue({ caps: null })).toBe(DEFAULT_MAX_QUOTE_VALUE);
    expect(resolveMaxQuoteValue({ caps: {} })).toBe(DEFAULT_MAX_QUOTE_VALUE);
  });

  it('honors a valid per-org override', () => {
    expect(resolveMaxQuoteValue({ caps: { maxQuoteValue: 25000 } })).toBe(25000);
  });

  it('respects a 0 override (most restrictive; never fails open to the default)', () => {
    expect(resolveMaxQuoteValue({ caps: { maxQuoteValue: 0 } })).toBe(0);
  });

  it('rejects negative / NaN / non-numeric overrides → default', () => {
    expect(resolveMaxQuoteValue({ caps: { maxQuoteValue: -1 } })).toBe(DEFAULT_MAX_QUOTE_VALUE);
    expect(resolveMaxQuoteValue({ caps: { maxQuoteValue: Number.NaN } })).toBe(DEFAULT_MAX_QUOTE_VALUE);
    expect(resolveMaxQuoteValue({ caps: { maxQuoteValue: '5000' } })).toBe(DEFAULT_MAX_QUOTE_VALUE);
  });
});

/**
 * `PLAN_CAPS` / `resolvePlanCaps` gate publishing volume, spend, and channel
 * connections per subscription tier. The `free` tier MUST match today's
 * defaults exactly — every existing org defaults to `plan: 'free'`, so any
 * drift here is a silent regression for the entire installed base.
 */
describe('PLAN_CAPS', () => {
  it('free tier equals the existing pre-plan defaults (no-regression invariant)', () => {
    expect(PLAN_CAPS.free).toEqual({
      dailyPosts: DEFAULT_DAILY_POSTS,
      monthlyBudget: DEFAULT_MONTHLY_BUDGET,
      maxQuoteValue: DEFAULT_MAX_QUOTE_VALUE,
      dailyLlmCalls: DEFAULT_DAILY_LLM_CALLS,
      dailyMediaCalls: DEFAULT_DAILY_MEDIA_CALLS,
      maxChannels: 1,
    });
  });

  it('tiers are monotonic: every numeric cap satisfies free <= starter <= pro', () => {
    const fields = Object.keys(PLAN_CAPS.free) as (keyof typeof PLAN_CAPS.free)[];
    for (const field of fields) {
      expect(PLAN_CAPS.free[field]).toBeLessThanOrEqual(PLAN_CAPS.starter[field]);
      expect(PLAN_CAPS.starter[field]).toBeLessThanOrEqual(PLAN_CAPS.pro[field]);
    }
  });
});

describe('resolvePlanCaps', () => {
  it('returns the plan defaults when settings are missing/malformed', () => {
    expect(resolvePlanCaps('free')).toEqual(PLAN_CAPS.free);
    expect(resolvePlanCaps('starter', {})).toEqual(PLAN_CAPS.starter);
    expect(resolvePlanCaps('pro', null)).toEqual(PLAN_CAPS.pro);
  });

  it('a valid settings.caps override wins over the plan value', () => {
    expect(resolvePlanCaps('free', { caps: { dailyPosts: 99 } })).toEqual({
      ...PLAN_CAPS.free,
      dailyPosts: 99,
    });
  });

  it('honors an explicit 0 override (most restrictive; never fails open)', () => {
    expect(resolvePlanCaps('pro', { caps: { maxChannels: 0 } })).toEqual({
      ...PLAN_CAPS.pro,
      maxChannels: 0,
    });
  });

  it('rejects negative/NaN overrides, falling back to the plan value', () => {
    expect(resolvePlanCaps('starter', { caps: { monthlyBudget: -1 } })).toEqual(PLAN_CAPS.starter);
    expect(
      resolvePlanCaps('starter', { caps: { monthlyBudget: Number.NaN } }),
    ).toEqual(PLAN_CAPS.starter);
  });
});
