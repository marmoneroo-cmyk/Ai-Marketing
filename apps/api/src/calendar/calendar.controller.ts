import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { and, asc, count, eq, gte } from 'drizzle-orm';
import {
  scheduledPosts,
  contentVariants,
  contentItems,
  withOrgScope,
  type Database,
} from '@brandpilot/db';
import {
  ok,
  paginationSchema,
  type ApiResponse,
  type Paginated,
} from '@brandpilot/core';
import { DATABASE } from '../db/db.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentOrg } from '../auth/current-org.decorator';
import { zodSchemaClass } from '../common/zod-validation.pipe';
import { toWebPlatform, type WebPlatform } from '../dashboard/read-model.mappers';

interface CalendarEntry {
  id: string;
  platform: WebPlatform;
  scheduledFor: string;
  status: string;
  caption: string;
  format: string | null;
}

/** `?page&limit` query for the paginated calendar list (page 1, limit 20, max 100). */
class ListCalendarQuery extends zodSchemaClass(paginationSchema) {}

/**
 * Calendar read-model endpoint scoped to the caller's current org. Mirrors the
 * OrgsController pipeline (JWT → RBAC → org-scoped Drizzle read → envelope). It
 * returns a page of upcoming scheduled posts (from now onward, soonest first)
 * joined to their content variant and item for caption/platform/format, with a
 * `total` for the same org-scoped, upcoming filter. Every table is treated as
 * optionally empty.
 */
@ApiTags('calendar')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('calendar')
export class CalendarController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ summary: 'List upcoming scheduled posts for the current org' })
  async list(
    @CurrentOrg() orgId: string,
    @Query() query: ListCalendarQuery,
  ): Promise<ApiResponse<Paginated<CalendarEntry>>> {
    const { page, limit } = query;
    const now = new Date();
    // Both the count and the page query use the identical org + upcoming filter
    // so `total` matches the set being paged. The innerJoin can only ever narrow
    // (a scheduled post has exactly one variant), so counting scheduled posts
    // with the same filter is accurate.
    const upcoming = and(
      eq(scheduledPosts.orgId, orgId),
      gte(scheduledPosts.scheduledFor, now),
    );

    const { rows, total } = await withOrgScope(this.db, orgId, async (tx) => {
      const [{ value: total }] = await tx
        .select({ value: count() })
        .from(scheduledPosts)
        .where(upcoming);

      const rows = await tx
        .select({
          id: scheduledPosts.id,
          scheduledFor: scheduledPosts.scheduledFor,
          status: scheduledPosts.status,
          platform: contentVariants.platform,
          caption: contentVariants.caption,
          format: contentItems.format,
        })
        .from(scheduledPosts)
        .innerJoin(
          contentVariants,
          eq(contentVariants.id, scheduledPosts.contentVariantId),
        )
        .leftJoin(contentItems, eq(contentItems.id, contentVariants.contentItemId))
        .where(upcoming)
        .orderBy(asc(scheduledPosts.scheduledFor))
        .limit(limit)
        .offset((page - 1) * limit);

      return { rows, total };
    });

    const entries: CalendarEntry[] = rows.map((row) => ({
      id: row.id,
      platform: toWebPlatform(row.platform),
      scheduledFor: (row.scheduledFor ?? new Date()).toISOString(),
      status: row.status,
      caption: row.caption ?? '',
      format: row.format ?? null,
    }));
    return ok<Paginated<CalendarEntry>>({ items: entries, total, page, limit });
  }
}
