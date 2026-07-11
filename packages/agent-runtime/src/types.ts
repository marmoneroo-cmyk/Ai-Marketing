import type { AgentTask } from '@brandpilot/config';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Two-part system prompt handed to the LLM client. `stable` is the cacheable
 * prefix (persona, business profile, brand voice, rules) — identical across
 * calls for an org until its underlying facts change. `volatile` is the
 * per-query retrieved Business Brain context, which varies on every call.
 * Keeping them separate lets the client place the prompt-cache breakpoint
 * after `stable` only, so a new retrieval never busts the cached prefix.
 */
export interface SystemPrompt {
  stable: string;
  volatile: string;
}

/** Injected LLM client — concrete Anthropic adapter is wired in Phase 1. */
export interface LlmClient {
  complete(input: {
    model: string;
    system?: SystemPrompt;
    messages: LlmMessage[];
    maxTokens?: number;
  }): Promise<{ text: string; inputTokens: number; outputTokens: number }>;
}

export interface AgentRunInput {
  orgId: string;
  actorId: string;
  task: AgentTask;
  prompt: string;
  /** If set, retrieve grounding from the Business Brain before generating. */
  groundingQuery?: string;
  /**
   * Force customer-facing treatment (grounding + guardrail screen + confidence
   * escalation) regardless of `task`. Use for output shown to customers on an
   * otherwise-internal task type — e.g. sales quotes/proposals run as `strategy`
   * but are sent to the buyer. Defaults to the task-based classification.
   */
  customerFacing?: boolean;
}

export interface AgentRunResult {
  output: string;
  /** The logged reason-before-act rationale. */
  rationale: string;
  /** Confidence in [0,1]; low values force escalation for customer-facing tasks. */
  confidence: number;
  /** Business Brain chunk ids used to ground the answer (for audit). */
  citedChunkIds: string[];
  model: string;
  outputTokens: number;
}
