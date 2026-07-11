import { describe, expect, it } from 'vitest';
import { buildBriefingPrompt, clampScore, parseBriefing } from './briefing';

describe('parseBriefing', () => {
  it('parses a well-formed stringified JSON briefing', () => {
    // Arrange
    const output = JSON.stringify({
      summary: 'warm lead',
      businessSummary: 'local bakery',
      interests: ['wholesale', 'events'],
      talkingPoints: ['ask about volume'],
      intentEstimate: 0.7,
    });

    // Act
    const briefing = parseBriefing(output);

    // Assert
    expect(briefing.summary).toBe('warm lead');
    expect(briefing.interests).toEqual(['wholesale', 'events']);
    expect(briefing.talkingPoints).toEqual(['ask about volume']);
    expect(briefing.intentEstimate).toBe(0.7);
  });

  it('extracts JSON even when the model wraps it in prose', () => {
    // Arrange
    const output = 'Here you go: {"summary":"s","talkingPoints":["t"],"intentEstimate":0.3} thanks.';

    // Act
    const briefing = parseBriefing(output);

    // Assert
    expect(briefing.summary).toBe('s');
    expect(briefing.talkingPoints).toEqual(['t']);
    expect(briefing.intentEstimate).toBe(0.3);
  });

  it('clamps intent estimate and filters non-string list entries', () => {
    // Arrange
    const output = JSON.stringify({
      summary: 's',
      interests: ['ok', 5, null],
      talkingPoints: [],
      intentEstimate: 1.4,
    });

    // Act
    const briefing = parseBriefing(output);

    // Assert
    expect(briefing.interests).toEqual(['ok']);
    expect(briefing.intentEstimate).toBe(1);
    expect(briefing.businessSummary).toBe('');
  });

  it('returns an empty briefing for non-JSON output', () => {
    // Arrange & Act
    const briefing = parseBriefing('the model refused to answer');

    // Assert
    expect(briefing).toEqual({
      summary: '',
      businessSummary: '',
      interests: [],
      talkingPoints: [],
      intentEstimate: 0,
    });
  });
});

describe('clampScore', () => {
  it('passes through an in-range value', () => {
    expect(clampScore(0.55)).toBe(0.55);
  });

  it('clamps values outside [0,1] and non-finite', () => {
    expect(clampScore(2)).toBe(1);
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(Number.NaN)).toBe(0);
  });
});

describe('buildBriefingPrompt', () => {
  it('asks for stringified JSON and includes contact + messages', () => {
    // Arrange & Act
    const prompt = buildBriefingPrompt({
      name: 'Dana',
      recentMessages: ['can you do next Tuesday?'],
      grounding: 'prefers morning slots',
    });

    // Assert
    expect(prompt).toContain('STRINGIFIED JSON');
    expect(prompt).toContain('Dana');
    expect(prompt).toContain('next Tuesday');
    expect(prompt).toContain('prefers morning slots');
  });

  it('falls back to placeholders when context is empty', () => {
    // Arrange & Act
    const prompt = buildBriefingPrompt({ name: '', recentMessages: [], grounding: '' });

    // Assert
    expect(prompt).toContain('(unnamed)');
    expect(prompt).toContain('(no recent messages)');
    expect(prompt).toContain('(none provided)');
  });
});
