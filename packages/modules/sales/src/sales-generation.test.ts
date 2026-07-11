import { describe, expect, it } from 'vitest';
import {
  buildProposalPrompt,
  buildQualifyPrompt,
  clampScore,
  computeTotals,
  parseProposalDraft,
  parseQualification,
  toMoneyString,
} from './sales-generation';

describe('parseQualification', () => {
  it('parses a well-formed stringified JSON judgement', () => {
    // Arrange
    const output = JSON.stringify({ score: 0.72, reasoning: 'strong intent' });

    // Act
    const result = parseQualification(output);

    // Assert
    expect(result.score).toBe(0.72);
    expect(result.reasoning).toBe('strong intent');
  });

  it('extracts JSON even when the model wraps it in prose', () => {
    // Arrange
    const output = 'Sure: {"score":0.4,"reasoning":"lukewarm"} done.';

    // Act
    const result = parseQualification(output);

    // Assert
    expect(result.score).toBe(0.4);
    expect(result.reasoning).toBe('lukewarm');
  });

  it('clamps an out-of-range score and defaults missing reasoning', () => {
    // Arrange
    const output = JSON.stringify({ score: 1.9 });

    // Act
    const result = parseQualification(output);

    // Assert
    expect(result.score).toBe(1);
    expect(result.reasoning).toBe('');
  });

  it('returns a zero judgement for non-JSON output', () => {
    // Arrange & Act
    const result = parseQualification('the model refused');

    // Assert
    expect(result).toEqual({ score: 0, reasoning: '' });
  });
});

describe('parseProposalDraft', () => {
  it('parses sections and line items', () => {
    // Arrange
    const output = JSON.stringify({
      sections: ['intro', 'scope'],
      lineItems: [{ name: 'Consult', qty: 2, unitPrice: 150 }],
    });

    // Act
    const draft = parseProposalDraft(output);

    // Assert
    expect(draft.sections).toEqual(['intro', 'scope']);
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems[0]?.unitPrice).toBe(150);
  });

  it('drops line items without a name and coerces bad numbers to 0', () => {
    // Arrange
    const output = JSON.stringify({
      sections: [],
      lineItems: [
        { name: '', qty: 1, unitPrice: 10 },
        { name: 'Setup', qty: 'x', unitPrice: -5 },
      ],
    });

    // Act
    const draft = parseProposalDraft(output);

    // Assert
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems[0]).toEqual({ name: 'Setup', qty: 0, unitPrice: 0 });
  });

  it('returns an empty draft for malformed output', () => {
    // Arrange & Act
    const draft = parseProposalDraft('not json');

    // Assert
    expect(draft).toEqual({ sections: [], lineItems: [] });
  });
});

describe('computeTotals', () => {
  it('sums quantity times unit price across line items', () => {
    // Arrange
    const lineItems = [
      { name: 'A', qty: 2, unitPrice: 100 },
      { name: 'B', qty: 1, unitPrice: 50 },
    ];

    // Act
    const totals = computeTotals(lineItems);

    // Assert
    expect(totals.subtotal).toBe(250);
    expect(totals.total).toBe(250);
  });

  it('returns zero totals for no line items', () => {
    expect(computeTotals([])).toEqual({ subtotal: 0, total: 0 });
  });
});

describe('toMoneyString', () => {
  it('formats to two decimal places', () => {
    expect(toMoneyString(250)).toBe('250.00');
    expect(toMoneyString(19.5)).toBe('19.50');
  });

  it('coerces negatives and non-finite to 0.00', () => {
    expect(toMoneyString(-5)).toBe('0.00');
    expect(toMoneyString(Number.NaN)).toBe('0.00');
  });
});

describe('clampScore', () => {
  it('passes through an in-range value', () => {
    expect(clampScore(0.6)).toBe(0.6);
  });

  it('clamps values outside [0,1] and non-finite', () => {
    expect(clampScore(2)).toBe(1);
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(Number.NaN)).toBe(0);
  });
});

describe('prompt builders', () => {
  it('qualify prompt asks for stringified JSON and includes provided context', () => {
    // Arrange & Act
    const prompt = buildQualifyPrompt({
      name: 'Acme',
      email: 'a@acme.io',
      source: 'form',
      status: 'new',
      notes: 'wants a demo',
    });

    // Assert
    expect(prompt).toContain('STRINGIFIED JSON');
    expect(prompt).toContain('Acme');
    expect(prompt).toContain('wants a demo');
  });

  it('qualify prompt grounds lead fit in ICP personas and the offering catalogue when provided', () => {
    // Arrange & Act
    const prompt = buildQualifyPrompt({
      name: 'Acme',
      email: 'a@acme.io',
      source: 'form',
      status: 'new',
      notes: '',
      personas: ['Busy Parent — pains: no time; wants: quick service'],
      services: ['Haircut'],
      products: ['Shampoo'],
    });

    // Assert
    expect(prompt).toContain('IDEAL CUSTOMER PERSONAS');
    expect(prompt).toContain('Busy Parent');
    expect(prompt).toContain('SERVICES OFFERED');
    expect(prompt).toContain('Haircut');
    expect(prompt).toContain('PRODUCTS OFFERED');
    expect(prompt).toContain('Shampoo');
  });

  it('qualify prompt omits ICP/offering sections when none are provided (today\'s behavior)', () => {
    // Arrange & Act
    const prompt = buildQualifyPrompt({
      name: 'Acme',
      email: 'a@acme.io',
      source: 'form',
      status: 'new',
      notes: '',
    });

    // Assert
    expect(prompt).not.toContain('IDEAL CUSTOMER PERSONAS');
    expect(prompt).not.toContain('SERVICES OFFERED');
    expect(prompt).not.toContain('PRODUCTS OFFERED');
  });

  it('proposal prompt lists offerings and requests the JSON shape', () => {
    // Arrange & Act
    const prompt = buildProposalPrompt({ services: ['audit'], products: [], offers: ['launch deal'] });

    // Assert
    expect(prompt).toContain('audit');
    expect(prompt).toContain('launch deal');
    expect(prompt).toContain('(none provided)'); // empty products list
    expect(prompt).toContain('"lineItems"');
  });
});
