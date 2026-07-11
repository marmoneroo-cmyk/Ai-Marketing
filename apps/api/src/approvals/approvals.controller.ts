import { Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { approvals, withOrgScope, type Database } from '@brandpilot/db';
import {
  ok,
  AppError,
  type ApiResponse,
  type ApprovalKind,
  type AutomationResumeJobData,
} from '@brandpilot/core';
import { DATABASE } from '../db/db.provider';
import { AUTOMATION_RESUME_QUEUE } from '../queue/queue.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentOrg } from '../auth/current-org.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt.strategy';
import { zodSchemaClass } from '../common/zod-validation.pipe';
import {
  confidenceToPercent,
  loadQuoteApprovalValues,
  toWebApprovalKind,
  toWebPlatform,
  type WebApprovalKind,
  type WebPlatform,
} from '../dashboard/read-model.mappers';

interface PendingApprovalView {
  id: string;
  kind: WebApprovalKind;
  title: string;
  summary: string;
  platform?: WebPlatform;
  value?: number;
  confidence: number;
  createdAt: string;
}

/** Web decision verb → persisted approval status. */
const DECISION_STATUS = {
  approve: 'approved',
  reject: 'rejected',
} as const;

type Decision = keyof typeof DECISION_STATUS;

function isDecision(value: string): value is Decision {
  return value === 'approve' || value === 'reject';
}

const RECENT_LIMIT = 20;

/** Upper bound on ids per `POST /approvals/batch` call. */
const BATCH_MAX_IDS = 100;

/** Body for `POST /approvals/batch`: one decision applied to a bounded set of ids. */
export const batchDecideSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(BATCH_MAX_IDS),
  decision: z.enum(['approve', 'reject']),
});
export class BatchDecideBody extends zodSchemaClass(batchDecideSchema) {}

/**
 * Approvals: the human-in-the-loop queue. `GET /approvals` lists the pending
 * items; `POST /approvals/:id/:decision` records the owner's approve/reject
 * decision on a single item; `POST /approvals/batch` applies one decision to
 * many ids at once (e.g. bulk-approve from the web). Org-scoped throughout;
 * decisions are attributed to the caller.
 */
@ApiTags('approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AUTOMATION_RESUME_QUEUE)
    private readonly resumeQueue: Queue<AutomationResumeJobData>,
  ) {}

  @Get()
  @RequirePermissions('content:read')
  @ApiOperation({ summary: 'List pending approvals for the current org' })
  async list(@CurrentOrg() orgId: string): Promise<ApiResponse<PendingApprovalView[]>> {
    const { rows, quoteValueByApprovalId } = await withOrgScope(this.db, orgId, async (tx) => {
      const rows = await tx
        .select()
        .from(approvals)
        .where(and(eq(approvals.orgId, orgId), eq(approvals.status, 'pending')))
        .orderBy(desc(approvals.createdAt))
        .limit(RECENT_LIMIT);

      // The approvals table has no amount column; a quote's dollar figure only
      // exists on the linked `quotes` row, so it's batch-loaded (never N+1).
      const quoteValueByApprovalId = await loadQuoteApprovalValues(tx, orgId, rows);
      return { rows, quoteValueByApprovalId };
    });

    const items = rows.map((row) => {
      const summary = row.summary ?? '';
      const value = quoteValueByApprovalId.get(row.id);
      return {
        id: row.id,
        kind: toWebApprovalKind(row.kind),
        title: summary ? summary.split('. ')[0] : `${row.kind} approval`,
        summary,
        platform: toWebPlatform(row.targetType),
        ...(value !== undefined ? { value } : {}),
        confidence: confidenceToPercent(row.confidence),
        createdAt: (row.createdAt ?? new Date()).toISOString(),
      };
    });
    return ok(items);
  }

  @Post(':id/:decision')
  @RequirePermissions('content:approve')
  @ApiOperation({ summary: 'Approve or reject a pending approval' })
  async decide(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Param('decision') decision: string,
  ): Promise<ApiResponse<{ ok: true }>> {
    if (!isDecision(decision)) {
      throw new AppError('bad_request', "Decision must be 'approve' or 'reject'");
    }

    // Run the existence check + status update under RLS in one transaction. The
    // approval's `kind` and `targetId` are read so a workflow approval can resume
    // its paused automation run below.
    const existing = await withOrgScope(this.db, orgId, async (tx) => {
      const row = await tx.query.approvals.findFirst({
        where: and(eq(approvals.id, id), eq(approvals.orgId, orgId)),
        columns: { id: true, kind: true, targetId: true },
      });
      if (!row) {
        throw new AppError('not_found', 'Approval not found');
      }

      // Atomically claim the decision ONLY if still pending. A double-click or
      // retry then matches 0 rows → idempotent no-op: no decidedBy/decidedAt
      // overwrite and no duplicate resume job enqueued below.
      const claimed = await tx
        .update(approvals)
        .set({
          status: DECISION_STATUS[decision],
          decidedBy: user.userId,
          decidedAt: new Date(),
        })
        .where(and(eq(approvals.id, id), eq(approvals.orgId, orgId), eq(approvals.status, 'pending')))
        .returning({ id: approvals.id });

      return { ...row, claimed: claimed.length > 0 };
    });

    // Workflow approvals gate a paused automation run: resume it with the
    // decision — but only when THIS call won the pending→decided claim, so a
    // repeated decision never enqueues a second resume.
    if (existing.claimed) {
      await this.resumeWorkflowRun(orgId, existing, decision);
    }

    return ok({ ok: true });
  }

  @Post('batch')
  @RequirePermissions('content:approve')
  @ApiOperation({ summary: 'Approve or reject multiple pending approvals at once' })
  async batchDecide(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: AuthContext,
    @Body() body: BatchDecideBody,
  ): Promise<ApiResponse<{ decided: string[] }>> {
    const { ids, decision } = body;

    // Set-based claim, mirroring decide()'s single-row idempotent claim: the
    // WHERE pins org AND still-pending, so a cross-tenant id or one already
    // decided (by this call or a concurrent one) simply drops out of
    // `claimed` — never a thrown error, never a write outside this org, and
    // never a partial-failure that surfaces per-id. `kind` + `targetId` ride
    // along in the same RETURNING so the workflow-resume side effect below
    // never needs a second per-row query.
    const claimed = await withOrgScope(this.db, orgId, (tx) =>
      tx
        .update(approvals)
        .set({
          status: DECISION_STATUS[decision],
          decidedBy: user.userId,
          decidedAt: new Date(),
        })
        .where(
          and(
            inArray(approvals.id, ids),
            eq(approvals.orgId, orgId),
            eq(approvals.status, 'pending'),
          ),
        )
        .returning({ id: approvals.id, kind: approvals.kind, targetId: approvals.targetId }),
    );

    // Same resume-on-decide side effect as the single-item route, looped over
    // exactly the ids THIS call actually claimed (never the full requested
    // `ids`) — a skipped id can never trigger a resume it didn't earn.
    for (const row of claimed) {
      await this.resumeWorkflowRun(orgId, row, decision);
    }

    return ok({ decided: claimed.map((row) => row.id) });
  }

  /**
   * Shared side effect for both decide routes: a `workflow`-kind approval
   * gates a paused automation run, so a just-claimed decision resumes it with
   * the outcome. Extracted so the single and batch routes can never drift
   * apart on this logic.
   */
  private async resumeWorkflowRun(
    orgId: string,
    approval: { kind: ApprovalKind; targetId: string },
    decision: Decision,
  ): Promise<void> {
    if (approval.kind !== 'workflow' || !approval.targetId) return;

    const job: AutomationResumeJobData = {
      orgId,
      runId: approval.targetId,
      approved: decision === 'approve',
    };
    await this.resumeQueue.add('resume', job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }
}
