/**
 * Minimal, dependency-free cron matching for schedule-triggered workflows.
 *
 * The scheduler fires a `workflow.tick` once per minute; `cronMatchesMinute`
 * decides whether a given 5-field cron expression is due at that minute, so a
 * weekly workflow runs weekly instead of every tick. Standard 5-field syntax:
 *
 *   minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, 0/7=Sun)
 *
 * Supports `*`, `N`, `A-B`, `A,B,C`, `* / S` and `A-B/S` in every field.
 * Comparisons use UTC by default, or an org's IANA `timeZone` when passed
 * (DST-correct via `Intl`) so a local "8am" cron fires at the org's 8am. Follows
 * Vixie-cron's day rule: when BOTH day-of-month and day-of-week are restricted,
 * the day matches if EITHER matches; otherwise the restricted one must match.
 */

/** Expand one cron field into the set of numbers it matches within [min,max]. */
function expandField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const token of field.split(',')) {
    const [rangePart, stepPart] = token.split('/');
    const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
    if (!Number.isFinite(step) || step < 1) continue;

    let lo = min;
    let hi = max;
    if (rangePart && rangePart !== '*') {
      const [a, b] = rangePart.split('-');
      lo = Number.parseInt(a ?? '', 10);
      hi = b !== undefined ? Number.parseInt(b, 10) : lo;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;

    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) out.add(v);
    }
  }
  return out;
}

/** Whether `value` satisfies a single cron field (`*` always matches). */
function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;
  return expandField(field, min, max).has(value);
}

/** Wall-clock fields of an instant, in whichever zone they were resolved. */
interface TimeParts {
  minute: number;
  hour: number;
  month: number; // 1-12
  dom: number; // 1-31
  weekday: number; // 0=Sun..6=Sat
}

/** UTC wall-clock parts of `date`. */
function utcParts(date: Date): TimeParts {
  return {
    minute: date.getUTCMinutes(),
    hour: date.getUTCHours(),
    month: date.getUTCMonth() + 1,
    dom: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Wall-clock parts of `date` as observed in an IANA `timeZone`, via `Intl` so
 * daylight-saving offsets are handled correctly for the specific instant. An
 * unknown/invalid zone falls back to UTC (safer than throwing in the tick loop).
 */
function partsInZone(date: Date, timeZone: string): TimeParts {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      minute: '2-digit',
      hour: '2-digit',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
    });
    const map: Record<string, string> = {};
    for (const p of fmt.formatToParts(date)) map[p.type] = p.value;
    return {
      minute: Number.parseInt(map.minute ?? '', 10),
      hour: Number.parseInt(map.hour ?? '', 10),
      month: Number.parseInt(map.month ?? '', 10),
      dom: Number.parseInt(map.day ?? '', 10),
      weekday: WEEKDAY_INDEX[map.weekday ?? ''] ?? date.getUTCDay(),
    };
  } catch {
    return utcParts(date);
  }
}

/**
 * True when `expr` is due at the minute of `date`. Comparisons use `timeZone`'s
 * wall clock when given (IANA name, DST-correct) so an org's "8am" cron fires at
 * its local 8am, not 8am UTC; omitted (or `'UTC'`) preserves UTC matching.
 * Malformed expressions (not exactly 5 fields) never match — a broken cron
 * should not fire every tick.
 */
export function cronMatchesMinute(expr: string, date: Date, timeZone?: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];

  const t = timeZone && timeZone !== 'UTC' ? partsInZone(date, timeZone) : utcParts(date);

  if (!fieldMatches(minute, t.minute, 0, 59)) return false;
  if (!fieldMatches(hour, t.hour, 0, 23)) return false;
  if (!fieldMatches(month, t.month, 1, 12)) return false;

  // Day-of-month / day-of-week combined rule.
  const domStar = dom === '*';
  const dowStar = dow === '*';
  const domOk = fieldMatches(dom, t.dom, 1, 31);
  // Accept 7 as Sunday by also testing weekday 0 against the field's 0-7 range.
  const dowSet = dow === '*' ? null : expandField(dow, 0, 7);
  const dowOk = dowStar || dowSet!.has(t.weekday) || (t.weekday === 0 && dowSet!.has(7));

  if (domStar && dowStar) return true;
  if (domStar) return dowOk;
  if (dowStar) return domOk;
  return domOk || dowOk;
}
