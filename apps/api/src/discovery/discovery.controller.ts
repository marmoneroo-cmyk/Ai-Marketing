import { Body, Controller, Get, Inject, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Queue } from 'bullmq';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  businessProfiles,
  customerPersonas,
  competitors,
  discoveryRuns,
  withOrgScope,
  type Database,
} from '@brandpilot/db';
import { ok, type ApiResponse, type DiscoveryJobData } from '@brandpilot/core';
import { DATABASE } from '../db/db.provider';
import { DISCOVERY_QUEUE } from '../queue/queue.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentOrg } from '../auth/current-org.decorator';
import { zodSchemaClass } from '../common/zod-validation.pipe';

const runDiscoverySchema = z
  .object({
    websiteUrl: z.string().url().optional(),
    social: z
      .object({
        provider: z.enum(['instagram', 'facebook', 'tiktok']),
        accountId: z.string().min(1),
        accessToken: z.string().min(1),
      })
      .optional(),
  })
  .refine((v) => Boolean(v.websiteUrl) || Boolean(v.social), {
    message: 'Provide at least a websiteUrl or a connected social account',
  });

class RunDiscoveryBody extends zodSchemaClass(runDiscoverySchema) {}

/**
 * Onboarding / discovery endpoints. `POST /discovery/run` enqueues the async
 * Discovery job (the worker builds the Business DNA); the GET endpoints expose
 * the synthesized DNA and run history for the dashboard's review screen.
 */
@ApiTags('discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('discovery')
export class DiscoveryController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(DISCOVERY_QUEUE) private readonly queue: Queue<DiscoveryJobData>,
  ) {}

  @Post('run')
  @RequirePermissions('brain:write')
  // Expensive: this fans out to scraping + LLM synthesis in the worker. Cap it
  // well below the global default so a caller cannot spam discovery runs.
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Kick off business discovery (asynchronous)' })
  async run(
    @CurrentOrg() orgId: string,
    @Body() body: RunDiscoveryBody,
  ): Promise<ApiResponse<{ jobId: string }>> {
    const data: DiscoveryJobData = {
      orgId,
      ...(body.websiteUrl ? { websiteUrl: body.websiteUrl } : {}),
      ...(body.social ? { social: body.social } : {}),
    };
    const job = await this.queue.add('run', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    return ok({ jobId: job.id ?? '' });
  }

  @Get('dna')
  @RequirePermissions('brain:read')
  @ApiOperation({ summary: 'Get the synthesized Business DNA' })
  async dna(
    @CurrentOrg() orgId: string,
  ): Promise<ApiResponse<{ profile: unknown; personas: unknown[]; competitors: unknown[] }>> {
    const { profile, personas, competitors: comps } = await withOrgScope(
      this.db,
      orgId,
      async (tx) => {
        const p =
          (await tx.query.businessProfiles.findFirst({ where: eq(businessProfiles.orgId, orgId) })) ??
          null;
        const personaRows = await tx.select().from(customerPersonas).where(eq(customerPersonas.orgId, orgId));
        const compRows = await tx.select().from(competitors).where(eq(competitors.orgId, orgId));
        return { profile: p, personas: personaRows, competitors: compRows };
      },
    );
    return ok({ profile, personas, competitors: comps });
  }

  @Get('runs')
  @RequirePermissions('brain:read')
  @ApiOperation({ summary: 'List recent discovery runs' })
  async runs(@CurrentOrg() orgId: string): Promise<ApiResponse<unknown[]>> {
    const rows = await withOrgScope(this.db, orgId, (tx) =>
      tx
        .select()
        .from(discoveryRuns)
        .where(eq(discoveryRuns.orgId, orgId))
        .orderBy(desc(discoveryRuns.createdAt))
        .limit(20),
    );
    return ok(rows);
  }
}
