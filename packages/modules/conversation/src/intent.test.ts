import { describe, expect, it } from 'vitest';
import { buildIntentPrompt, parseIntent } from './intent';

describe('parseIntent', () => {
  it('parses the intent from a well-formed stringified JSON envelope', () => {
    // Arrange
    const output = JSON.stringify({ intent: 'pricing' });

    // Act
    const intent = parseIntent(output);

    // Assert
    expect(intent).toBe('pricing');
  });

  it('extracts the intent even when the model wraps JSON in prose', () => {
    // Arrange
    const output = 'Sure! Here is the classification: {"intent":"booking"} Hope that helps.';

    // Act
    const intent = parseIntent(output);

    // Assert
    expect(intent).toBe('booking');
  });

  it('normalizes to a trimmed, lowercased token', () => {
    // Arrange
    const output = JSON.stringify({ intent: '  Complaint  ' });

    // Act
    const intent = parseIntent(output);

    // Assert
    expect(intent).toBe('complaint');
  });

  it('falls back to the bare string when output is not JSON', () => {
    // Arrange
    const output = 'QUESTION';

    // Act
    const intent = parseIntent(output);

    // Assert
    expect(intent).toBe('question');
  });

  it('returns an empty string for empty output', () => {
    // Arrange & Act
    const intent = parseIntent('');

    // Assert
    expect(intent).toBe('');
  });

  it('ignores a non-string intent field and falls back to the raw text', () => {
    // Arrange
    const output = '{"intent": 42}';

    // Act
    const intent = parseIntent(output);

    // Assert
    expect(intent).toBe('{"intent": 42}');
  });
});

describe('buildIntentPrompt', () => {
  it('embeds the message and asks for a stringified JSON intent', () => {
    // Arrange
    const text = 'Do you deliver on weekends?';

    // Act
    const prompt = buildIntentPrompt(text);

    // Assert
    expect(prompt).toContain(text);
    expect(prompt).toContain('"intent": string');
  });
});
