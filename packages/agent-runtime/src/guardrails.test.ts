import { describe, it, expect } from 'vitest';
import { checkGuardrails } from './guardrails';

describe('checkGuardrails', () => {
  it('allows benign text', () => {
    expect(checkGuardrails({ text: 'What are your opening hours?' }).allowed).toBe(true);
  });

  it('escalates on a refund intent', () => {
    const r = checkGuardrails({ text: 'I demand a refund right now' });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('refund');
  });

  it('blocks a configured banned topic', () => {
    const r = checkGuardrails({ text: 'let me tell you about CompetitorX', bannedTopics: ['competitorx'] });
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('banned');
  });
});
