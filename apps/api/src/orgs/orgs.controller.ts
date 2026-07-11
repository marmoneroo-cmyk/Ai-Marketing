import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  organizations,
  users,
  memberships,
  withOrgScope,
  type Database,
} from '@brandpilot/db';
import type { OrgPlan } from '@brandpilot/config';
import { ok, AppError, type ApiResponse, type Role } from '@brandpilot/core';
import { DATABASE } from '../db/db.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CurrentOrg } from '../auth/current-org.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt.strategy';
import { zodSchemaClass } from '../common/zod-validation.pipe';
import {
  toWebAutonomy,
  resolveCaps,
  type WebAutonomy,
  type WebCaps,
} from '../dashboard/read-model.mappers';
import { OrgInviteService, ASSIGNABLE_ROLES, type InviteView } from './org-invite.service';

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ASSIGNABLE_ROLES),
});
class CreateInviteBody extends zodSchemaClass(createInviteSchema) {}

interface OrgView {
  id: string;
  name: string;
  slug: string;
  plan: string;
}

interface MemberView {
  userId: string;
  email: string;
  name: string | null;
  role: Role;
}

/** Owner-facing org profile the web dashboard + settings screen consume. */
interface OrgProfileView {
  orgName: string;
  ownerName: string;
  ownerEmail: string;
  autonomy: WebAutonomy;
  caps: WebCaps;
  plan: OrgPlan;
  /** Whether the CALLER's own account (not necessarily the org owner) has verified its email. */
  emailVerified: boolean;
}

/**
 * Organization endpoints scoped to the caller's current org. Demonstrates the
 * full request pipeline: JWT auth → RBAC → org-scoped Drizzle read → envelope,
 * with mutating requests (the invite endpoints below) audited by the global
 * interceptor.
 */
@ApiTags('orgs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('orgs')
export class OrgsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly orgInviteService: OrgInviteService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the current organization' })
  async getCurrentOrg(@CurrentOrg() orgId: string): Promise<ApiResponse<OrgView>> {
    // RLS active for the read: `withOrgScope` sets app.org_id so the DB enforces
    // tenant isolation as defense-in-depth behind the id filter below.
    const org = await withOrgScope(this.db, orgId, (tx) =>
      tx.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
        columns: { id: true, name: true, slug: true, plan: true },
      }),
    );
    if (!org) {
      throw new AppError('not_found', 'Organization not found');
    }
    return ok(org);
  }

  @Get('profile')
  @ApiOperation({ summary: "Get the current org's owner-facing profile" })
  async getProfile(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: AuthContext,
  ): Promise<ApiResponse<OrgProfileView>> {
    const view = await withOrgScope(this.db, orgId, async (tx) => {
      const org = await tx.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
        columns: { name: true, autonomyMode: true, settings: true, plan: true },
      });
      if (!org) {
        throw new AppError('not_found', 'Organization not found');
      }

      // Identity is the org owner; fall back to any member so the screen still
      // renders for orgs somehow provisioned without an explicit owner. One
      // query, owner sorted first.
      const [identity] = await tx
        .select({ name: users.name, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.orgId, orgId))
        .orderBy(sql`case when ${memberships.role} = 'owner' then 0 else 1 end`)
        .limit(1);

      return {
        orgName: org.name,
        ownerName: identity?.name ?? '',
        ownerEmail: identity?.email ?? '',
        autonomy: toWebAutonomy(org.autonomyMode),
        caps: resolveCaps(org.plan, org.settings),
        plan: org.plan,
      };
    });

    // `users` is a global table (not org-scoped — see rls.ts), so this lookup
    // deliberately runs outside `withOrgScope`. It reflects the CALLER's own
    // verification state (from the JWT `sub`), not the org owner's — those can
    // differ when a non-owner member is the one calling this endpoint.
    const caller = await this.db.query.users.findFirst({
      where: eq(users.id, user.userId),
      columns: { emailVerifiedAt: true },
    });

    return ok({ ...view, emailVerified: caller?.emailVerifiedAt != null });
  }

  /**
   * The Settings team roster. Read-only, so any authenticated member may view
   * who's in the org; `members:manage` (below) gates the invite/revoke
   * mutations.
   */
  @Get('me/members')
  @ApiOperation({ summary: 'List members of the current organization' })
  async listMembers(@CurrentOrg() orgId: string): Promise<ApiResponse<MemberView[]>> {
    // Org-scoped join under RLS: only memberships for the caller's org return,
    // enforced both by the WHERE below and the app.org_id GUC.
    const rows = await withOrgScope(this.db, orgId, (tx) =>
      tx
        .select({
          userId: users.id,
          email: users.email,
          name: users.name,
          role: memberships.role,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.orgId, orgId)),
    );

    return ok(rows);
  }

  /**
   * Invite a teammate into the current org by email + role. Note: this only
   * ISSUES the invite (persists it and emails a signed accept link) — consuming
   * that link (the pre-auth accept flow) is a separate, later endpoint.
   */
  @Post('invites')
  @RequirePermissions('members:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Invite a teammate to join the current organization' })
  async createInvite(
    @CurrentOrg() orgId: string,
    @CurrentUser() user: AuthContext,
    @Body() body: CreateInviteBody,
  ): Promise<ApiResponse<{ ok: true }>> {
    await this.orgInviteService.createInvite(orgId, user.userId, body.email, body.role);
    return ok({ ok: true });
  }

  /** List the current org's pending (unaccepted, unexpired) invites. */
  @Get('invites')
  @RequirePermissions('members:manage')
  @ApiOperation({ summary: 'List pending invites for the current organization' })
  async listInvites(@CurrentOrg() orgId: string): Promise<ApiResponse<InviteView[]>> {
    const views = await this.orgInviteService.listInvites(orgId);
    return ok(views);
  }

  /** Revoke a pending invite before it's accepted. */
  @Delete('invites/:id')
  @RequirePermissions('members:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a pending invite' })
  async revokeInvite(
    @CurrentOrg() orgId: string,
    @Param('id') id: string,
  ): Promise<ApiResponse<{ ok: true }>> {
    await this.orgInviteService.revokeInvite(orgId, id);
    return ok({ ok: true });
  }
}
