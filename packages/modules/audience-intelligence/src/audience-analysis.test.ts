import { describe, expect, test } from 'vitest';
import {
  buildAudienceCorpus,
  buildAudiencePrompt,
  parseAudienceIntel,
} from './audience-analysis';

describe('buildAudienceCorpus', () => {
  test('joins non-empty trimmed entries', () => {
    expect(buildAudienceCorpus(['  a ', '', ' b '])).toBe('a\n\nb');
  });

  test('bounds length to the char budget', () => {
    expect(buildAudienceCorpus(['x'.repeat(20000)]).length).toBe(12000);
  });
});

describe('buildAudiencePrompt', () => {
  test('includes corpus and the three output collections', () => {
    const prompt = buildAudiencePrompt('audience chatter');
    expect(prompt).toContain('audience chatter');
    expect(prompt).toContain('personas');
    expect(prompt).toContain('segments');
    expect(prompt).toContain('objections');
  });
});

describe('parseAudienceIntel', () => {
  test('parses a full, well-formed payload', () => {
    // Arrange
    const output = JSON.stringify({
      personas: [
        {
          name: 'Busy Parent',
          demographics: { age: '30-45' },
          goals: ['save time'],
          painPoints: ['no time'],
          buyingTriggers: ['back to school'],
          objections: ['too pricey'],
          channels: ['instagram'],
        },
      ],
      segments: [
        { name: 'Locals', criteria: { geo: 'city' }, interests: ['events'], sentiment: 0.4, sizeEstimate: 1200 },
      ],
      objections: [{ objection: 'Too expensive', rebuttal: 'We offer plans' }],
    });

    // Act
    const intel = parseAudienceIntel(output);

    // Assert
    expect(intel.personas).toHaveLength(1);
    expect(intel.personas[0]?.name).toBe('Busy Parent');
    expect(intel.segments[0]?.sentiment).toBe(0.4);
    expect(intel.segments[0]?.sizeEstimate).toBe(1200);
    expect(intel.objections[0]?.rebuttal).toBe('We offer plans');
  });

  test('extracts JSON even with surrounding prose', () => {
    const output = 'Result follows: {"personas": [], "segments": [], "objections": []} done';
    expect(parseAudienceIntel(output)).toEqual({ personas: [], segments: [], objections: [] });
  });

  test('defaults missing numeric fields to null', () => {
    // Arrange
    const output = JSON.stringify({ segments: [{ name: 'S', criteria: {}, interests: [] }] });

    // Act
    const intel = parseAudienceIntel(output);

    // Assert
    expect(intel.segments[0]?.sentiment).toBeNull();
    expect(intel.segments[0]?.sizeEstimate).toBeNull();
  });

  test('coerces malformed persona fields to safe defaults', () => {
    // Arrange — goals is not an array, demographics is a string
    const output = JSON.stringify({ personas: [{ name: 42, goals: 'nope', demographics: 'x' }] });

    // Act
    const intel = parseAudienceIntel(output);

    // Assert
    expect(intel.personas[0]?.name).toBe('');
    expect(intel.personas[0]?.goals).toEqual([]);
    expect(intel.personas[0]?.demographics).toEqual({});
  });

  test('returns empty intel on invalid JSON', () => {
    expect(parseAudienceIntel('garbage')).toEqual({ personas: [], segments: [], objections: [] });
  });
});
