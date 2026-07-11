import { loadEnv } from '@brandpilot/config';
import { AppError } from '@brandpilot/core';

/**
 * fal.ai text-to-image adapter. Renders a prompt into a hosted image and returns
 * its URL as the `storageKey` (fal serves the result from its CDN). Matches the
 * `RenderImage` signature injected into Creative Studio:
 *   (prompt: string) => Promise<{ storageKey: string; width?: number; height?: number }>
 *
 * Uses the synchronous `fal.run` endpoint (FLUX.1 [schnell], a fast text-to-image
 * model) so a single request returns the finished image.
 *
 * @see https://fal.ai/models/fal-ai/flux/schnell/api
 */

const FAL_MODEL_URL = 'https://fal.run/fal-ai/flux/schnell';

/** Result of a render: the image URL plus its pixel dimensions when returned. */
export interface RenderImageResult {
  storageKey: string;
  width?: number;
  height?: number;
}

/** Shape of the subset of the fal.ai response we consume. */
interface FalImage {
  url?: string;
  width?: number;
  height?: number;
}

interface FalRunResponse {
  images?: FalImage[];
  error?: string;
  detail?: unknown;
}

/**
 * Render `prompt` into a hosted image via fal.ai and return its URL + size.
 * Throws {@link AppError} `bad_request` when `FAL_KEY` is missing, the remote
 * call fails, the response is non-2xx, or no image URL is returned.
 */
export async function renderImage(prompt: string): Promise<RenderImageResult> {
  const apiKey = loadEnv().FAL_KEY;
  if (!apiKey) {
    throw new AppError('bad_request', 'FAL_KEY is not configured; cannot render images');
  }

  let response: Response;
  try {
    response = await fetch(FAL_MODEL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown network error';
    throw new AppError('bad_request', `fal.ai request failed: ${message}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AppError('bad_request', `fal.ai returned ${response.status}: ${body.slice(0, 500)}`);
  }

  const json = (await response.json().catch(() => ({}))) as FalRunResponse;
  const image = json.images?.[0];
  if (!image?.url) {
    throw new AppError('bad_request', 'fal.ai returned no image URL');
  }

  return {
    storageKey: image.url,
    ...(typeof image.width === 'number' ? { width: image.width } : {}),
    ...(typeof image.height === 'number' ? { height: image.height } : {}),
  };
}
