import type { RetryPolicy } from '@brandpilot/core';
import type { LlmClient } from '../types';
import { AnthropicLlmClient } from './anthropic';
import { GeminiLlmClient } from './gemini';

/** The LLM providers the runtime can be pointed at. */
export type LlmProvider = 'anthropic' | 'gemini';

/**
 * Build the LlmClient for the configured provider. Both concrete clients
 * implement the same {@link LlmClient} contract, so switching LLM_PROVIDER
 * (`anthropic` ⇄ `gemini`) is a pure env change with no other code impact:
 * `anthropic` for highest quality / production, `gemini` for the free tier
 * (dev / testing). Throws a clear error if the selected provider's key is
 * missing, so a misconfiguration fails fast at startup rather than mid-task.
 */
export function createLlmClient(opts: {
  provider: LlmProvider;
  anthropicApiKey?: string | undefined;
  geminiApiKey?: string | undefined;
  retry?: Partial<RetryPolicy> | undefined;
}): LlmClient {
  if (opts.provider === 'gemini') {
    if (!opts.geminiApiKey) {
      throw new Error('LLM_PROVIDER=gemini requires GEMINI_API_KEY to be set');
    }
    return new GeminiLlmClient(opts.geminiApiKey, opts.retry);
  }
  if (!opts.anthropicApiKey) {
    throw new Error('LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY to be set');
  }
  return new AnthropicLlmClient(opts.anthropicApiKey, opts.retry);
}
