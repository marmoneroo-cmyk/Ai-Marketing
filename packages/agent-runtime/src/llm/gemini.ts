import { resilientFetch, type RetryPolicy } from '@brandpilot/core';
import type { LlmClient, LlmMessage, SystemPrompt } from '../types';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }>; role?: string };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

/**
 * Map a tier model name to a Gemini model. The app configures Claude names (see
 * config/models.ts); this keeps that config provider-agnostic, so flipping
 * LLM_PROVIDER=gemini routes each tier to a matching free-tier Gemini model. A
 * name already prefixed `gemini` passes through unchanged.
 */
export function toGeminiModel(model: string): string {
  if (model.startsWith('gemini')) return model;
  const m = model.toLowerCase();
  // Cheap/fast classification tier -> flash-lite; reasoning + generation -> flash.
  if (m.includes('haiku')) return 'gemini-2.0-flash-lite';
  return 'gemini-2.0-flash';
}

/** Merge the split system prompt into a single Gemini systemInstruction. */
function buildSystemInstruction(
  system: SystemPrompt | undefined,
): { parts: Array<{ text: string }> } | undefined {
  if (!system) return undefined;
  const text = [system.stable, system.volatile].filter(Boolean).join('\n\n');
  return text ? { parts: [{ text }] } : undefined;
}

/**
 * Google Gemini adapter (fetch-based) implementing the SAME {@link LlmClient}
 * contract as {@link AnthropicLlmClient}, so the runtime switches providers via
 * the LLM_PROVIDER env with no other code change. Uses the free-tier
 * `generateContent` REST API. Transient failures (429/5xx/network) retry via the
 * shared `resilientFetch`; non-transient errors fail fast.
 *
 * Unlike Anthropic there is no per-call prompt-cache breakpoint, so the
 * stable+volatile prompt is concatenated into one `systemInstruction`.
 */
export class GeminiLlmClient implements LlmClient {
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
    const url = `${GEMINI_BASE}/${toGeminiModel(input.model)}:generateContent`;
    const systemInstruction = buildSystemInstruction(input.system);

    const body = JSON.stringify({
      ...(systemInstruction ? { systemInstruction } : {}),
      // Gemini roles are 'user' | 'model' (not 'assistant').
      contents: input.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      // Deterministic decoding for reliable, replayable JSON envelopes.
      generationConfig: { temperature: 0, maxOutputTokens: input.maxTokens ?? 1024 },
    });

    const res = await resilientFetch(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body,
      },
      this.retry,
    );

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini request failed (${res.status}): ${errBody}`);
    }

    const json = (await res.json()) as GeminiResponse;
    const candidate = json.candidates?.[0];
    if (!candidate) {
      // No candidate usually means the prompt was blocked by a safety filter.
      const reason = json.promptFeedback?.blockReason ?? 'no candidates returned';
      throw new Error(`Gemini returned no output (${reason})`);
    }
    const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('');
    return {
      text,
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
