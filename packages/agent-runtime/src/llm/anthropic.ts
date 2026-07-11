import { resilientFetch, type RetryPolicy } from '@brandpilot/core';
import type { LlmClient, LlmMessage, SystemPrompt } from '../types';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

/**
 * Build the Anthropic `system` content-block array from the runtime's split
 * prompt. Anthropic caches everything up to the LAST `cache_control`
 * breakpoint, so the breakpoint goes ONLY on the stable block: a distinct
 * per-query `volatile` block (retrieved context) would otherwise bust the
 * cache on every call that retrieves different chunks. Returns `undefined`
 * when there is no system prompt at all, matching `fetch`'s expectations for
 * an omitted field.
 */
function buildSystemBlocks(system: SystemPrompt | undefined): AnthropicSystemBlock[] | undefined {
  if (!system) return undefined;
  const blocks: AnthropicSystemBlock[] = [];
  if (system.stable) {
    blocks.push({ type: 'text', text: system.stable, cache_control: { type: 'ephemeral' } });
  }
  if (system.volatile) {
    blocks.push({ type: 'text', text: system.volatile });
  }
  return blocks.length > 0 ? blocks : undefined;
}

/**
 * Claude Messages API adapter (fetch-based; no SDK version coupling).
 *
 * Transient-failure handling (per-attempt timeout + retry/backoff on
 * 429/529/5xx/network) is delegated to the shared `resilientFetch`, so a
 * rate-limit or overload blip retries instead of failing the whole agent task;
 * non-transient errors (4xx) fail fast. Pass a `Partial<RetryPolicy>` to override
 * (prod uses defaults; tests pass 0 backoff).
 */
export class AnthropicLlmClient implements LlmClient {
  private readonly apiKey: string;
  private readonly retry: Partial<RetryPolicy> | undefined;

  constructor(apiKey: string, retry?: Partial<RetryPolicy>) {
    this.apiKey = apiKey;
    this.retry = retry;
  }

  async complete(input: {
    model: string;
    system?: SystemPrompt;
    messages: LlmMessage[];
    maxTokens?: number;
  }): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const body = JSON.stringify({
      model: input.model,
      max_tokens: input.maxTokens ?? 1024,
      // Deterministic decoding for reliable, replayable JSON envelopes.
      temperature: 0,
      // Two content blocks: the STABLE prefix (persona/voice/business-profile/
      // rules) carries the cache_control breakpoint so Anthropic caches it
      // across calls — cheaper + lower latency on the shared prefix; the
      // VOLATILE per-query Business-Brain context carries none, so it can vary
      // on every call without invalidating that cached prefix. Prompt caching
      // is GA (no beta header).
      system: buildSystemBlocks(input.system),
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    });

    const res = await resilientFetch(
      ANTHROPIC_URL,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body,
      },
      this.retry,
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Anthropic request failed (${res.status}): ${errBody}`);
    }

    const json = (await res.json()) as AnthropicResponse;
    const text = json.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    return { text, inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens };
  }
}
