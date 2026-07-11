import { EMBEDDING_MODEL } from '@brandpilot/config';
import { resilientFetch } from '@brandpilot/core';
import type { Embedder } from '../types';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';

interface VoyageResponse {
  data: Array<{ embedding: number[] }>;
}

/** Voyage AI text embedder (voyage-3, 1024 dims) backing the semantic memory. */
export class VoyageEmbedder implements Embedder {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string = EMBEDDING_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Embeddings gate every grounding/retrieval + knowledge upsert, so a transient
    // Voyage blip must retry (not fail the reply/discovery). Shared resilientFetch
    // adds per-attempt timeout + retry/backoff on 429/529/5xx/network.
    const res = await resilientFetch(VOYAGE_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage embeddings request failed (${res.status}): ${body}`);
    }

    const json = (await res.json()) as VoyageResponse;
    return json.data.map((d) => d.embedding);
  }
}
