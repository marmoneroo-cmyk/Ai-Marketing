/** Public types for the Business Brain SDK. */

export type Permission = 'public' | 'granted' | 'restricted';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  content: string;
  /** Cosine similarity in [0,1]. */
  score: number;
  sourceKind: string;
  permission: Permission;
}

export interface RetrieveOptions {
  topK?: number;
  minScore?: number;
  /** Restrict retrieval to certain source kinds, e.g. ['faq', 'policy']. */
  sourceKinds?: string[];
}

export interface GroundedContext {
  chunks: RetrievedChunk[];
  /** Aggregate confidence in [0,1]; drives human-escalation decisions. */
  confidence: number;
}

export interface UpsertKnowledgeInput {
  sourceKind: string;
  externalRef?: string;
  permission?: Permission;
  title?: string;
  content: string;
  lang?: string;
}

export interface VoiceProfile {
  personality: Record<string, unknown>;
  tone: Record<string, unknown>;
  vocabulary: Record<string, unknown>;
  doExamples: string[];
  dontExamples: string[];
  confidence: number;
}

/** Injected text embedder — concrete Voyage adapter is wired in Phase 1. */
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

/** Layer 1 — the derived brand kit (colors, fonts, logo, notes) for an org. */
export interface BrandKit {
  colors: unknown[];
  fonts: unknown[];
  logoAssetId: string | null;
  designNotes: string | null;
}
