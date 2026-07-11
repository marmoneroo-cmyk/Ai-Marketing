import { describe, it, expect, vi } from 'vitest';
import { MIN_GROUNDING_CONFIDENCE } from '@brandpilot/config';
import { AppError } from '@brandpilot/core';
import type { SpendGuard, SpendKind } from '@brandpilot/core';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { GroundedContext, RetrievedChunk, VoiceProfile } from '@brandpilot/business-brain';
import { AgentRuntime } from './agent-runtime';
import type { AgentRunInput, LlmClient } from './types';

/**
 * Behavioral unit tests for AgentRuntime.run. Every dependency is a deterministic
 * in-memory fake — no network, no DB — so the tests exercise the real grounding,
 * escalation, guardrail, and cost-gate code paths in agent-runtime.ts.
 */

const ORG_ID = 'org_1';
const ACTOR_ID = 'actor_1';

/** A retrieved chunk with sane defaults; override only what a test cares about. */
function makeChunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: 'chunk_a',
    documentId: 'doc_a',
    content: 'We are open 9am to 5pm on weekdays.',
    score: 0.9,
    sourceKind: 'faq',
    permission: 'public',
    ...overrides,
  };
}

/** Minimal shape of the structured business-profile row used by these tests. */
interface FakeBusinessProfile {
  legalName?: string | null;
  description?: string | null;
  mission?: string | null;
  vision?: string | null;
  usp?: string | null;
  valueProps?: unknown;
  categories?: string[];
}

interface FakeBrainOptions {
  chunks?: RetrievedChunk[];
  confidence?: number;
  voice?: VoiceProfile | null;
  profile?: FakeBusinessProfile | null;
}

interface FakeBrain {
  brain: BusinessBrain;
  retrieve: ReturnType<typeof vi.fn>;
  getVoiceProfile: ReturnType<typeof vi.fn>;
  getBusinessProfile: ReturnType<typeof vi.fn>;
}

/**
 * Minimal fake BusinessBrain exposing only the three methods AgentRuntime.run
 * actually calls (`retrieve`, `getVoiceProfile`, `getBusinessProfile`), cast to
 * the real type so we bind to the true interface, not a hand-written shape.
 */
function makeFakeBrain(opts: FakeBrainOptions = {}): FakeBrain {
  const context: GroundedContext = {
    chunks: opts.chunks ?? [makeChunk()],
    confidence: opts.confidence ?? 0.9,
  };
  const retrieve = vi.fn(async (): Promise<GroundedContext> => context);
  const getVoiceProfile = vi.fn(async (): Promise<VoiceProfile | null> => opts.voice ?? null);
  const getBusinessProfile = vi.fn(async (): Promise<FakeBusinessProfile | null> => opts.profile ?? null);
  const brain = { retrieve, getVoiceProfile, getBusinessProfile } as unknown as BusinessBrain;
  return { brain, retrieve, getVoiceProfile, getBusinessProfile };
}

interface FakeLlm {
  llm: LlmClient;
  complete: ReturnType<typeof vi.fn>;
}

/**
 * Fake LlmClient returning canned text. NOTE: agent-runtime prefills the
 * assistant turn with `{` and parses `` `{${completion.text}` ``, so the canned
 * text must be the JSON body WITHOUT its leading `{`.
 */
function makeFakeLlm(bodyWithoutLeadingBrace: string, outputTokens = 42): FakeLlm {
  const complete = vi.fn(async () => ({
    text: bodyWithoutLeadingBrace,
    inputTokens: 10,
    outputTokens,
  }));
  const llm = { complete } as unknown as LlmClient;
  return { llm, complete };
}

/** A well-formed envelope body (leading `{` intentionally omitted). */
function envelope(output: string, rationale = 'because context supports it', confidence = 0.95): string {
  return `"rationale":${JSON.stringify(rationale)},"confidence":${confidence},"output":${JSON.stringify(output)}}`;
}

// Overrides may explicitly set an optional field to `undefined` to mean "omit it"
// (e.g. `groundingQuery: undefined`); the mapped type allows that even under
// exactOptionalPropertyTypes, and undefined keys are stripped below.
type InputOverrides = { [K in keyof AgentRunInput]?: AgentRunInput[K] | undefined };

function baseInput(overrides: InputOverrides = {}): AgentRunInput {
  const merged: Record<string, unknown> = {
    orgId: ORG_ID,
    actorId: ACTOR_ID,
    task: 'reply',
    prompt: 'A customer asks about opening hours.',
    groundingQuery: 'opening hours',
    ...overrides,
  };
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged as unknown as AgentRunInput;
}

describe('AgentRuntime.run', () => {
  it('throws grounding_insufficient when a customer-facing task has no groundingQuery', async () => {
    const { brain, retrieve } = makeFakeBrain();
    const { llm, complete } = makeFakeLlm(envelope('hello'));
    const runtime = new AgentRuntime({ brain, llm });

    const input = baseInput({ task: 'reply', groundingQuery: undefined });

    await expect(runtime.run(input)).rejects.toMatchObject({ code: 'grounding_insufficient' });
    await expect(runtime.run(input)).rejects.toBeInstanceOf(AppError);
    // Escalated before any retrieval or model call.
    expect(retrieve).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('hard-requires grounding for live-answer tasks (reply, objection) but lets caption draft without it', async () => {
    // Safety boundary split: reply/objection are DIRECT customer answers — they
    // must escalate when they cannot be grounded (fabricating hours/prices there
    // is real harm). caption is a PROACTIVE draft, guardrailed and human-reviewed
    // before publishing, so it drafts anyway — a thin knowledge base must never
    // leave the owner with zero content.
    for (const task of ['reply', 'objection'] as const) {
      const { brain } = makeFakeBrain();
      const { llm, complete } = makeFakeLlm(envelope('hi'));
      const runtime = new AgentRuntime({ brain, llm });

      await expect(
        runtime.run(baseInput({ task, groundingQuery: undefined })),
      ).rejects.toMatchObject({ code: 'grounding_insufficient' });
      expect(complete).not.toHaveBeenCalled();
    }

    // caption proceeds to draft even with no groundingQuery at all.
    const { brain } = makeFakeBrain();
    const { llm, complete } = makeFakeLlm(envelope('Fresh handcrafted dice, just dropped.'));
    const runtime = new AgentRuntime({ brain, llm });
    const result = await runtime.run(baseInput({ task: 'caption', groundingQuery: undefined }));
    expect(result.output).toBe('Fresh handcrafted dice, just dropped.');
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('throws grounding_insufficient for a live answer below MIN_GROUNDING_CONFIDENCE, but still drafts a caption', async () => {
    const lowConfidence = MIN_GROUNDING_CONFIDENCE - 0.1;

    // reply: a weakly-grounded live answer escalates before the model is called.
    {
      const { brain } = makeFakeBrain({ confidence: lowConfidence });
      const { llm, complete } = makeFakeLlm(envelope('hello'));
      const runtime = new AgentRuntime({ brain, llm });
      await expect(runtime.run(baseInput({ task: 'reply' }))).rejects.toMatchObject({
        code: 'grounding_insufficient',
      });
      expect(complete).not.toHaveBeenCalled();
    }

    // caption: the SAME weak grounding drafts anyway (this is the freshly-onboarded
    // org case — little indexed knowledge must still yield reviewable drafts).
    {
      const { brain } = makeFakeBrain({ confidence: lowConfidence });
      const { llm, complete } = makeFakeLlm(envelope('Weekend sale on handcrafted dice.'));
      const runtime = new AgentRuntime({ brain, llm });
      const result = await runtime.run(baseInput({ task: 'caption' }));
      expect(result.output).toBe('Weekend sale on handcrafted dice.');
      expect(complete).toHaveBeenCalledTimes(1);
    }
  });

  it('resolves with output, rationale, confidence and citedChunkIds on sufficient grounding + clean output', async () => {
    const chunks = [makeChunk({ id: 'chunk_a' }), makeChunk({ id: 'chunk_b', content: 'Returns within 30 days.' })];
    const { brain } = makeFakeBrain({ chunks, confidence: 0.9 });
    const { llm } = makeFakeLlm(envelope('We are open 9 to 5 on weekdays.', 'grounded in FAQ', 0.8));
    const runtime = new AgentRuntime({ brain, llm });

    const result = await runtime.run(baseInput({ task: 'reply' }));

    expect(result.output).toBe('We are open 9 to 5 on weekdays.');
    expect(result.rationale).toBe('grounded in FAQ');
    // confidence = min(parsed 0.8, grounding 0.9) = 0.8
    expect(result.confidence).toBe(0.8);
    expect(result.citedChunkIds).toEqual(['chunk_a', 'chunk_b']);
    expect(result.outputTokens).toBe(42);
    expect(typeof result.model).toBe('string');
    expect(result.model.length).toBeGreaterThan(0);
  });

  it('degrades a caption to an ungrounded draft when retrieval FAILS, but escalates a live answer', async () => {
    // reply: an embedding-provider outage/rate-limit during retrieval escalates.
    {
      const { brain, retrieve } = makeFakeBrain();
      retrieve.mockRejectedValueOnce(new Error('Voyage embeddings request failed (429)'));
      const { llm, complete } = makeFakeLlm(envelope('hello'));
      const runtime = new AgentRuntime({ brain, llm });
      await expect(runtime.run(baseInput({ task: 'reply' }))).rejects.toMatchObject({
        code: 'grounding_insufficient',
      });
      expect(complete).not.toHaveBeenCalled();
    }

    // caption: the SAME retrieval failure drafts anyway, ungrounded (no citations)
    // — this is the real-world case that was failing every variant on Voyage 429.
    {
      const { brain, retrieve } = makeFakeBrain();
      retrieve.mockRejectedValueOnce(new Error('Voyage embeddings request failed (429)'));
      const { llm, complete } = makeFakeLlm(envelope('Handcrafted dice, limited drop.'));
      const runtime = new AgentRuntime({ brain, llm });
      const result = await runtime.run(baseInput({ task: 'caption' }));
      expect(result.output).toBe('Handcrafted dice, limited drop.');
      expect(result.citedChunkIds).toEqual([]);
      expect(complete).toHaveBeenCalledTimes(1);
    }
  });

  it('throws grounding_insufficient when the output trips a guardrail (always-escalate intent)', async () => {
    const { brain } = makeFakeBrain({ confidence: 0.95 });
    // 'refund' is an ALWAYS_ESCALATE_INTENTS keyword → guardrail blocks it.
    const { llm, complete } = makeFakeLlm(envelope('Sure, I will process your refund immediately.'));
    const runtime = new AgentRuntime({ brain, llm });

    await expect(runtime.run(baseInput({ task: 'reply' }))).rejects.toMatchObject({
      code: 'grounding_insufficient',
    });
    // The model WAS called (guardrail runs on its output), unlike the pre-call gates.
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('consumes the spendGuard before calling llm.complete', async () => {
    const { brain } = makeFakeBrain({ confidence: 0.95 });
    const { llm, complete } = makeFakeLlm(envelope('We are open 9 to 5.'));

    const calls: string[] = [];
    const consume = vi.fn(async (_orgId: string, _kind: SpendKind, _units: number) => {
      calls.push('consume');
    });
    complete.mockImplementation(async () => {
      calls.push('complete');
      return { text: envelope('We are open 9 to 5.'), inputTokens: 10, outputTokens: 42 };
    });
    const spendGuard = { consume } as unknown as SpendGuard;

    const runtime = new AgentRuntime({ brain, llm, spendGuard });
    await runtime.run(baseInput({ task: 'reply' }));

    expect(consume).toHaveBeenCalledWith(ORG_ID, 'llm', 1);
    expect(calls).toEqual(['consume', 'complete']);
  });

  it('does not call llm.complete when the spendGuard throws (over-cap org)', async () => {
    const { brain } = makeFakeBrain({ confidence: 0.95 });
    const { llm, complete } = makeFakeLlm(envelope('We are open 9 to 5.'));

    const rateLimited = new AppError('rate_limited', 'over cap');
    const consume = vi.fn(async () => {
      throw rateLimited;
    });
    const spendGuard = { consume } as unknown as SpendGuard;

    const runtime = new AgentRuntime({ brain, llm, spendGuard });

    await expect(runtime.run(baseInput({ task: 'reply' }))).rejects.toBe(rateLimited);
    expect(complete).not.toHaveBeenCalled();
  });

  it('escalates (throws) on a malformed / non-JSON model response for a customer-facing task', async () => {
    const { brain } = makeFakeBrain({ confidence: 0.95 });
    // Even with the runtime's leading `{` prepended, this cannot parse as JSON.
    const { llm, complete } = makeFakeLlm('this is not json at all');
    const runtime = new AgentRuntime({ brain, llm });

    await expect(runtime.run(baseInput({ task: 'reply' }))).rejects.toMatchObject({
      code: 'grounding_insufficient',
    });
    // Confirms it reached the model and then escalated rather than returning a default 0.5.
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('runs a non-customer-facing task without a groundingQuery and does not throw', async () => {
    const { brain, retrieve, getVoiceProfile, getBusinessProfile } = makeFakeBrain();
    const { llm, complete } = makeFakeLlm(envelope('Focus Q3 spend on retargeting.', 'strategy rationale', 0.7));
    const runtime = new AgentRuntime({ brain, llm });

    const result = await runtime.run(
      baseInput({ task: 'strategy', prompt: 'Plan next quarter.', groundingQuery: undefined }),
    );

    expect(result.output).toBe('Focus Q3 spend on retargeting.');
    // No groundingQuery → no retrieval, grounding confidence defaults to 1, so
    // the result confidence is the raw parsed value.
    expect(retrieve).not.toHaveBeenCalled();
    expect(result.citedChunkIds).toEqual([]);
    expect(result.confidence).toBe(0.7);
    // Voice profile + business profile are always fetched; the model is always called.
    expect(getVoiceProfile).toHaveBeenCalledWith(ORG_ID);
    expect(getBusinessProfile).toHaveBeenCalledWith(ORG_ID);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('does not enforce guardrails or JSON-escalation for non-customer-facing tasks', async () => {
    const { brain } = makeFakeBrain();
    // Contains an escalate keyword AND is unparseable — a customer-facing task
    // would throw on either, but a summary must pass through.
    const { llm } = makeFakeLlm('refund refund not json');
    const runtime = new AgentRuntime({ brain, llm });

    const result = await runtime.run(
      baseInput({ task: 'summary', prompt: 'Summarize the week.', groundingQuery: undefined }),
    );

    // Fallback path: unparseable output falls back to the raw text, confidence 0.5.
    expect(result.confidence).toBe(0.5);
    expect(result.output).toContain('refund');
  });

  it('enforces the guardrail/escalation gate when customerFacing:true overrides an internal task', async () => {
    const { brain } = makeFakeBrain();
    // IDENTICAL output + task to the non-customer-facing case above (which passes
    // through), but customerFacing:true forces the customer-facing screen — so it
    // must now escalate (throw) instead of returning a 0.5-confidence fallback.
    // This is the sales-quote path: task 'strategy'/'summary' but sent to a buyer.
    const { llm } = makeFakeLlm('refund refund not json');
    const runtime = new AgentRuntime({ brain, llm });

    await expect(
      runtime.run(
        baseInput({
          task: 'summary',
          prompt: 'Summarize the week.',
          groundingQuery: 'pricing policy',
          customerFacing: true,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('AgentRuntime.run — system prompt (business profile + prompt-cache split)', () => {
  /** Pull the `system` argument the fake LlmClient.complete was called with. */
  function systemArgOf(complete: ReturnType<typeof vi.fn>): { stable: string; volatile: string } {
    const call = complete.mock.calls[0]?.[0] as { system: { stable: string; volatile: string } };
    return call.system;
  }

  it('folds the business profile into the STABLE block, grounding every module in the business identity', async () => {
    const { brain } = makeFakeBrain({
      profile: {
        legalName: 'Acme Salon',
        description: 'A neighborhood hair salon.',
        mission: 'Make everyone feel their best.',
        vision: 'The most-loved salon in town.',
        usp: 'Only stylists with 10+ years of experience.',
        valueProps: ['Free consultation', 'Eco-friendly products'],
        categories: ['beauty', 'salon'],
      },
    });
    const { llm, complete } = makeFakeLlm(envelope('hi'));
    const runtime = new AgentRuntime({ brain, llm });

    await runtime.run(baseInput({ task: 'reply' }));

    const system = systemArgOf(complete);
    expect(system.stable).toContain('Acme Salon');
    expect(system.stable).toContain('Make everyone feel their best.');
    expect(system.stable).toContain('The most-loved salon in town.');
    expect(system.stable).toContain('Only stylists with 10+ years of experience.');
    expect(system.stable).toContain('Free consultation');
    expect(system.stable).toContain('beauty');
    // The profile is STABLE — it must never leak into the per-query volatile block.
    expect(system.volatile).not.toContain('Acme Salon');
  });

  it('omits the business-profile section gracefully when no profile exists yet', async () => {
    const { brain } = makeFakeBrain({ profile: null });
    const { llm, complete } = makeFakeLlm(envelope('hi'));
    const runtime = new AgentRuntime({ brain, llm });

    await runtime.run(baseInput({ task: 'reply' }));

    const system = systemArgOf(complete);
    expect(system.stable).not.toContain('BUSINESS PROFILE');
  });

  it('omits the business-profile section gracefully when the profile row has no usable fields', async () => {
    const { brain } = makeFakeBrain({ profile: {} });
    const { llm, complete } = makeFakeLlm(envelope('hi'));
    const runtime = new AgentRuntime({ brain, llm });

    await runtime.run(baseInput({ task: 'reply' }));

    const system = systemArgOf(complete);
    expect(system.stable).not.toContain('BUSINESS PROFILE');
  });

  it('splits the system prompt into a stable prefix (persona+voice+profile) and a volatile per-query context block', async () => {
    const chunks = [makeChunk({ id: 'chunk_a', content: 'We are open 9 to 5 on weekdays.' })];
    const { brain } = makeFakeBrain({
      chunks,
      confidence: 0.9,
      voice: {
        personality: {},
        tone: {},
        vocabulary: {},
        doExamples: ['be warm'],
        dontExamples: ['no hype'],
        confidence: 0.8,
      },
      profile: { legalName: 'Acme Salon' },
    });
    const { llm, complete } = makeFakeLlm(envelope('hi'));
    const runtime = new AgentRuntime({ brain, llm });

    await runtime.run(baseInput({ task: 'reply', groundingQuery: 'opening hours' }));

    const system = systemArgOf(complete);
    // Stable carries the persona, brand voice, and business profile...
    expect(system.stable).toContain('You are BrandPilot');
    expect(system.stable).toContain('be warm');
    expect(system.stable).toContain('Acme Salon');
    // ...but never the per-query retrieved chunk text.
    expect(system.stable).not.toContain('We are open 9 to 5 on weekdays.');
    // Volatile carries ONLY the retrieved context, never persona/voice/profile.
    expect(system.volatile).toContain('We are open 9 to 5 on weekdays.');
    expect(system.volatile).not.toContain('You are BrandPilot');
    expect(system.volatile).not.toContain('be warm');
    expect(system.volatile).not.toContain('Acme Salon');
  });

  it('still sends a non-empty volatile block when there is no retrieved context', async () => {
    const { brain } = makeFakeBrain();
    const { llm, complete } = makeFakeLlm(envelope('hi'));
    const runtime = new AgentRuntime({ brain, llm });

    // Non-customer-facing task with no groundingQuery → no retrieval.
    await runtime.run(baseInput({ task: 'summary', groundingQuery: undefined }));

    const system = systemArgOf(complete);
    expect(system.volatile).toContain('(none provided)');
  });
});
