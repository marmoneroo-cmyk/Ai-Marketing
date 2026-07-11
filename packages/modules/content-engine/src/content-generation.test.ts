import { describe, expect, it } from 'vitest';
import {
  applyFormatPreference,
  buildVariantPrompt,
  buildWeeklyPlanPrompt,
  clampScore,
  parseVariantCopy,
  parseWeeklyPlan,
} from './content-generation';

describe('parseWeeklyPlan', () => {
  it('parses a well-formed stringified JSON plan', () => {
    // Arrange
    const output = JSON.stringify({
      pillars: ['education', 'social proof'],
      items: [{ format: 'reel', pillar: 'education', brief: 'How-to tip' }],
    });

    // Act
    const plan = parseWeeklyPlan(output);

    // Assert
    expect(plan.pillars).toEqual(['education', 'social proof']);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.format).toBe('reel');
  });

  it('extracts JSON even when the model wraps it in prose', () => {
    // Arrange
    const output = 'Sure! Here is the plan: {"pillars":["a"],"items":[{"format":"post","pillar":"a","brief":"x"}]} Enjoy.';

    // Act
    const plan = parseWeeklyPlan(output);

    // Assert
    expect(plan.pillars).toEqual(['a']);
    expect(plan.items[0]?.brief).toBe('x');
  });

  it('coerces an unknown format to "post"', () => {
    // Arrange
    const output = JSON.stringify({ pillars: [], items: [{ format: 'tweetstorm', pillar: 'p', brief: 'b' }] });

    // Act
    const plan = parseWeeklyPlan(output);

    // Assert
    expect(plan.items[0]?.format).toBe('post');
  });

  it('drops items with neither pillar nor brief', () => {
    // Arrange
    const output = JSON.stringify({ pillars: [], items: [{ format: 'post', pillar: '', brief: '' }] });

    // Act
    const plan = parseWeeklyPlan(output);

    // Assert
    expect(plan.items).toHaveLength(0);
  });

  it('returns an empty plan for non-JSON output', () => {
    // Arrange
    const output = 'the model refused to answer';

    // Act
    const plan = parseWeeklyPlan(output);

    // Assert
    expect(plan).toEqual({ pillars: [], items: [] });
  });
});

describe('parseVariantCopy', () => {
  it('parses caption, hook, cta, and hashtags', () => {
    // Arrange
    const output = JSON.stringify({ caption: 'c', hook: 'h', cta: 'buy', hashtags: ['#a', '#b'] });

    // Act
    const copy = parseVariantCopy(output);

    // Assert
    expect(copy).toEqual({ caption: 'c', hook: 'h', cta: 'buy', hashtags: ['#a', '#b'] });
  });

  it('filters non-string hashtags and defaults missing fields to empty', () => {
    // Arrange
    const output = JSON.stringify({ caption: 'c', hashtags: ['#a', 3, null] });

    // Act
    const copy = parseVariantCopy(output);

    // Assert
    expect(copy.hashtags).toEqual(['#a']);
    expect(copy.hook).toBe('');
    expect(copy.cta).toBe('');
  });

  it('returns empty copy for malformed output', () => {
    // Arrange & Act
    const copy = parseVariantCopy('not json at all');

    // Assert
    expect(copy).toEqual({ caption: '', hook: '', cta: '', hashtags: [] });
  });
});

describe('clampScore', () => {
  it('passes through an in-range value', () => {
    expect(clampScore(0.82)).toBe(0.82);
  });

  it('clamps values outside [0,1]', () => {
    expect(clampScore(1.5)).toBe(1);
    expect(clampScore(-0.2)).toBe(0);
  });

  it('returns 0 for non-finite values', () => {
    expect(clampScore(Number.NaN)).toBe(0);
    expect(clampScore(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('prompt builders', () => {
  it('weekly-plan prompt lists valid formats and asks for stringified JSON', () => {
    // Arrange & Act
    const prompt = buildWeeklyPlanPrompt({
      services: ['haircut'],
      products: [],
      segments: ['locals'],
    });

    // Assert
    expect(prompt).toContain('STRINGIFIED JSON');
    expect(prompt).toContain('reel');
    expect(prompt).toContain('haircut');
    expect(prompt).toContain('(none provided)'); // empty products list
  });

  it('weekly-plan prompt never renders a BRAND VOICE section (the shared AgentRuntime injects it once, not per-module)', () => {
    // Arrange & Act
    const prompt = buildWeeklyPlanPrompt({
      services: ['haircut'],
      products: [],
      segments: ['locals'],
    });

    // Assert
    expect(prompt).not.toContain('BRAND VOICE');
  });

  it('weekly-plan prompt folds in competitor positioning for differentiation', () => {
    // Arrange & Act — positioning contains a comma to prove it is not truncated.
    const prompt = buildWeeklyPlanPrompt({
      services: ['haircut'],
      products: [],
      segments: [],
      competitors: ['SharpCuts — a budget chain, fast but impersonal'],
    });

    // Assert — competitor block present, differentiation framed, comma intact.
    expect(prompt).toContain('COMPETITORS');
    expect(prompt).toContain('differentiate');
    expect(prompt).toContain('SharpCuts — a budget chain, fast but impersonal');
  });

  it('weekly-plan prompt folds in audience personas (pains + goals)', () => {
    const prompt = buildWeeklyPlanPrompt({
      services: ['haircut'],
      products: [],
      segments: ['locals'],
      personas: ['Busy Parent — pains: no time, frizz; wants: quick styling'],
    });

    expect(prompt).toContain('AUDIENCE PERSONAS');
    expect(prompt).toContain('Busy Parent');
    expect(prompt).toContain('quick styling');
  });

  it('weekly-plan prompt omits the competitor block when none are known', () => {
    const prompt = buildWeeklyPlanPrompt({
      services: ['haircut'],
      products: [],
      segments: [],
    });

    expect(prompt).not.toContain('COMPETITORS');
  });

  it('variant prompt names the platform and requested JSON shape', () => {
    // Arrange & Act
    const prompt = buildVariantPrompt({ platform: 'linkedin', format: 'article', pillar: 'thought leadership', brief: 'trends' });

    // Assert
    expect(prompt).toContain('linkedin');
    expect(prompt).toContain('"caption"');
    expect(prompt).toContain('trends');
  });

  it('weekly-plan prompt injects the format-preference instruction when formats is present', () => {
    // Arrange & Act
    const prompt = buildWeeklyPlanPrompt({
      services: ['haircut'],
      products: [],
      segments: [],
      formats: ['reel', 'carousel'],
    });

    // Assert
    expect(prompt).toContain(
      "Only plan content in these formats: reel, carousel — every item's format MUST be one of these.",
    );
  });

  it('weekly-plan prompt omits the format-preference instruction when formats is absent (today\'s behavior)', () => {
    // Arrange & Act
    const prompt = buildWeeklyPlanPrompt({
      services: ['haircut'],
      products: [],
      segments: [],
    });

    // Assert
    expect(prompt).not.toContain('Only plan content in these formats');
  });
});

describe('applyFormatPreference', () => {
  it('coerces items outside the preferred list to the first preferred format', () => {
    // Arrange
    const items = [
      { format: 'post' as const, pillar: 'p1', brief: 'b1' },
      { format: 'story' as const, pillar: 'p2', brief: 'b2' },
      { format: 'reel' as const, pillar: 'p3', brief: 'b3' },
    ];

    // Act
    const result = applyFormatPreference(items, ['reel', 'carousel']);

    // Assert — every item's format is now in the preferred list.
    expect(result.every((item) => ['reel', 'carousel'].includes(item.format))).toBe(true);
    // Items already on-list are untouched; off-list items coerce to the FIRST preferred format.
    expect(result[0]?.format).toBe('reel');
    expect(result[1]?.format).toBe('reel');
    expect(result[2]?.format).toBe('reel');
    // Non-format fields are preserved.
    expect(result[0]?.brief).toBe('b1');
  });

  it('returns items unchanged when formats is absent', () => {
    // Arrange
    const items = [{ format: 'post' as const, pillar: 'p1', brief: 'b1' }];

    // Act
    const result = applyFormatPreference(items, undefined);

    // Assert
    expect(result).toEqual(items);
  });

  it('returns items unchanged when formats is an empty array', () => {
    // Arrange
    const items = [{ format: 'post' as const, pillar: 'p1', brief: 'b1' }];

    // Act
    const result = applyFormatPreference(items, []);

    // Assert
    expect(result).toEqual(items);
  });
});
