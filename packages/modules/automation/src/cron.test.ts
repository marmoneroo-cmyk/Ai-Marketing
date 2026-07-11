import { describe, expect, it } from 'vitest';
import { cronMatchesMinute } from './cron';

/**
 * `cronMatchesMinute` gates schedule-triggered workflows so a weekly cron fires
 * weekly, not on every per-minute tick. All dates are explicit UTC instants.
 * Anchor: 2026-07-06 is a Monday, 2026-07-05 a Sunday.
 */
describe('cronMatchesMinute', () => {
  it('matches the weekly content-plan cron only at Mon 08:00 UTC', () => {
    expect(cronMatchesMinute('0 8 * * 1', new Date('2026-07-06T08:00:00Z'))).toBe(true); // Monday 08:00
    expect(cronMatchesMinute('0 8 * * 1', new Date('2026-07-06T08:01:00Z'))).toBe(false); // wrong minute
    expect(cronMatchesMinute('0 8 * * 1', new Date('2026-07-06T09:00:00Z'))).toBe(false); // wrong hour
    expect(cronMatchesMinute('0 8 * * 1', new Date('2026-07-07T08:00:00Z'))).toBe(false); // Tuesday
  });

  it('matches a daily cron at its time on any day', () => {
    expect(cronMatchesMinute('0 6 * * *', new Date('2026-07-06T06:00:00Z'))).toBe(true);
    expect(cronMatchesMinute('0 6 * * *', new Date('2026-07-07T06:00:00Z'))).toBe(true);
    expect(cronMatchesMinute('0 6 * * *', new Date('2026-07-07T06:01:00Z'))).toBe(false);
  });

  it('supports step and list minute fields', () => {
    expect(cronMatchesMinute('*/15 * * * *', new Date('2026-07-06T10:30:00Z'))).toBe(true);
    expect(cronMatchesMinute('*/15 * * * *', new Date('2026-07-06T10:07:00Z'))).toBe(false);
    expect(cronMatchesMinute('0,30 * * * *', new Date('2026-07-06T10:30:00Z'))).toBe(true);
  });

  it('matches day-of-month and treats 7 as Sunday', () => {
    expect(cronMatchesMinute('0 0 1 * *', new Date('2026-07-01T00:00:00Z'))).toBe(true); // 1st
    expect(cronMatchesMinute('0 0 1 * *', new Date('2026-07-02T00:00:00Z'))).toBe(false);
    expect(cronMatchesMinute('0 0 * * 7', new Date('2026-07-05T00:00:00Z'))).toBe(true); // Sunday via 7
  });

  it('never matches a malformed expression', () => {
    expect(cronMatchesMinute('0 8 * *', new Date('2026-07-06T08:00:00Z'))).toBe(false); // 4 fields
    expect(cronMatchesMinute('', new Date('2026-07-06T08:00:00Z'))).toBe(false);
  });
});

describe('cronMatchesMinute — timezone aware', () => {
  it("fires at the org's local 8am, not 8am UTC (summer, EDT = UTC-4)", () => {
    const cron = '0 8 * * *';
    // 2026-07-06 is summer → America/New_York is EDT (UTC-4): local 08:00 = 12:00 UTC.
    expect(cronMatchesMinute(cron, new Date('2026-07-06T12:00:00Z'), 'America/New_York')).toBe(true);
    // 08:00 UTC is 04:00 ET → must NOT match.
    expect(cronMatchesMinute(cron, new Date('2026-07-06T08:00:00Z'), 'America/New_York')).toBe(false);
  });

  it('is DST-correct: the same local 8am maps to a later UTC hour in winter (EST = UTC-5)', () => {
    const cron = '0 8 * * *';
    // 2026-01-06 is winter → EST (UTC-5): local 08:00 = 13:00 UTC.
    expect(cronMatchesMinute(cron, new Date('2026-01-06T13:00:00Z'), 'America/New_York')).toBe(true);
    expect(cronMatchesMinute(cron, new Date('2026-01-06T12:00:00Z'), 'America/New_York')).toBe(false);
  });

  it('resolves the weekday in-zone across a UTC day boundary', () => {
    // Mon 22:00 America/Los_Angeles (PDT, UTC-7) is Tue 05:00 UTC.
    const cron = '0 22 * * 1'; // Monday 22:00 local
    expect(cronMatchesMinute(cron, new Date('2026-07-07T05:00:00Z'), 'America/Los_Angeles')).toBe(true);
    // In UTC that same instant is Tuesday 05:00 → must not match.
    expect(cronMatchesMinute(cron, new Date('2026-07-07T05:00:00Z'))).toBe(false);
  });

  it('treats omitted / UTC / invalid zones as UTC', () => {
    const cron = '0 8 * * *';
    const at8Utc = new Date('2026-07-06T08:00:00Z');
    expect(cronMatchesMinute(cron, at8Utc)).toBe(true); // omitted → UTC
    expect(cronMatchesMinute(cron, at8Utc, 'UTC')).toBe(true); // explicit UTC
    expect(cronMatchesMinute(cron, at8Utc, 'Not/AZone')).toBe(true); // invalid → UTC fallback
  });
});
