import { afterEach, describe, expect, it, vi } from 'vitest';
import { resilientFetch } from './resilient-fetch';

function okResponse() {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}), text: async () => 'ok' };
}
function errResponse(status: number, retryAfter?: string) {
  return {
    ok: false,
    status,
    headers: {
      get: (h: string) => (h.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
    },
    json: async () => ({}),
    text: async () => `error ${status}`,
  };
}

// Zero backoff/cap so retries don't actually wait (retry-after is capped to 0 too).
const FAST = { baseBackoffMs: 0, maxBackoffMs: 0, maxAttempts: 3, timeoutMs: 1000 };

describe('resilientFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns the response on success (single call)', async () => {
    const f = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', f);
    const res = await resilientFetch('https://x', {}, FAST);
    expect(res.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('retries a transient 529 (overloaded) then returns the success response', async () => {
    const f = vi.fn().mockResolvedValueOnce(errResponse(529)).mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', f);
    const res = await resilientFetch('https://x', {}, FAST);
    expect(res.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('returns a non-retryable 400 immediately (fail fast, no retry)', async () => {
    const f = vi.fn().mockResolvedValue(errResponse(400));
    vi.stubGlobal('fetch', f);
    const res = await resilientFetch('https://x', {}, FAST);
    expect(res.status).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries on a persistent 500 and returns the last response', async () => {
    const f = vi.fn().mockResolvedValue(errResponse(500));
    vi.stubGlobal('fetch', f);
    const res = await resilientFetch('https://x', {}, FAST);
    expect(res.status).toBe(500);
    expect(f).toHaveBeenCalledTimes(3); // = maxAttempts
  });

  it('retries a network error then succeeds', async () => {
    const f = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', f);
    const res = await resilientFetch('https://x', {}, FAST);
    expect(res.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('throws when every attempt fails at the transport level', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ETIMEDOUT'));
    vi.stubGlobal('fetch', f);
    await expect(resilientFetch('https://x', {}, FAST)).rejects.toThrow(/ETIMEDOUT/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('honors a retry-after header (capped by maxBackoffMs) then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(errResponse(429, '2')).mockResolvedValueOnce(okResponse());
    vi.stubGlobal('fetch', f);
    const res = await resilientFetch('https://x', {}, FAST);
    expect(res.ok).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
