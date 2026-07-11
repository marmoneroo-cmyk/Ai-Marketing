import { Body, Controller, Inject, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { organizations, withOrgScope, type Database } from '@brandpilot/db';
import { ok, type ApiResponse } from '@brandpilot/core';
import { DATABASE } from '../db/db.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentOrg } from '../auth/current-org.decorator';
import { zodSchemaClass } from '../common/zod-validation.pipe';
import { fromWebAutonomy } from '../dashboard/read-model.mappers';

/**
 * Accept both the web's tri-state autonomy (`observe|suggest|auto`) and the
 * canonical domain values (`auto_scoped|auto_broad`). The value is normalized to
 * the canonical `AutonomyMode` before it is persisted.
 */
const setAutonomySchema = z.object({
  mode: z.enum(['observe', 'suggest', 'auto', 'auto_scoped', 'auto_broad']),
});

class SetAutonomyBody extends zodSchemaClass(setAutonomySchema) {}

/**
 * Settings mutations for the current org. `PATCH /settings/autonomy` updates how
 * much the platform may act without human approval
 * (`organizations.autonomyMode`). Org-scoped; body validated by the global Zod
 * pipe via the schema-carrier class.
 */
@ApiTags('settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('settings')
export class SettingsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Patch('autonomy')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: "Update the org's autonomy mode" })
  async setAutonomy(
    @CurrentOrg() orgId: string,
    @Body() body: SetAutonomyBody,
  ): Promise<ApiResponse<{ ok: true }>> {
    await withOrgScope(this.db, orgId, (tx) =>
      tx
        .update(organizations)
        .set({ autonomyMode: fromWebAutonomy(body.mode) })
        .where(eq(organizations.id, orgId)),
    );

    return ok({ ok: true });
  }
}
