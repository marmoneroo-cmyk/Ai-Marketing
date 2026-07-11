import { describe, expect, it, vi, afterEach } from 'vitest';
import { GeminiLlmClient, toGeminiModel } from './gemini';
import { AnthropicLlmClient } from './anthropic';
import { createLlmClient } from './factory';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('toGeminiModel', () => {
  it('maps Claude tiers to Gemini models; passes gemini names through', () => {
    expect(toGeminiModel('claude-haiku-4-5-20251001')).toBe('gemini-2.5-flash-lite');
    expect(toGeminiModel('claude-sonnet-5')).toBe('gemini-2.5-flash');
    expect(toGeminiModel('claude-opus-4-8')).toBe('gemini-2.5-flash');
    expect(toGeminiModel('gemini-1.5-pro')).toBe('gemini-1.5-pro');
  });
});

describe('GeminiLlmClient.complete', () => {
  it('builds a correct request and parses the response', async () => {
    let captured: { url: string; init?: RequestInit | undefined } | null = null;
    global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      captured = { url: String(url), init };
      return jsonResponse({
        candidates: [
          {
            content: { parts: [{ text: 'hello ' }, { text: 'world' }], role: 'model' },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 42, candidatesTokenCount: 7 },
      });
    }) as unknown as typeof fetch;

    const client = new GeminiLlmClient('gk-test');
    const out = await client.complete({
      model: 'claude-sonnet-5',
      system: { stable: 'PERSONA', volatile: 'CONTEXT' },
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'prev' },
      ],
      maxTokens: 256,
    });

    expect(out).toEqual({ text: 'hello world', inputTokens: 42, outputTokens: 7 });

    const cap = captured as unknown as { url: string; init?: RequestInit };
    // URL uses the mapped model; key rides a header, never the URL.
    expect(cap.url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(cap.url).not.toContain('gk-test');
    const headers = cap.init?.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('gk-test');

    const sent = JSON.parse(String(cap.init?.body));
    // System prompt merged into one instruction; roles mapped (assistant->model).
    expect(sent.systemInstruction.parts[0].text).toContain('PERSONA');
    expect(sent.systemInstruction.parts[0].text).toContain('CONTEXT');
    expect(sent.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'prev' }] },
    ]);
    expect(sent.generationConfig).toEqual({ temperature: 0, maxOutputTokens: 256 });
  });

  it('throws when the prompt is blocked (no candidates)', async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }),
    ) as unknown as typeof fetch;
    const client = new GeminiLlmClient('gk-test');
    await expect(
      client.complete({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/no output.*SAFETY/i);
  });
});

describe('createLlmClient', () => {
  it('returns a Gemini client when provider=gemini', () => {
    expect(createLlmClient({ provider: 'gemini', geminiApiKey: 'gk' })).toBeInstanceOf(
      GeminiLlmClient,
    );
  });
  it('returns an Anthropic client when provider=anthropic', () => {
    expect(createLlmClient({ provider: 'anthropic', anthropicApiKey: 'sk' })).toBeInstanceOf(
      AnthropicLlmClient,
    );
  });
  it('throws when the selected provider has no key', () => {
    expect(() => createLlmClient({ provider: 'gemini' })).toThrow(/GEMINI_API_KEY/);
    expect(() => createLlmClient({ provider: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
