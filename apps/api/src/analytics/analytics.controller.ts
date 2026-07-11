import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { desc, eq } from 'drizzle-orm';
import { kpiDaily, postMetrics, withOrgScope, type Database } from '@brandpilot/db';
import { ok, type ApiResponse } from '@brandpilot/core';
import { DATABASE } from '../db/db.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentOrg } from '../auth/current-org.decorator';
import { toNumber, toWebPlatform, type WebPlatform } from '../dashboard/read-model.mappers';

interface KpiPoint {
  day: string;
  reach: number;
  engagement: number;
  leads: number;
  revenue: number;
}

interface TopPost {
  id: string;
  platform: WebPlatform;
  reach: number;
  engagement: number;
  capturedAt: string;
}

interface AnalyticsSnapshot {
  series: KpiPoint[];
  topPosts: TopPost[];
}

const SERIES_LIMIT = 30;
const TOP_POSTS_LIMIT = 5;
const TOP_POSTS_SCAN = 100;

/**
 * Analytics read-model endpoint scoped to the caller's current org. Mirrors the
 * OrgsController pipeline (JWT → RBAC → org-scoped Drizzle read → envelope). It
 * returns the last 30 `kpi_daily` rows as an ascending trend series plus the top
 * posts by engagement from `post_metrics`. Numerics arrive string-typed and are
 * coerced with `toNumber`; both sources are treated as optionally empty.
 */
@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('analytics:read')
  @ApiOperation({ summary: 'Get the analytics read-model snapshot' })
  async snapshot(
    @CurrentOrg() orgId: string,
  ): Promise<ApiResponse<AnalyticsSnapshot>> {
    // One RLS-scoped transaction; both reads run on the scoped `tx`.
    const { series, topPosts } = await withOrgScope(this.db, orgId, async (tx) => {
      const [s, t] = await Promise.all([
        this.buildSeries(tx, orgId),
        this.buildTopPosts(tx, orgId),
      ]);
      return { series: s, topPosts: t };
    });
    return ok({ series, topPosts });
  }

  /** Last 30 kpi_daily rows, returned oldest-first for charting. */
  private async buildSeries(tx: Database, orgId: string): Promise<KpiPoint[]> {
    const rows = await tx
      .select()
      .from(kpiDaily)
      .where(eq(kpiDaily.orgId, orgId))
      .orderBy(desc(kpiDaily.day))
      .limit(SERIES_LIMIT);

    // Query is newest-first (so LIMIT keeps the most recent 30); reverse for an
    // ascending time series.
    return rows
      .map((row) => ({
        day: row.day,
        reach: toNumber(row.reach),
        engagement: toNumber(row.engagement),
        leads: toNumber(row.leads),
        revenue: toNumber(row.revenue),
      }))
      .reverse();
  }

  /**
   * Top posts by engagement (likes + comments + shares + saves). Scans a bounded
   * window of recent metric snapshots, aggregates in memory, and returns the top
   * five — avoiding a DB-specific SUM/ORDER expression in this read model.
   */
  private async buildTopPosts(tx: Database, orgId: string): Promise<TopPost[]> {
    const rows = await tx
      .select()
      .from(postMetrics)
      .where(eq(postMetrics.orgId, orgId))
      .orderBy(desc(postMetrics.capturedAt))
      .limit(TOP_POSTS_SCAN);

    return rows
      .map((row) => {
        const engagement =
          toNumber(row.likes) +
          toNumber(row.comments) +
          toNumber(row.shares) +
          toNumber(row.saves);
        return {
          id: row.id,
          platform: toWebPlatform(row.platform),
          reach: toNumber(row.reach),
          engagement,
          capturedAt: (row.capturedAt ?? new Date()).toISOString(),
        };
      })
      .sort((a, b) => b.engagement - a.engagement)
      .slice(0, TOP_POSTS_LIMIT);
  }
}
