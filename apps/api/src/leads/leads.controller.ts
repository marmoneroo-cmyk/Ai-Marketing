import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { countDistinct, desc, eq, sql } from 'drizzle-orm';
import {
  leads,
  contacts,
  deals,
  pipelineStages,
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
import { toNumber } from '../dashboard/read-model.mappers';

interface LeadView {
  id: string;
  name: string | null;
  email: string | null;
  source: string | null;
  score: number;
  status: string;
  stage: string | null;
  dealAmount: number | null;
  dealStatus: string | null;
  createdAt: string;
}

/**
 * Pipeline KPIs aggregated across ALL of an org's leads (not a single page), so
 * the CRM header tiles stay accurate independently of the paginated table.
 */
interface LeadSummaryView {
  /** Distinct leads in the org. */
  total: number;
  /** Leads in a `qualified` or `converted` status. */
  qualified: number;
  /** Sum of amounts on open deals (currency minor units aside — raw numeric). */
  openPipeline: number;
  /** Sum of amounts on won deals. */
  won: number;
}

/** `?page&limit` query for the paginated leads list (page 1, limit 20, max 100). */
class ListLeadsQuery extends zodSchemaClass(paginationSchema) {}

/**
 * Leads read-model endpoint scoped to the caller's current org. Mirrors the
 * OrgsController pipeline (JWT → RBAC → org-scoped Drizzle read → envelope) and
 * flattens a lead ⋈ contact ⋈ stage ⋈ latest-deal join into the row shape the
 * web CRM table renders. The `score` numeric (0..1) is surfaced 0..100, results
 * are paginated (`total` counts distinct leads), and the table is treated as
 * optionally empty.
 */
@ApiTags('leads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('leads')
export class LeadsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  @RequirePermissions('crm:read')
  @ApiOperation({ summary: 'List leads for the current org' })
  async list(
    @CurrentOrg() orgId: string,
    @Query() query: ListLeadsQuery,
  ): Promise<ApiResponse<Paginated<LeadView>>> {
    const { page, limit } = query;
    const { rows, total } = await withOrgScope(this.db, orgId, async (tx) => {
      // Distinct-lead total: the deals leftJoin can multiply rows, so count the
      // lead ids directly for an accurate page total.
      const [{ value: total }] = await tx
        .select({ value: countDistinct(leads.id) })
        .from(leads)
        .where(eq(leads.orgId, orgId));

      const rows = await tx
        .select({
          id: leads.id,
          source: leads.source,
          score: leads.score,
          status: leads.status,
          createdAt: leads.createdAt,
          contactName: contacts.name,
          contactEmail: contacts.email,
          stageName: pipelineStages.name,
          dealAmount: deals.amount,
          dealStatus: deals.status,
        })
        .from(leads)
        .leftJoin(contacts, eq(contacts.id, leads.contactId))
        .leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
        .leftJoin(deals, eq(deals.leadId, leads.id))
        .where(eq(leads.orgId, orgId))
        .orderBy(desc(leads.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      return { rows, total };
    });

    // A lead may join several deals (one row each); keep the first-seen deal —
    // rows already arrive newest-lead-first and this endpoint is a summary view.
    const seen = new Set<string>();
    const views: LeadView[] = [];
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);

      // Score is stored 0..1 (numeric, string-typed); present it as 0..100.
      const rawScore = toNumber(row.score);
      const score = Math.round((rawScore <= 1 ? rawScore * 100 : rawScore));

      views.push({
        id: row.id,
        name: row.contactName,
        email: row.contactEmail,
        source: row.source,
        score,
        status: row.status,
        stage: row.stageName,
        dealAmount: row.dealAmount === null ? null : toNumber(row.dealAmount),
        dealStatus: row.dealStatus,
        createdAt: (row.createdAt ?? new Date()).toISOString(),
      });
    }
    return ok<Paginated<LeadView>>({ items: views, total, page, limit });
  }

  @Get('summary')
  @RequirePermissions('crm:read')
  @ApiOperation({ summary: 'Aggregate pipeline KPIs across all leads for the current org' })
  async summary(@CurrentOrg() orgId: string): Promise<ApiResponse<LeadSummaryView>> {
    const summary = await withOrgScope(this.db, orgId, async (tx) => {
      // Two org-scoped aggregates using Postgres FILTER so each KPI is one pass:
      // lead counts from `leads`, deal-value sums from `deals`.
      const [leadAgg] = await tx
        .select({
          total: countDistinct(leads.id),
          qualified: sql<string>`count(*) filter (where ${leads.status} in ('qualified','converted'))`,
        })
        .from(leads)
        .where(eq(leads.orgId, orgId));

      const [dealAgg] = await tx
        .select({
          openPipeline: sql<string>`coalesce(sum(${deals.amount}) filter (where ${deals.status} = 'open'), 0)`,
          won: sql<string>`coalesce(sum(${deals.amount}) filter (where ${deals.status} = 'won'), 0)`,
        })
        .from(deals)
        .where(eq(deals.orgId, orgId));

      return {
        total: toNumber(leadAgg?.total),
        qualified: toNumber(leadAgg?.qualified),
        openPipeline: toNumber(dealAgg?.openPipeline),
        won: toNumber(dealAgg?.won),
      };
    });
    return ok<LeadSummaryView>(summary);
  }
}
