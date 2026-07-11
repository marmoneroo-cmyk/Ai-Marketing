import { describe, expect, test } from 'vitest';
import { buildCorpus, buildVoicePrompt, parseVoiceProfile } from './voice-analysis';

describe('buildCorpus', () => {
  test('joins non-empty trimmed documents with blank lines', () => {
    // Arrange
    const docs = ['  hello  ', '', '  world '];

    // Act
    const corpus = buildCorpus(docs);

    // Assert
    expect(corpus).toBe('hello\n\nworld');
  });

  test('returns empty string when all documents are blank', () => {
    expect(buildCorpus(['', '   ', '\n'])).toBe('');
  });

  test('bounds the corpus length to the max char budget', () => {
    // Arrange
    const huge = 'a'.repeat(20000);

    // Act
    const corpus = buildCorpus([huge]);

    // Assert
    expect(corpus.length).toBe(12000);
  });
});

describe('buildVoicePrompt', () => {
  test('includes the corpus and the JSON output contract', () => {
    const prompt = buildVoicePrompt('brand copy here');
    expect(prompt).toContain('brand copy here');
    expect(prompt).toContain('doExamples');
    expect(prompt).toContain('STRINGIFIED JSON');
  });
});

describe('parseVoiceProfile', () => {
  test('parses a well-formed profile and clamps confidence', () => {
    // Arrange
    const output = JSON.stringify({
      personality: { warm: 'friendly' },
      tone: { casual: true },
      vocabulary: { preferred: ['fresh'], avoid: ['cheap'] },
      doExamples: ['Say hi!'],
      dontExamples: ['Buy now!!!'],
      confidence: 0.812,
    });

    // Act
    const profile = parseVoiceProfile(output);

    // Assert
    expect(profile.personality).toEqual({ warm: 'friendly' });
    expect(profile.doExamples).toEqual(['Say hi!']);
    expect(profile.confidence).toBe(0.812);
  });

  test('extracts JSON even when surrounded by prose', () => {
    const output = 'Here is the profile: {"confidence": 0.5} — hope that helps';
    expect(parseVoiceProfile(output).confidence).toBe(0.5);
  });

  test('clamps out-of-range confidence into [0,1]', () => {
    expect(parseVoiceProfile('{"confidence": 5}').confidence).toBe(1);
    expect(parseVoiceProfile('{"confidence": -2}').confidence).toBe(0);
  });

  test('filters non-string entries out of example arrays', () => {
    const profile = parseVoiceProfile('{"doExamples": ["ok", 3, null, "yes"]}');
    expect(profile.doExamples).toEqual(['ok', 'yes']);
  });

  test('returns an empty profile on invalid JSON', () => {
    // Act
    const profile = parseVoiceProfile('not json at all');

    // Assert
    expect(profile).toEqual({
      personality: {},
      tone: {},
      vocabulary: {},
      doExamples: [],
      dontExamples: [],
      confidence: 0,
    });
  });
});
