import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, gte } from 'drizzle-orm';
import {
  organizations,
  kpiDaily,
  approvals,
  insights,
  contentItems,
  appointments,
  withOrgScope,
  type Database,
} from '@brandpilot/db';
import { ok, type ApiResponse } from '@brandpilot/core';
import { DATABASE } from '../db/db.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentOrg } from '../auth/current-org.decorator';
import {
  confidenceToPercent,
  loadQuoteApprovalValues,
  percentDelta,
  toNumber,
  toWebApprovalKind,
  toWebAutonomy,
  toWebPlatform,
  type WebApprovalKind,
  type WebAutonomy,
  type WebPlatform,
} from './read-model.mappers';

interface KpiSummary {
  reach: number;
  reachDelta: number;
  leads: number;
  leadsDelta: number;
  appointments: number;
  appointmentsDelta: number;
  revenue: number;
  revenueDelta: number;
  followers: number;
  followersDelta: number;
}

interface ScoreTrio {
  marketing: number;
  sales: number;
  growth: number;
}

interface PendingApproval {
  id: string;
  kind: WebApprovalKind;
  title: string;
  summary: string;
  platform?: WebPlatform;
  value?: number;
  confidence: number;
  createdAt: string;
}

interface Recommendation {
  id: string;
  title: string;
  detail: string;
  confidence: number;
  impact: 'high' | 'medium' | 'low';
  module: string;
}

interface CompletedTask {
  id: string;
  label: string;
  module: string;
  at: string;
}

interface DashboardSnapshot {
  kpis: KpiSummary;
  scores: ScoreTrio;
  approvals: PendingApproval[];
  recommendations: Recommendation[];
  completedTasks: CompletedTask[];
  autonomy: WebAutonomy;
}

const EMPTY_KPIS: KpiSummary = {
  reach: 0,
  reachDelta: 0,
  leads: 0,
  leadsDelta: 0,
  appointments: 0,
  appointmentsDelta: 0,
  revenue: 0,
  revenueDelta: 0,
  followers: 0,
  followersDelta: 0,
};

const RECENT_LIMIT = 5;

/** Map an insight confidence (0..100) to the web's impact bucket. */
function impactFromConfidence(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 80) return 'high';
  if (confidence >= 60) return 'medium';
  return 'low';
}

/** Start of the current UTC day, used to scope "today" aggregates. */
function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Dashboard read-model endpoint. Assembles the single `DashboardSnapshot` the
 * web home screen renders (apps/web/src/lib/types.ts) from the analytics,
 * approvals, insights, content, and appointments tables. Every query is
 * org-scoped and every table is treated as optionally empty — the endpoint
 * returns a zeroed snapshot rather than throwing when data is missing.
 */
@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('summary')
  @RequirePermissions('analytics:read')
  @ApiOperation({ summary: 'Get the dashboard read-model snapshot' })
  async summary(@CurrentOrg() orgId: string): Promise<ApiResponse<DashboardSnapshot>> {
    // Assemble the whole snapshot inside one RLS-scoped transaction; every helper
    // runs its reads on the scoped `tx`.
    const snapshot = await withOrgScope(this.db, orgId, async (tx) => {
      const [kpis, autonomy, approvalRows, recommendations, completedTasks] = await Promise.all([
        this.buildKpis(tx, orgId),
        this.readAutonomy(tx, orgId),
        this.buildApprovals(tx, orgId),
        this.buildRecommendations(tx, orgId),
        this.countCompletedToday(tx, orgId),
      ]);

      const result: DashboardSnapshot = {
        kpis,
        scores: this.deriveScores(kpis),
        approvals: approvalRows,
        recommendations,
        completedTasks,
        autonomy,
      };
      return result;
    });
    return ok(snapshot);
  }

  /** Latest kpi_daily row for tiles, with deltas vs the immediately prior row. */
  private async buildKpis(tx: Database, orgId: string): Promise<KpiSummary> {
    const rows = await tx
      .select()
      .from(kpiDaily)
      .where(eq(kpiDaily.orgId, orgId))
      .orderBy(desc(kpiDaily.day))
      .limit(2);

    const [latest, prior] = rows;
    if (!latest) return EMPTY_KPIS;

    const reach = toNumber(latest.reach);
    const leads = toNumber(latest.leads);
    const appts = toNumber(latest.appointments);
    const revenue = toNumber(latest.revenue);
    const followers = toNumber(latest.followers);

    return {
      reach,
      reachDelta: percentDelta(reach, toNumber(prior?.reach)),
      leads,
      leadsDelta: percentDelta(leads, toNumber(prior?.leads)),
      appointments: appts,
      appointmentsDelta: percentDelta(appts, toNumber(prior?.appointments)),
      revenue,
      revenueDelta: percentDelta(revenue, toNumber(prior?.revenue)),
      followers,
      followersDelta: percentDelta(followers, toNumber(prior?.followers)),
    };
  }

  /** Read the org's autonomy mode, collapsed to the web's tri-state. */
  private async readAutonomy(tx: Database, orgId: string): Promise<WebAutonomy> {
    const org = await tx.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { autonomyMode: true },
    });
    return toWebAutonomy(org?.autonomyMode);
  }

  /** Pending approvals mapped to the web PendingApproval shape (most recent first). */
  private async buildApprovals(tx: Database, orgId: string): Promise<PendingApproval[]> {
    const rows = await tx
      .select()
      .from(approvals)
      .where(and(eq(approvals.orgId, orgId), eq(approvals.status, 'pending')))
      .orderBy(desc(approvals.createdAt))
      .limit(RECENT_LIMIT);

    // The approvals table has no amount column; a quote's dollar figure only
    // exists on the linked `quotes` row, so it's batch-loaded (never N+1).
    const quoteValueByApprovalId = await loadQuoteApprovalValues(tx, orgId, rows);

    return rows.map((row) => {
      const summary = row.summary ?? '';
      const value = quoteValueByApprovalId.get(row.id);
      const item: PendingApproval = {
        id: row.id,
        kind: toWebApprovalKind(row.kind),
        // The approvals table has no title column; derive a concise one from the
        // kind and fall back to the summary's first clause.
        title: summary ? summary.split('. ')[0] : `${row.kind} approval`,
        summary,
        platform: toWebPlatform(row.targetType),
        ...(value !== undefined ? { value } : {}),
        confidence: confidenceToPercent(row.confidence),
        createdAt: (row.createdAt ?? new Date()).toISOString(),
      };
      return item;
    });
  }

  /** Recent `recommendation` insights mapped to the web Recommendation shape. */
  private async buildRecommendations(tx: Database, orgId: string): Promise<Recommendation[]> {
    const rows = await tx
      .select()
      .from(insights)
      .where(and(eq(insights.orgId, orgId), eq(insights.kind, 'recommendation')))
      .orderBy(desc(insights.createdAt))
      .limit(RECENT_LIMIT);

    return rows.map((row) => {
      const confidence = confidenceToPercent(row.confidence);
      return {
        id: row.id,
        title: row.title,
        detail: row.body ?? '',
        confidence,
        impact: impactFromConfidence(confidence),
        module: row.module,
      };
    });
  }

  /**
   * Completed-today feed: content published, approvals decided, and appointments
   * completed since 00:00 UTC, merged and capped. Purely additive — any empty
   * source simply contributes nothing.
   */
  private async countCompletedToday(tx: Database, orgId: string): Promise<CompletedTask[]> {
    const since = startOfTodayUtc();

    const [published, decided, metAppointments] = await Promise.all([
      tx
        .select({ id: contentItems.id, at: contentItems.createdAt })
        .from(contentItems)
        .where(
          and(
            eq(contentItems.orgId, orgId),
            eq(contentItems.status, 'published'),
            gte(contentItems.createdAt, since),
          ),
        )
        .limit(RECENT_LIMIT),
      tx
        .select({ id: approvals.id, at: approvals.decidedAt, status: approvals.status })
        .from(approvals)
        .where(and(eq(approvals.orgId, orgId), gte(approvals.decidedAt, since)))
        .limit(RECENT_LIMIT),
      tx
        .select({ id: appointments.id, at: appointments.startsAt })
        .from(appointments)
        .where(
          and(
            eq(appointments.orgId, orgId),
            eq(appointments.status, 'completed'),
            gte(appointments.startsAt, since),
          ),
        )
        .limit(RECENT_LIMIT),
    ]);

    const tasks: CompletedTask[] = [
      ...published.map((r) => ({
        id: `content_${r.id}`,
        label: 'Published a content item',
        module: 'Publishing',
        at: (r.at ?? new Date()).toISOString(),
      })),
      ...decided.map((r) => ({
        id: `approval_${r.id}`,
        label: `Approval ${r.status}`,
        module: 'Approvals',
        at: (r.at ?? new Date()).toISOString(),
      })),
      ...metAppointments.map((r) => ({
        id: `appointment_${r.id}`,
        label: 'Completed an appointment',
        module: 'Appointments',
        at: (r.at ?? new Date()).toISOString(),
      })),
    ];

    return tasks
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, RECENT_LIMIT);
  }

  /**
   * Bounded heuristic scores (0..100) derived from the latest KPIs. Marketing
   * leans on reach momentum, sales on lead→appointment throughput, growth on
   * revenue momentum. Deltas are clamped so a single big day cannot exceed 100.
   */
  private deriveScores(kpis: KpiSummary): ScoreTrio {
    const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));
    const base = 50;
    const marketing = clamp(base + kpis.reachDelta + (kpis.reach > 0 ? 10 : 0));
    const sales = clamp(
      base +
        kpis.appointmentsDelta +
        (kpis.leads > 0 ? Math.min(20, (kpis.appointments / kpis.leads) * 100) : 0),
    );
    const growth = clamp(base + kpis.revenueDelta + (kpis.revenue > 0 ? 10 : 0));
    return { marketing, sales, growth };
  }
}
