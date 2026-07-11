import { and, eq } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import { contentItems, creativeJobs, creativeAssets } from '@brandpilot/db';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { AgentRuntime } from '@brandpilot/agent-runtime';
import type { SpendGuard } from '@brandpilot/core';
import type {
  BrandColor,
  BrandKitContext,
  CreativeItemContext,
  CreativeKind,
  GenerateCreativeResult,
  RenderImage,
  Storyboard,
} from './types';
import {
  buildImagePrompt,
  buildStoryboardPrompt,
  parseImageSpec,
  parseStoryboard,
} from './creative-generation';

const ACTOR_ID = 'creative-studio';
const PROVIDER = 'fal';

export interface CreativeStudioDeps {
  db: Database;
  brain: BusinessBrain;
  runtime: AgentRuntime;
  /**
   * Injected media adapter that renders a prompt into stored image bytes. Optional:
   * when absent, jobs are persisted as `queued` for a later rendering pass.
   */
  renderImage?: RenderImage;
  /**
   * Optional per-org media spend meter. When present, one `media` unit is consumed
   * before each image render so fal.ai generations respect the org's daily media cap
   * — mirrors the runtime's per-call `llm` metering (image gen was previously uncapped).
   */
  spendGuard?: SpendGuard;
}

/**
 * Module 4 — the Creative Studio. Turns a planned content item plus the org's brand
 * kit into an on-brand image spec, then (when a media adapter is wired) renders and
 * stores the asset. Also drafts reel storyboards. Everything is org-scoped, and every
 * generation is journaled as a `creativeJobs` row for audit and later re-rendering.
 */
export class CreativeStudio {
  private readonly deps: CreativeStudioDeps;

  constructor(deps: CreativeStudioDeps) {
    this.deps = deps;
  }

  /**
   * Generate a still visual for one content item. Asks the model for a brand-aware
   * image prompt + alt text, journals a `creativeJobs` row, and — if a `renderImage`
   * adapter is injected — renders the image, stores a `creativeAssets` row, and marks
   * the job `done`. Without an adapter the job is left `queued` and only the job id is
   * returned.
   */
  async generateForContentItem(
    orgId: string,
    contentItemId: string,
    kind: CreativeKind,
  ): Promise<GenerateCreativeResult> {
    const { db, runtime, renderImage, spendGuard } = this.deps;

    const [item] = await db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, contentItemId), eq(contentItems.orgId, orgId)))
      .limit(1);
    if (!item) throw new Error(`Content item ${contentItemId} not found`);

    const brand = await this.loadBrandKit(orgId);
    const itemCtx: CreativeItemContext = {
      kind,
      format: item.format,
      pillar: item.pillar ?? '',
      brief: item.brief ?? '',
    };

    const prompt = buildImagePrompt({ item: itemCtx, brand });
    // Ground the image brief in the brand + item context (caption is a
    // customer-facing task, so the runtime requires a groundingQuery).
    const groundingQuery = [`Brand kit and visual guidelines for a ${item.format} ${kind}`, item.brief ?? '', item.pillar ?? '']
      .filter((s) => s.length > 0)
      .join(' — ');
    const result = await runtime.run({ orgId, actorId: ACTOR_ID, task: 'caption', prompt, groundingQuery });
    const spec = parseImageSpec(result.output);

    const [job] = await db
      .insert(creativeJobs)
      .values({
        orgId,
        contentItemId,
        kind,
        prompt: { imagePrompt: spec.imagePrompt, altText: spec.altText },
        provider: PROVIDER,
        status: 'queued',
      })
      .returning();

    const jobId = job?.id ?? '';

    if (!renderImage) {
      return { jobId };
    }

    // Meter the media budget before the (expensive) render — an over-cap org
    // throws here, before any fal.ai cost is incurred.
    if (spendGuard) await spendGuard.consume(orgId, 'media', 1);
    const rendered = await renderImage(spec.imagePrompt);
    const [asset] = await db
      .insert(creativeAssets)
      .values({
        orgId,
        ...(jobId ? { jobId } : {}),
        storageKey: rendered.storageKey,
        ...(typeof rendered.width === 'number' ? { width: rendered.width } : {}),
        ...(typeof rendered.height === 'number' ? { height: rendered.height } : {}),
        // Real brand-grounding confidence from the model run (how well the image
        // brief was grounded in the org's brand kit) — a computed proxy for brand
        // adherence, pending a true visual brand check, instead of a constant.
        brandCheck: brandCheckScore(result.confidence),
        // Persist the runtime's reason-before-act rationale + citations for audit.
        meta: {
          altText: spec.altText,
          rationale: result.rationale,
          citedChunkIds: result.citedChunkIds,
        },
      })
      .returning();

    if (jobId) {
      await db.update(creativeJobs).set({ status: 'done' }).where(eq(creativeJobs.id, jobId));
    }

    const assetId = asset?.id;
    return assetId ? { jobId, assetId } : { jobId };
  }

  /**
   * Draft a short-form reel storyboard for one content item. Journals a `creativeJobs`
   * row of kind `video` and returns the parsed scenes. The model output is parsed
   * defensively and never throws.
   */
  async generateReelStoryboard(orgId: string, contentItemId: string): Promise<Storyboard> {
    const { db, runtime } = this.deps;

    const [item] = await db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, contentItemId), eq(contentItems.orgId, orgId)))
      .limit(1);
    if (!item) throw new Error(`Content item ${contentItemId} not found`);

    // Mirror generateForContentItem: load the brand kit and ground the run so
    // reel storyboards respect brand colors/fonts/guidelines too, instead of
    // drafting scenes with zero brand awareness.
    const brand = await this.loadBrandKit(orgId);
    const itemCtx: CreativeItemContext = {
      kind: 'story',
      format: item.format,
      pillar: item.pillar ?? '',
      brief: item.brief ?? '',
    };

    const prompt = buildStoryboardPrompt({ item: itemCtx, brand });
    const groundingQuery = [`Brand kit and visual guidelines for a ${item.format} reel storyboard`, item.brief ?? '', item.pillar ?? '']
      .filter((s) => s.length > 0)
      .join(' — ');
    const result = await runtime.run({ orgId, actorId: ACTOR_ID, task: 'strategy', prompt, groundingQuery });
    const storyboard = parseStoryboard(result.output);

    await db.insert(creativeJobs).values({
      orgId,
      contentItemId,
      kind: 'video',
      prompt: { scenes: storyboard.scenes },
      provider: PROVIDER,
      status: 'queued',
    });

    return storyboard;
  }

  /** Read the org's brand kit via the Business Brain and normalize it for prompt use. */
  private async loadBrandKit(orgId: string): Promise<BrandKitContext> {
    const kit = await this.deps.brain.getBrandKit(orgId);
    if (!kit) return { colors: [], fonts: [], designNotes: '' };

    return {
      colors: normalizeColors(kit.colors),
      fonts: normalizeFonts(kit.fonts),
      designNotes: kit.designNotes ?? '',
    };
  }
}

/**
 * Format the model run's brand-grounding confidence (0..1) as the asset's
 * `brand_check` numeric. Non-finite values fall back to 0 so a bad run records a
 * low (honest) score rather than a fabricated one.
 */
function brandCheckScore(confidence: number): string {
  const c = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0;
  return c.toFixed(3);
}

/** Narrow the untyped `colors` jsonb ([{ hex, role }]) into typed swatches. */
function normalizeColors(value: unknown): BrandColor[] {
  if (!Array.isArray(value)) return [];
  const colors: BrandColor[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const hex = typeof record.hex === 'string' ? record.hex : '';
    if (!hex) continue;
    colors.push({ hex, role: typeof record.role === 'string' ? record.role : 'accent' });
  }
  return colors;
}

/** Narrow the untyped `fonts` jsonb into a list of font-family strings. */
function normalizeFonts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        if (typeof record.family === 'string') return record.family;
        if (typeof record.name === 'string') return record.name;
      }
      return '';
    })
    .filter((f): f is string => f.length > 0);
}
