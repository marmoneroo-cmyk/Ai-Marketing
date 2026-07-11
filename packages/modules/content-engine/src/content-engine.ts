import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import {
  contentPlans,
  contentItems,
  contentVariants,
  contentApprovals,
  audienceSegments,
  insights,
  approvals,
  socialAccounts,
} from '@brandpilot/db';
import type { SocialProvider } from '@brandpilot/core';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { AgentRuntime } from '@brandpilot/agent-runtime';
import { VOICE_CONFORMANCE_THRESHOLD } from '@brandpilot/config';
import type {
  PublishPlatform,
  VariantResult,
  WeeklyPlanOptions,
  WeeklyPlanResult,
  WeeklyPlanWithVariantsResult,
} from './types';
import {
  applyFormatPreference,
  buildVariantPrompt,
  buildVoiceScorePrompt,
  buildWeeklyPlanPrompt,
  parseVariantCopy,
  parseVoiceScore,
  parseWeeklyPlan,
} from './content-generation';

const WEEK_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How many recent insights to feed back into planning. */
const RECENT_INSIGHT_LIMIT = 5;
/**
 * Upper bound on per-platform variants drafted in one autonomous run. Each is 2
 * LLM calls (draft + voice score); the per-org daily SpendGuard applies too.
 */
const MAX_VARIANTS_PER_RUN = 40;
/** Connected providers that map to a variant-capable publish platform. */
const VARIANT_PROVIDERS: ReadonlySet<SocialProvider> = new Set<SocialProvider>([
  'instagram',
  'facebook',
  'tiktok',
]);
/** Platforms used when an org has no connected, variant-capable accounts. */
const DEFAULT_PLATFORMS: readonly PublishPlatform[] = ['instagram', 'facebook'];

export interface ContentEngineDeps {
  db: Database;
  brain: BusinessBrain;
  runtime: AgentRuntime;
}

/**
 * Module 3 — the content factory. Turns the Business Brain's voice, offerings, and
 * audience into a weekly content strategy, then drafts brand-voice-conformant,
 * per-platform copy. Everything is org-scoped; low-conformance drafts are routed to
 * human approval instead of being auto-schedulable.
 */
export class ContentEngine {
  private readonly deps: ContentEngineDeps;

  constructor(deps: ContentEngineDeps) {
    this.deps = deps;
  }

  /**
   * Plan one week of content: strategy + planned items, persisted as a draft plan.
   * `options.formats`, when present, is injected into the prompt as a hard
   * preference AND deterministically enforced post-parse (see below); absent it
   * changes nothing from today's behavior (the model picks formats freely).
   */
  async generateWeeklyPlan(
    orgId: string,
    weekStart: Date,
    options?: WeeklyPlanOptions,
  ): Promise<WeeklyPlanResult> {
    const { db, brain, runtime } = this.deps;
    const periodStart = toDateString(weekStart);

    // Idempotency: a plan already covering this org+period must never be
    // regenerated — a retry, or an overlapping schedule/on-demand run, would
    // otherwise insert a duplicate plan (and, downstream, duplicate
    // LLM-drafted variants). Check BEFORE any grounding/LLM work so a repeat
    // call is cheap as well as safe.
    const existingPlan = await this.findExistingPlan(orgId, periodStart);
    if (existingPlan) {
      const existingItems = await db
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(eq(contentItems.planId, existingPlan.id));
      return { planId: existingPlan.id, itemCount: existingItems.length };
    }

    const [services, products, segments, personaRows, competitorRows, recentInsights] = await Promise.all([
      brain.facts.listServices(orgId),
      brain.facts.listProducts(orgId),
      db.select({ name: audienceSegments.name }).from(audienceSegments).where(eq(audienceSegments.orgId, orgId)),
      // Personas carry the audience's pains/goals — the richest planning signal.
      brain.facts.listPersonas(orgId),
      // Competitor intel synthesized at discovery — internal strategy input that
      // lets the plan differentiate. Kept out of the customer-facing grounding
      // pool (it is injected into this internal `weekly_plan` prompt only).
      brain.facts.listCompetitors(orgId),
      // Feedback loop: latest recommendations (optimization, customer-prep) AND
      // performance patterns (brand-intelligence) — brand-intelligence writes
      // `kind: 'pattern'`, so restricting to 'recommendation' silently dropped it.
      db
        .select({ title: insights.title })
        .from(insights)
        .where(and(eq(insights.orgId, orgId), inArray(insights.kind, ['recommendation', 'pattern'])))
        .orderBy(desc(insights.createdAt))
        .limit(RECENT_INSIGHT_LIMIT),
    ]);

    const serviceNames = services.map((s) => s.name).filter((n): n is string => typeof n === 'string');
    const segmentNames = segments.map((s) => s.name);
    // Compact persona briefs: "Name — pains: …; wants: …" (bounded), dropping empties.
    const personaBriefs = personaRows
      .map((p) => {
        const pains = (p.painPoints ?? []).slice(0, 3).join(', ');
        const goals = (p.goals ?? []).slice(0, 3).join(', ');
        const detail = [pains ? `pains: ${pains}` : '', goals ? `wants: ${goals}` : '']
          .filter((s) => s.length > 0)
          .join('; ');
        return detail ? `${p.name} — ${detail}` : p.name;
      })
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    // Compact "Name — positioning" briefs; drop competitors without a usable name.
    const competitorBriefs = competitorRows
      .map((c) => (c.positioning ? `${c.name} — ${c.positioning}` : c.name))
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

    const prompt = buildWeeklyPlanPrompt({
      services: serviceNames,
      products: products.map((p) => p.name).filter((n): n is string => typeof n === 'string'),
      segments: segmentNames,
      personas: personaBriefs,
      competitors: competitorBriefs,
      insights: recentInsights.map((i) => i.title),
      ...(options?.formats ? { formats: options.formats } : {}),
    });

    // Ground planning in the business profile + audience so pillars/briefs are
    // anchored to real, approved knowledge rather than the model's priors.
    const groundingQuery = [
      'Business profile, offerings, and audience for content planning',
      serviceNames.join(', '),
      segmentNames.join(', '),
    ]
      .filter((s) => s.length > 0)
      .join(' — ');

    const result = await runtime.run({
      orgId,
      actorId: 'content-engine',
      task: 'weekly_plan',
      prompt,
      groundingQuery,
    });
    const plan = parseWeeklyPlan(result.output);
    // Enforce the owner's format preference deterministically (see
    // applyFormatPreference); a no-op when options.formats is absent.
    const items = applyFormatPreference(plan.items, options?.formats);

    const [planRow] = await db
      .insert(contentPlans)
      .values({
        orgId,
        periodStart,
        periodEnd: toDateString(addDays(weekStart, WEEK_DAYS)),
        strategy: { pillars: plan.pillars },
        status: 'draft',
        createdBy: 'content-engine',
      })
      .returning();

    const planId = planRow?.id ?? '';

    // Batch-insert the week's items in a single round-trip. This was one INSERT
    // per item — an N+1 on a hot path (runs for every org's weekly plan, and the
    // on-demand path). No per-row id is needed here; callers re-query by planId.
    let itemCount = 0;
    if (items.length > 0) {
      await db.insert(contentItems).values(
        items.map((item) => ({
          orgId,
          ...(planId ? { planId } : {}),
          pillar: item.pillar || null,
          format: item.format,
          brief: item.brief || null,
          status: 'idea' as const,
        })),
      );
      itemCount = items.length;
    }

    await brain.recordSignal(orgId, {
      type: 'metric_snapshot',
      subjectType: 'content_plan',
      ...(planId ? { subjectId: planId } : {}),
      payload: { pillars: plan.pillars.length, items: itemCount },
    });

    return { planId, itemCount };
  }

  /**
   * Full autonomous weekly run: plan the week, then draft an approvable,
   * brand-voice-scored variant for every planned item × every connected platform.
   * Shared by the scheduled automation (`content.weekly_plan`) and the on-demand
   * content worker so BOTH produce identical output (previously only the worker
   * fanned out variants, so scheduled plans had none). Variant drafting is
   * best-effort + bounded by {@link MAX_VARIANTS_PER_RUN} (SpendGuard applies
   * underneath); a per-variant failure is counted and skipped, never thrown.
   */
  async generateWeeklyPlanWithVariants(
    orgId: string,
    weekStart: Date,
    options?: WeeklyPlanOptions,
  ): Promise<WeeklyPlanWithVariantsResult> {
    const { db } = this.deps;
    const periodStart = toDateString(weekStart);

    // Idempotency: if a plan already exists for this org+period, return its
    // existing plan + variants instead of fanning out a duplicate batch of
    // LLM-drafted variants on retry / schedule-overlap. generateWeeklyPlan
    // already guards the plan row itself, but without this check here too, a
    // pre-existing plan's items would still get a FRESH round of variants
    // drafted (and inserted) on every repeat call.
    const existingPlan = await this.findExistingPlan(orgId, periodStart);
    if (existingPlan) {
      const existingItems = await db
        .select({ id: contentItems.id })
        .from(contentItems)
        .where(eq(contentItems.planId, existingPlan.id));
      const itemIds = existingItems.map((i) => i.id);
      const existingVariants =
        itemIds.length > 0
          ? await db
              .select({ id: contentVariants.id })
              .from(contentVariants)
              .where(inArray(contentVariants.contentItemId, itemIds))
          : [];
      return {
        planId: existingPlan.id,
        itemCount: existingItems.length,
        variantCount: existingVariants.length,
        variantErrors: 0,
      };
    }

    const plan = await this.generateWeeklyPlan(orgId, weekStart, options);
    if (!plan.planId) {
      return { planId: plan.planId, itemCount: plan.itemCount, variantCount: 0, variantErrors: 0 };
    }

    const platforms = await this.resolveTargetPlatforms(orgId);
    const items = await db
      .select({ id: contentItems.id })
      .from(contentItems)
      .where(and(eq(contentItems.orgId, orgId), eq(contentItems.planId, plan.planId)));

    let variantCount = 0;
    let variantErrors = 0;
    for (const item of items) {
      for (const platform of platforms) {
        if (variantCount >= MAX_VARIANTS_PER_RUN) {
          return { planId: plan.planId, itemCount: plan.itemCount, variantCount, variantErrors };
        }
        try {
          await this.generateVariant(orgId, item.id, platform);
          variantCount++;
        } catch {
          // Best-effort: one bad draft (LLM error, spend cap, parse fail) must not
          // abort the batch. Counted so the caller can log/observe the failure rate.
          variantErrors++;
        }
      }
    }
    return { planId: plan.planId, itemCount: plan.itemCount, variantCount, variantErrors };
  }

  /**
   * Idempotency lookup: the existing plan (if any) already covering this
   * org+period. Shared by generateWeeklyPlan and generateWeeklyPlanWithVariants
   * so a retry or an overlapping schedule/on-demand run never drafts a
   * duplicate plan (or duplicate LLM-drafted variants).
   */
  private async findExistingPlan(orgId: string, periodStart: string): Promise<{ id: string } | undefined> {
    const [row] = await this.deps.db
      .select({ id: contentPlans.id })
      .from(contentPlans)
      .where(and(eq(contentPlans.orgId, orgId), eq(contentPlans.periodStart, periodStart)))
      .limit(1);
    return row;
  }

  /**
   * Resolve target platforms from the org's connected, variant-capable social
   * accounts (deduped). Falls back to {@link DEFAULT_PLATFORMS} when none qualify
   * so a plan always yields at least a baseline variant set.
   */
  private async resolveTargetPlatforms(orgId: string): Promise<PublishPlatform[]> {
    const accounts = await this.deps.db
      .select({ provider: socialAccounts.provider })
      .from(socialAccounts)
      .where(and(eq(socialAccounts.orgId, orgId), eq(socialAccounts.status, 'connected')));

    const platforms = new Set<PublishPlatform>();
    for (const { provider } of accounts) {
      if (VARIANT_PROVIDERS.has(provider)) platforms.add(provider as PublishPlatform);
    }
    return platforms.size > 0 ? [...platforms] : [...DEFAULT_PLATFORMS];
  }

  /** Draft brand-voice copy for one item on one platform; escalate if below threshold. */
  async generateVariant(orgId: string, contentItemId: string, platform: PublishPlatform): Promise<VariantResult> {
    const { db, brain, runtime } = this.deps;

    const [item] = await db
      .select()
      .from(contentItems)
      .where(and(eq(contentItems.id, contentItemId), eq(contentItems.orgId, orgId)))
      .limit(1);
    if (!item) throw new Error(`Content item ${contentItemId} not found`);

    const brief = item.brief ?? '';
    const pillar = item.pillar ?? '';
    const prompt = buildVariantPrompt({ platform, format: item.format, pillar, brief });

    // Always ground the draft. `caption` is customer-facing, so the runtime
    // now hard-requires a groundingQuery — fall back to the pillar/format when
    // there is no brief so grounding + escalation can never be skipped.
    const groundingQuery = brief || pillar || `on-brand ${item.format} content for ${platform}`;

    const result = await runtime.run({
      orgId,
      actorId: 'content-engine',
      task: 'caption',
      prompt,
      groundingQuery,
    });

    const copy = parseVariantCopy(result.output);
    const voiceScore = await this.scoreVoiceConformance(orgId, copy.caption || result.output);

    const [variant] = await db
      .insert(contentVariants)
      .values({
        orgId,
        contentItemId,
        platform,
        caption: copy.caption || null,
        hook: copy.hook || null,
        cta: copy.cta || null,
        hashtags: copy.hashtags,
        voiceScore: voiceScore.toFixed(3),
      })
      .returning();

    const variantId = variant?.id ?? '';
    const needsReview = voiceScore < VOICE_CONFORMANCE_THRESHOLD;

    if (needsReview) {
      const citations = result.citedChunkIds.length > 0 ? `Citations: ${result.citedChunkIds.join(', ')}.` : '';
      const rationale = result.rationale ? `Rationale: ${result.rationale}` : '';
      await db.insert(contentApprovals).values({
        orgId,
        contentItemId,
        decision: 'pending',
        notes: [
          `Voice conformance ${voiceScore.toFixed(3)} < ${VOICE_CONFORMANCE_THRESHOLD}; needs human review.`,
          citations,
          rationale,
        ]
          .filter((s) => s.length > 0)
          .join(' '),
      });

      // Dashboard approval carries the real confidence (voiceScore) + audit trail.
      await db.insert(approvals).values({
        orgId,
        kind: 'content',
        targetType: 'content_variant',
        targetId: variantId,
        requestedBy: 'content-engine',
        summary: [
          `Content variant for ${platform} needs voice review.`,
          citations,
          rationale,
        ]
          .filter((s) => s.length > 0)
          .join(' '),
        confidence: voiceScore.toFixed(3),
        status: 'pending',
      });
    }

    return { variantId, voiceScore, needsReview };
  }

  /**
   * Real brand-voice conformance measure: a dedicated cheap-tier scoring call
   * that rates how well a draft matches the brand's do/don't examples in [0,1].
   * Replaces the previous proxy that reused generation confidence as the score.
   */
  private async scoreVoiceConformance(orgId: string, draft: string): Promise<number> {
    if (!draft.trim()) return 0;
    const { brain, runtime } = this.deps;
    const voice = await brain.getVoiceProfile(orgId);
    const scorePrompt = buildVoiceScorePrompt({
      draft,
      voiceDo: voice?.doExamples ?? [],
      voiceDont: voice?.dontExamples ?? [],
    });
    const scoreResult = await runtime.run({
      orgId,
      actorId: 'content-engine',
      task: 'intent_classification',
      prompt: scorePrompt,
    });
    return parseVoiceScore(scoreResult.output);
  }
}

/** Add whole days to a date without mutating the input. */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Format a Date as a `YYYY-MM-DD` string for drizzle `date` columns. */
function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
