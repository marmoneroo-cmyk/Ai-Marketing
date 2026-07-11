/**
 * Centralized model-routing policy. Every AI call goes through the Agent Runtime,
 * which picks a model by task tier — so cost/quality is tuned in ONE place.
 *
 *   classification → Haiku  (high-frequency, low-risk)
 *   generation     → Sonnet (everyday content & replies)
 *   reasoning      → Opus   (strategy, complex objections, optimization)
 */
export const MODELS = {
  reasoning: 'claude-opus-4-8',
  generation: 'claude-sonnet-5',
  classification: 'claude-haiku-4-5-20251001',
} as const;
export type ModelTier = keyof typeof MODELS;

export const EMBEDDING_MODEL = 'voyage-3' as const;
export const EMBEDDING_DIM = 1024 as const;

export type AgentTask =
  | 'intent_classification'
  | 'sentiment'
  | 'extraction'
  | 'triage'
  | 'caption'
  | 'reply'
  | 'briefing'
  | 'summary'
  | 'weekly_plan'
  | 'strategy'
  | 'monthly_plan'
  | 'objection'
  | 'optimization_analysis'
  | 'discovery_synthesis';

export const TASK_MODEL: Record<AgentTask, ModelTier> = {
  intent_classification: 'classification',
  sentiment: 'classification',
  extraction: 'classification',
  triage: 'classification',
  caption: 'generation',
  reply: 'generation',
  briefing: 'generation',
  summary: 'generation',
  weekly_plan: 'generation',
  strategy: 'reasoning',
  monthly_plan: 'reasoning',
  objection: 'reasoning',
  optimization_analysis: 'reasoning',
  discovery_synthesis: 'reasoning',
};

/** Resolve the concrete model id for a task. */
export function modelForTask(task: AgentTask): string {
  return MODELS[TASK_MODEL[task]];
}
