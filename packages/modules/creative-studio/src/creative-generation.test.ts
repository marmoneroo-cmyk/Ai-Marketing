import { describe, expect, it } from 'vitest';
import {
  buildImagePrompt,
  buildStoryboardPrompt,
  clampDuration,
  parseImageSpec,
  parseStoryboard,
} from './creative-generation';
import type { BrandKitContext, CreativeItemContext } from './types';

const ITEM: CreativeItemContext = {
  kind: 'image',
  format: 'post',
  pillar: 'education',
  brief: 'How-to tip',
};

const BRAND: BrandKitContext = {
  colors: [{ hex: '#0A0A0A', role: 'primary' }],
  fonts: ['Inter'],
  designNotes: 'clean and minimal',
};

describe('parseImageSpec', () => {
  it('parses a well-formed stringified JSON spec', () => {
    // Arrange
    const output = JSON.stringify({ imagePrompt: 'a bright studio', altText: 'a bright studio' });

    // Act
    const spec = parseImageSpec(output);

    // Assert
    expect(spec.imagePrompt).toBe('a bright studio');
    expect(spec.altText).toBe('a bright studio');
  });

  it('extracts JSON even when the model wraps it in prose', () => {
    // Arrange
    const output = 'Sure! {"imagePrompt":"neon sign","altText":"a neon sign"} Enjoy.';

    // Act
    const spec = parseImageSpec(output);

    // Assert
    expect(spec.imagePrompt).toBe('neon sign');
    expect(spec.altText).toBe('a neon sign');
  });

  it('defaults missing fields to empty strings', () => {
    // Arrange
    const output = JSON.stringify({ imagePrompt: 'only prompt' });

    // Act
    const spec = parseImageSpec(output);

    // Assert
    expect(spec.imagePrompt).toBe('only prompt');
    expect(spec.altText).toBe('');
  });

  it('returns an empty spec for non-JSON output', () => {
    // Arrange & Act
    const spec = parseImageSpec('the model refused to answer');

    // Assert
    expect(spec).toEqual({ imagePrompt: '', altText: '' });
  });
});

describe('parseStoryboard', () => {
  it('parses scenes with shot, caption, and duration', () => {
    // Arrange
    const output = JSON.stringify({
      scenes: [{ shot: 'wide shot', caption: 'Meet us', durationSec: 4 }],
    });

    // Act
    const board = parseStoryboard(output);

    // Assert
    expect(board.scenes).toHaveLength(1);
    expect(board.scenes[0]?.shot).toBe('wide shot');
    expect(board.scenes[0]?.durationSec).toBe(4);
  });

  it('clamps out-of-range and non-numeric durations', () => {
    // Arrange
    const output = JSON.stringify({
      scenes: [
        { shot: 'a', caption: '', durationSec: 999 },
        { shot: 'b', caption: '', durationSec: 'nope' },
      ],
    });

    // Act
    const board = parseStoryboard(output);

    // Assert
    expect(board.scenes[0]?.durationSec).toBe(60);
    expect(board.scenes[1]?.durationSec).toBe(3);
  });

  it('drops scenes with neither shot nor caption', () => {
    // Arrange
    const output = JSON.stringify({ scenes: [{ shot: '', caption: '', durationSec: 5 }] });

    // Act
    const board = parseStoryboard(output);

    // Assert
    expect(board.scenes).toHaveLength(0);
  });

  it('returns an empty storyboard for malformed output', () => {
    // Arrange & Act
    const board = parseStoryboard('not json at all');

    // Assert
    expect(board).toEqual({ scenes: [] });
  });
});

describe('clampDuration', () => {
  it('passes through an in-range value', () => {
    expect(clampDuration(5)).toBe(5);
  });

  it('clamps values outside [1,60]', () => {
    expect(clampDuration(0)).toBe(1);
    expect(clampDuration(120)).toBe(60);
  });

  it('defaults non-numeric or non-finite values to 3', () => {
    expect(clampDuration('x')).toBe(3);
    expect(clampDuration(Number.NaN)).toBe(3);
    expect(clampDuration(Number.POSITIVE_INFINITY)).toBe(3);
  });
});

describe('prompt builders', () => {
  it('image prompt injects brand colors/fonts and asks for stringified JSON', () => {
    // Arrange & Act
    const prompt = buildImagePrompt({ item: ITEM, brand: BRAND });

    // Assert
    expect(prompt).toContain('STRINGIFIED JSON');
    expect(prompt).toContain('#0A0A0A');
    expect(prompt).toContain('Inter');
    expect(prompt).toContain('"imagePrompt"');
  });

  it('image prompt shows (none provided) for an empty brand kit', () => {
    // Arrange & Act
    const prompt = buildImagePrompt({
      item: ITEM,
      brand: { colors: [], fonts: [], designNotes: '' },
    });

    // Assert
    expect(prompt).toContain('(none provided)');
  });

  it('storyboard prompt names the format and requested JSON shape', () => {
    // Arrange & Act
    const prompt = buildStoryboardPrompt({ item: ITEM, brand: BRAND });

    // Assert
    expect(prompt).toContain('reel');
    expect(prompt).toContain('"scenes"');
    expect(prompt).toContain('durationSec');
  });

  it('storyboard prompt is grounded in the brand kit (colors/fonts/design notes)', () => {
    // Arrange & Act
    const prompt = buildStoryboardPrompt({ item: ITEM, brand: BRAND });

    // Assert
    expect(prompt).toContain('#0A0A0A');
    expect(prompt).toContain('Inter');
    expect(prompt).toContain('clean and minimal');
  });

  it('storyboard prompt shows (none provided) for an empty brand kit', () => {
    // Arrange & Act
    const prompt = buildStoryboardPrompt({
      item: ITEM,
      brand: { colors: [], fonts: [], designNotes: '' },
    });

    // Assert
    expect(prompt).toContain('(none provided)');
  });
});
