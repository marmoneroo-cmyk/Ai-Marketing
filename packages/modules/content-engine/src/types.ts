import type { ContentFormat, PublishPlatform } from '@brandpilot/core';

/** A single planned content idea produced by the weekly-plan model call. */
export interface PlannedItem {
  format: ContentFormat;
  pillar: string;
  brief: string;
}

/** Structured weekly plan the model returns (parsed defensively; never throws). */
export interface WeeklyPlan {
  pillars: string[];
  items: PlannedItem[];
}

/** Structured per-platform copy the model returns for a single content item. */
export interface VariantCopy {
  caption: string;
  hook: string;
  cta: string;
  hashtags: string[];
}

/**
 * Minimal facts about the business fed into the weekly-plan prompt. Brand
 * voice is deliberately NOT part of this context — the shared AgentRuntime
 * already injects it into every call's system prompt (same source), so
 * carrying it here too would just duplicate tokens.
 */
export interface PlanContext {
  services: string[];
  products: string[];
  segments: string[];
  /** Persona summaries (pains + goals) so the plan targets the real audience. */
  personas?: string[];
  /** Recent optimization / brand recommendation titles fed back into planning. */
  insights?: string[];
  /** Competitor positioning summaries so the plan can differentiate (internal-only). */
  competitors?: string[];
  /** Owner-preferred content formats; when present, every planned item must use one. */
  formats?: ContentFormat[];
}

/** Optional per-run overrides for weekly planning. */
export interface WeeklyPlanOptions {
  /**
   * Owner-preferred content formats for this run; absent = model's choice
   * (today's behavior). When present, planned items are deterministically
   * coerced to one of these formats after parsing, defending against the
   * model ignoring the prompt instruction.
   */
  formats?: ContentFormat[];
}

export interface WeeklyPlanResult {
  planId: string;
  itemCount: number;
}

/** Result of a full autonomous run: the plan plus its fanned-out per-platform variants. */
export interface WeeklyPlanWithVariantsResult {
  planId: string;
  itemCount: number;
  variantCount: number;
  /** Per-variant drafting failures that were counted + skipped (never thrown). */
  variantErrors: number;
}

export interface VariantResult {
  variantId: string;
  voiceScore: number;
  needsReview: boolean;
}

export type { ContentFormat, PublishPlatform };
