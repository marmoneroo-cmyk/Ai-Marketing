import { Body, Controller, Get, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  contentApprovals,
  contentItems,
  contentVariants,
  creativeAssets,
  creativeJobs,
  scheduledPosts,
  socialAccounts,
  withOrgScope,
  type Database,
} from '@brandpilot/db';
import {
  AppError,
  CONTENT_FORMATS,
  ok,
  paginationSchema,
  SOCIAL_PROVIDERS,
  type ApiResponse,
  type ContentPlanJobData,
  type Paginated,
  type PublishPlatform,
  type SocialProvider,
} from '@brandpilot/core';
import { DATABASE } from '../db/db.provider';
import { CONTENT_PLAN_QUEUE } from '../queue/queue.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentOrg } from '../auth/current-org.decorator';
import { zodSchemaClass } from '../common/zod-validation.pipe';
import {
  confidenceToPercent,
  toWebContentStatus,
  toWebPlatform,
  type WebContentStatus,
  type WebPlatform,
} from '../dashboard/read-model.mappers';

const contentPlanSchema = z.object({
  weekStartIso: z.string().datetime().optional(),
  /** Owner-preferred content formats; omitted lets the model choose. */
  formats: z.array(z.enum(CONTENT_FORMATS)).min(1).max(CONTENT_FORMATS.length).optional(),
});

class ContentPlanBody extends zodSchemaClass(contentPlanSchema) {}

const scheduleVariantSchema = z.object({
  /** When the post should publish, as an ISO-8601 timestamp. */
  scheduledFor: z.string().datetime(),
  /** Optional explicit target account; otherwise resolved from the variant platform. */
  socialAccountId: z.string().uuid().optional(),
});

class ScheduleVariantBody extends zodSchemaClass(scheduleVariantSchema) {}

const updateVariantSchema = z.object({
  /** The edited caption. Capped generously above every platform's limit. */
  caption: z.string().max(5000),
  /** Optional edited hashtags (without leading `#`), replacing the set. */
  hashtags: z.array(z.string().min(1).max(100)).max(30).optional(),
});

class UpdateVariantBody extends zodSchemaClass(updateVariantSchema) {}

/** `?page&limit` query for the paginated content list (page 1, limit 20, max 100). */
class ListContentQuery extends zodSchemaClass(paginationSchema) {}

/**
 * A variant's `platform` (PublishPlatform) and an account's `provider`
 * (SocialProvider) share most string values, but a few differ. Map the ones
 * that do so auto-resolution can find the right connected account; anything
 * not listed matches its provider by identical string.
 */
const PROVIDER_BY_PLATFORM: Partial<Record<PublishPlatform, SocialProvider>> = {
  gbp: 'google_business',
};

/** The connected-account provider that can publish a given variant platform. */
function providerForPlatform(platform: PublishPlatform): SocialProvider | null {
  const mapped = PROVIDER_BY_PLATFORM[platform];
  if (mapped) return mapped;
  return (SOCIAL_PROVIDERS as readonly string[]).includes(platform)
    ? (platform as SocialProvider)
    : null;
}

/** A single per-platform AI-generated variant, mapped for the web review UI. */
interface ContentVariantView {
  id: string;
  platform: WebPlatform;
  caption: string;
  hook: string;
  cta: string;
  hashtags: string[];
  /** Brand-voice conformance, 0..100 integer (stored 0..1 in the DB). */
  voiceScore: number;
  status: WebContentStatus;
}

/** A generated visual (image/video) for a content item — mirrors the web's `ContentMedia`. */
interface ContentMediaView {
  /** Loadable URL. The fal.ai connector returns its hosted CDN image URL AS the asset's `storageKey`, so this is served directly — no separate storage/serving endpoint. */
  url: string;
  kind: 'image' | 'video';
  /** Screen-reader description of the generated visual. */
  alt: string;
  /** Aspect-ratio hint for layout. */
  aspect: 'portrait' | 'square' | 'landscape';
}

interface ContentItemView {
  id: string;
  title: string;
  platform: WebPlatform;
  /** The AI-chosen content format, e.g. post/carousel/reel. */
  format: string;
  status: WebContentStatus;
  scheduledFor: string;
  caption: string;
  /**
   * The related `content_approvals` row id for this item, if one exists. The web
   * uses it to approve/reject the item's variants. Null when no approval row
   * has been created yet.
   */
  approvalId: string | null;
  /** This item's most recent generated visual (image/video), when one exists. */
  media?: ContentMediaView;
  /** Per-platform variants for this item (empty when none generated yet). */
  variants: ContentVariantView[];
}

/** Row shape returned by the creative-asset join query (creativeAssets ⋈ creativeJobs). */
interface MediaAssetRow {
  contentItemId: string | null;
  jobKind: (typeof creativeJobs.$inferSelect)['kind'];
  /** The job's `prompt` jsonb — may carry a model-authored `altText`/`alt`. */
  jobPrompt: unknown;
  storageKey: string;
  mime: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** The asset's `meta` jsonb — may carry a model-authored `altText`/`alt`. */
  assetMeta: unknown;
}

/** Narrow a jsonb blob (job `prompt` / asset `meta`) for a non-empty string `altText`/`alt`. */
function jsonAltText(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const alt = record.altText ?? record.alt;
  return typeof alt === 'string' && alt.trim().length > 0 ? alt : null;
}

/**
 * Map a joined creative-asset+job row into the web's `ContentMedia` shape.
 * `kind` trusts the job's declared kind first, then falls back to asset hints
 * (a recorded duration, or a video mime type) for safety. `alt` prefers text
 * the model already authored (on the asset's `meta` or the job's `prompt`)
 * over a generic fallback so screen readers get a real description whenever
 * one was generated.
 */
function toMediaView(row: MediaAssetRow, title: string): ContentMediaView {
  const isVideo =
    row.jobKind === 'video' || row.durationMs != null || (row.mime?.startsWith('video/') ?? false);
  const aspect: ContentMediaView['aspect'] =
    row.width && row.height
      ? row.height > row.width
        ? 'portrait'
        : row.width > row.height
          ? 'landscape'
          : 'square'
      : 'square';
  const alt =
    jsonAltText(row.assetMeta) ?? jsonAltText(row.jobPrompt) ?? `Generated ${row.jobKind} for “${title}”`;

  return { url: row.storageKey, kind: isVideo ? 'video' : 'image', alt, aspect };
}

/**
 * Content endpoints. The GET read-model returns a page of content items, each with
 * its per-platform `variants` (caption/hook/cta/hashtags/voiceScore/status), the
 * related `content_approvals` row id, and its most recent generated `media`
 * (image/video) when a Creative Studio job has produced one, mapped into the
 * web's `ContentItem` shape (apps/web/src/lib/types.ts); `POST /content/plan`
 * enqueues an on-demand weekly content-generation job (the worker runs the
 * Content Engine). Org-scoped; the read never throws on empty data (empty
 * arrays / null approvalId / undefined media).
 */
@ApiTags('content')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('content')
export class ContentController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CONTENT_PLAN_QUEUE) private readonly contentPlanQueue: Queue<ContentPlanJobData>,
  ) {}

  @Post('plan')
  @RequirePermissions('content:create')
  @ApiOperation({ summary: "Generate this week's content (asynchronous)" })
  async plan(
    @CurrentOrg() orgId: string,
    @Body() body: ContentPlanBody,
  ): Promise<ApiResponse<{ jobId: string }>> {
    const data: ContentPlanJobData = {
      orgId,
      ...(body.weekStartIso ? { weekStartIso: body.weekStartIso } : {}),
      ...(body.formats ? { formats: body.formats } : {}),
    };
    const job = await this.contentPlanQueue.add('plan', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    return ok({ jobId: job.id ?? '' });
  }

  @Post('variants/:variantId/schedule')
  @RequirePermissions('content:publish')
  @ApiOperation({ summary: 'Schedule an approved variant for auto-publishing' })
  async scheduleVariant(
    @CurrentOrg() orgId: string,
    @Param('variantId') variantId: string,
    @Body() body: ScheduleVariantBody,
  ): Promise<ApiResponse<{ scheduledPostId: string }>> {
    // Load the variant, resolve a target account, and insert the scheduled post
    // in one org-scoped transaction so RLS is active throughout. The owner is
    // explicitly scheduling, so the post is pre-approved; the worker's
    // publish-tick will dispatch it when due.
    const scheduledPostId = await withOrgScope(this.db, orgId, async (tx) => {
      const variant = await tx.query.contentVariants.findFirst({
        where: and(eq(contentVariants.id, variantId), eq(contentVariants.orgId, orgId)),
        columns: { id: true, platform: true },
      });
      if (!variant) {
        throw new AppError('not_found', 'Variant not found');
      }

      const socialAccountId = await this.resolveSocialAccountId(
        tx,
        orgId,
        variant.platform,
        body.socialAccountId,
      );

      const [row] = await tx
        .insert(scheduledPosts)
        .values({
          orgId,
          contentVariantId: variantId,
          socialAccountId,
          scheduledFor: new Date(body.scheduledFor),
          status: 'scheduled',
          approvalRequired: false,
          approvedAt: new Date(),
        })
        .returning({ id: scheduledPosts.id });

      if (!row) {
        throw new AppError('internal_error', 'Failed to schedule the post');
      }
      return row.id;
    });

    return ok({ scheduledPostId });
  }

  @Patch('variants/:variantId')
  @RequirePermissions('content:create')
  @ApiOperation({ summary: 'Edit an AI-generated variant (caption / hashtags) before scheduling' })
  async updateVariant(
    @CurrentOrg() orgId: string,
    @Param('variantId') variantId: string,
    @Body() body: UpdateVariantBody,
  ): Promise<ApiResponse<{ id: string; caption: string; hashtags: string[] }>> {
    // The publish worker reads the variant's caption/hashtags at publish time, so
    // editing here cleanly updates what actually goes out (for any not-yet-published
    // variant). Org-scoped update; a missing/other-org id yields no row → 404.
    const updated = await withOrgScope(this.db, orgId, async (tx) => {
      const [row] = await tx
        .update(contentVariants)
        .set({
          caption: body.caption,
          ...(body.hashtags !== undefined ? { hashtags: body.hashtags } : {}),
        })
        .where(and(eq(contentVariants.id, variantId), eq(contentVariants.orgId, orgId)))
        .returning({
          id: contentVariants.id,
          caption: contentVariants.caption,
          hashtags: contentVariants.hashtags,
        });
      return row;
    });
    if (!updated) {
      throw new AppError('not_found', 'Variant not found');
    }
    return ok({ id: updated.id, caption: updated.caption ?? '', hashtags: updated.hashtags ?? [] });
  }

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ summary: 'List recent content items (with per-platform variants)' })
  async list(
    @CurrentOrg() orgId: string,
    @Query() query: ListContentQuery,
  ): Promise<ApiResponse<Paginated<ContentItemView>>> {
    const { page, limit } = query;
    // Read a page of items, their variants, the latest approval row, each
    // item's best generated media asset, and the org-scoped total in one
    // transaction so RLS is active throughout. Item rows/variants/approvals/
    // media are fetched separately (rather than a single multiplying join) so
    // building nested `variants` stays simple and each item carries every
    // variant, not just the first. Never throws: missing variants/approvals/
    // media yield empty arrays / null / undefined, and an empty org yields
    // `items: []` with `total: 0`.
    const { items, variants, approvals, media, total } = await withOrgScope(this.db, orgId, async (tx) => {
      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(contentItems)
        .where(eq(contentItems.orgId, orgId));

      const itemRows = await tx
        .select({
          id: contentItems.id,
          format: contentItems.format,
          brief: contentItems.brief,
          pillar: contentItems.pillar,
          status: contentItems.status,
          scheduledFor: contentItems.scheduledFor,
          createdAt: contentItems.createdAt,
        })
        .from(contentItems)
        .where(eq(contentItems.orgId, orgId))
        .orderBy(desc(contentItems.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      const itemIds = itemRows.map((row) => row.id);
      if (itemIds.length === 0) {
        return { items: itemRows, variants: [], approvals: [], media: [], total };
      }

      const variantRows = await tx
        .select({
          id: contentVariants.id,
          contentItemId: contentVariants.contentItemId,
          platform: contentVariants.platform,
          caption: contentVariants.caption,
          hook: contentVariants.hook,
          cta: contentVariants.cta,
          hashtags: contentVariants.hashtags,
          voiceScore: contentVariants.voiceScore,
        })
        .from(contentVariants)
        .where(inArray(contentVariants.contentItemId, itemIds))
        .orderBy(asc(contentVariants.createdAt));

      const approvalRows = await tx
        .select({
          id: contentApprovals.id,
          contentItemId: contentApprovals.contentItemId,
        })
        .from(contentApprovals)
        .where(inArray(contentApprovals.contentItemId, itemIds))
        .orderBy(desc(contentApprovals.decidedAt));

      // The best (most recent, `done`) generated asset per item, in ONE join
      // query — never N+1 per item. `creativeJobs.contentItemId` is nullable
      // (a job can predate/outlive its item), so `inArray` naturally excludes
      // unattached jobs; both tables are also explicitly org-scoped in the
      // WHERE (belt-and-suspenders alongside the RLS `app.org_id` GUC).
      const mediaRows = await tx
        .select({
          contentItemId: creativeJobs.contentItemId,
          jobKind: creativeJobs.kind,
          jobPrompt: creativeJobs.prompt,
          storageKey: creativeAssets.storageKey,
          mime: creativeAssets.mime,
          width: creativeAssets.width,
          height: creativeAssets.height,
          durationMs: creativeAssets.durationMs,
          assetMeta: creativeAssets.meta,
        })
        .from(creativeAssets)
        .innerJoin(creativeJobs, eq(creativeJobs.id, creativeAssets.jobId))
        .where(
          and(
            eq(creativeAssets.orgId, orgId),
            eq(creativeJobs.orgId, orgId),
            eq(creativeJobs.status, 'done'),
            inArray(creativeJobs.contentItemId, itemIds),
          ),
        )
        .orderBy(desc(creativeAssets.createdAt));

      return { items: itemRows, variants: variantRows, approvals: approvalRows, media: mediaRows, total };
    });

    // Group raw variant rows by item id, preserving fetch order (oldest first).
    // Variants have no status column of their own, so the parent item's mapped
    // status is applied per variant below.
    const variantRowsByItem = new Map<string, typeof variants>();
    for (const row of variants) {
      const list = variantRowsByItem.get(row.contentItemId) ?? [];
      list.push(row);
      variantRowsByItem.set(row.contentItemId, list);
    }

    // First approval row seen per item wins (rows are ordered latest-first).
    const approvalByItem = new Map<string, string>();
    for (const row of approvals) {
      if (!approvalByItem.has(row.contentItemId)) {
        approvalByItem.set(row.contentItemId, row.id);
      }
    }

    // First media row seen per item wins (rows are ordered newest-first by
    // `creativeAssets.createdAt`, so that's the item's most recent `done` asset).
    const mediaByItem = new Map<string, MediaAssetRow>();
    for (const row of media) {
      if (!row.contentItemId || mediaByItem.has(row.contentItemId)) continue;
      mediaByItem.set(row.contentItemId, row);
    }

    const result = items.map<ContentItemView>((row) => {
      const status = toWebContentStatus(row.status);
      const itemVariants: ContentVariantView[] = (variantRowsByItem.get(row.id) ?? []).map(
        (variant) => ({
          id: variant.id,
          platform: toWebPlatform(variant.platform),
          caption: variant.caption ?? '',
          hook: variant.hook ?? '',
          cta: variant.cta ?? '',
          hashtags: variant.hashtags ?? [],
          voiceScore: confidenceToPercent(variant.voiceScore),
          status,
        }),
      );
      const first = itemVariants[0];
      const title = first?.hook || row.brief || row.pillar || `${row.format} content`;
      const mediaRow = mediaByItem.get(row.id);
      return {
        id: row.id,
        title,
        platform: first?.platform ?? toWebPlatform(row.format),
        format: row.format,
        status,
        scheduledFor: (row.scheduledFor ?? row.createdAt ?? new Date()).toISOString(),
        caption: first?.caption || row.brief || '',
        approvalId: approvalByItem.get(row.id) ?? null,
        // Omitted entirely (not `media: undefined`) when no asset exists, so
        // the web's `item.media` check degrades gracefully either way.
        ...(mediaRow ? { media: toMediaView(mediaRow, title) } : {}),
        variants: itemVariants,
      };
    });

    return ok<Paginated<ContentItemView>>({ items: result, total, page, limit });
  }

  /**
   * Resolve which connected `social_accounts` row should publish a variant.
   * When `requestedId` is given it must belong to the org (else 404); otherwise
   * the org's first `connected` account whose provider matches the variant
   * platform is used. Throws `bad_request` when no eligible account exists so
   * the web can point the owner to Settings to connect a channel.
   */
  private async resolveSocialAccountId(
    tx: Database,
    orgId: string,
    platform: PublishPlatform,
    requestedId?: string,
  ): Promise<string> {
    if (requestedId) {
      const account = await tx.query.socialAccounts.findFirst({
        where: and(eq(socialAccounts.id, requestedId), eq(socialAccounts.orgId, orgId)),
        columns: { id: true },
      });
      if (!account) {
        throw new AppError('not_found', 'Social account not found');
      }
      return account.id;
    }

    const provider = providerForPlatform(platform);
    if (!provider) {
      throw new AppError('bad_request', 'No connected account for this platform');
    }

    const account = await tx.query.socialAccounts.findFirst({
      where: and(
        eq(socialAccounts.orgId, orgId),
        eq(socialAccounts.provider, provider),
        eq(socialAccounts.status, 'connected'),
      ),
      columns: { id: true },
    });
    if (!account) {
      throw new AppError('bad_request', 'No connected account for this platform');
    }
    return account.id;
  }
}
