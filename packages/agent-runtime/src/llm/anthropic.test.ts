import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicLlmClient } from './anthropic';

function okResponse(text: string) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      content: [{ type: 'text', text }],
      usage: { input_tokens: 3, output_tokens: 5 },
    }),
    text: async () => '',
  };
}
function errResponse(status: number) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => ({}),
    text: async () => `error ${status}`,
  };
}

// Zero backoff so the delegation retry doesn't actually wait.
const FAST = { baseBackoffMs: 0, maxBackoffMs: 0, maxAttempts: 3, timeoutMs: 1000 };

describe('AnthropicLlmClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('parses text + token usage from a successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('hello'));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AnthropicLlmClient('k', FAST);
    const res = await client.complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });

    expect(res).toEqual({ text: 'hello', inputTokens: 3, outputTokens: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws with the HTTP status on a non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errResponse(400));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AnthropicLlmClient('k', FAST);
    await expect(client.complete({ model: 'm', messages: [] })).rejects.toThrow(/400/);
  });

  it('retries a transient failure via resilientFetch (delegation)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(errResponse(529))
      .mockResolvedValueOnce(okResponse('recovered'));
    vi.stubGlobal('fetch', fetchMock);

    const client = new AnthropicLlmClient('k', FAST);
    const res = await client.complete({ model: 'm', messages: [] });

    expect(res.text).toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe('system prompt cache split', () => {
    /** Parse the JSON body the fake fetch was called with. */
    function sentBody(fetchMock: ReturnType<typeof vi.fn>): { system?: unknown } {
      const init = fetchMock.mock.calls[0]?.[1] as { body: string };
      return JSON.parse(init.body) as { system?: unknown };
    }

    it('sends the stable block WITH a cache_control breakpoint and the volatile block WITHOUT one', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
      vi.stubGlobal('fetch', fetchMock);

      const client = new AnthropicLlmClient('k', FAST);
      await client.complete({
        model: 'm',
        system: { stable: 'STABLE PERSONA + VOICE + PROFILE', volatile: 'VOLATILE RETRIEVED CONTEXT' },
        messages: [{ role: 'user', content: 'hi' }],
      });

      const body = sentBody(fetchMock);
      expect(body.system).toEqual([
        { type: 'text', text: 'STABLE PERSONA + VOICE + PROFILE', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'VOLATILE RETRIEVED CONTEXT' },
      ]);
    });

    it('omits `system` entirely when no system prompt is given', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
      vi.stubGlobal('fetch', fetchMock);

      const client = new AnthropicLlmClient('k', FAST);
      await client.complete({ model: 'm', messages: [] });

      const body = sentBody(fetchMock);
      expect(body.system).toBeUndefined();
    });

    it('sends only the stable block when the volatile block is empty', async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse('ok'));
      vi.stubGlobal('fetch', fetchMock);

      const client = new AnthropicLlmClient('k', FAST);
      await client.complete({
        model: 'm',
        system: { stable: 'STABLE ONLY', volatile: '' },
        messages: [],
      });

      const body = sentBody(fetchMock);
      expect(body.system).toEqual([
        { type: 'text', text: 'STABLE ONLY', cache_control: { type: 'ephemeral' } },
      ]);
    });
  });
});
