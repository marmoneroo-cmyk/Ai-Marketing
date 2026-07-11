import { Controller, Get, Inject, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { and, count, desc, eq } from 'drizzle-orm';
import { organizations, socialAccounts, connectorTokens, withOrgScope, type Database } from '@brandpilot/db';
import {
  MetaConnector,
  InstagramLoginConnector,
  TikTokConnector,
  encryptToken,
  type ConnectResult,
  type AuthTokens,
} from '@brandpilot/connectors';
import { loadEnv, connectorRouteUrl, resolvePlanCaps } from '@brandpilot/config';
import { ok, AppError, type ApiResponse } from '@brandpilot/core';
import { logger } from '@brandpilot/observability';
import { DATABASE } from '../db/db.provider';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { Public } from '../auth/public.decorator';
import { CurrentOrg } from '../auth/current-org.decorator';
import { createOAuthState, readOAuthState, readOAuthStateWithProvider } from '../common/oauth-state';
import { buildChannelList, type WebChannel } from '../dashboard/read-model.mappers';

/** Meta OAuth dialog (Graph v21.0) + the scopes we request for publishing/reading. */
const META_OAUTH_DIALOG = 'https://www.facebook.com/v21.0/dialog/oauth';
const META_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
];

/**
 * Instagram Login ("Instagram API with Instagram Login") authorize endpoint +
 * scopes. This path authenticates directly against Instagram — no Facebook Page
 * required — and uses the dedicated INSTAGRAM_APP_* credentials.
 */
const INSTAGRAM_LOGIN_DIALOG = 'https://www.instagram.com/oauth/authorize';
const INSTAGRAM_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];

/** TikTok Login Kit authorize endpoint (v2) + the scopes we request. */
const TIKTOK_OAUTH_AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_SCOPES = ['user.info.basic', 'video.list'];

/** The two social platforms the Meta connector (one Graph app) can connect. */
const META_PLATFORMS = ['instagram', 'facebook'] as const;
type MetaPlatform = (typeof META_PLATFORMS)[number];

/**
 * Narrow an incoming `?provider=` query value (or a value read back out of a
 * signed `state`) to a supported Meta platform, defaulting anything
 * missing/unrecognized to `instagram` — the pre-existing behavior, kept as the
 * safe default rather than rejecting outright so a malformed/legacy value
 * degrades instead of breaking the flow.
 */
function normalizeMetaPlatform(value: string | undefined): MetaPlatform {
  return (META_PLATFORMS as readonly string[]).includes(value ?? '') ? (value as MetaPlatform) : 'instagram';
}

interface StartResponse {
  url: string;
}

/** Which social connectors have server-side credentials configured (booleans only — never secrets). */
interface ConnectorAvailability {
  instagram: boolean;
  facebook: boolean;
  tiktok: boolean;
}

/**
 * OAuth connect flow for external providers. `start` (JWT-guarded) returns the
 * provider's authorize URL; `callback` is a `@Public()` browser-redirect target
 * that completes the code exchange, persists the connected account + its
 * (encrypted) token, then REDIRECTS the browser back to the app's Settings page
 * with a success/error state — never returns JSON, since a provider redirect is a
 * top-level navigation the user actually sees. The org is taken from the signed
 * `state` (a third-party redirect carries no JWT).
 */
@ApiTags('connectors')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('connectors')
export class ConnectorsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The Settings channel grid. Read-only, so any authenticated member may view
   * connection status; *starting* a connect flow still requires
   * `settings:manage` (enforced on the start/callback routes below).
   */
  @Get()
  @ApiOperation({ summary: "List the org's channels (connected + connectable)" })
  async listChannels(
    @CurrentOrg() orgId: string,
  ): Promise<ApiResponse<WebChannel[]>> {
    const rows = await withOrgScope(this.db, orgId, (tx) =>
      tx
        .select({
          provider: socialAccounts.provider,
          handle: socialAccounts.handle,
          status: socialAccounts.status,
          connectedAt: socialAccounts.connectedAt,
        })
        .from(socialAccounts)
        .where(eq(socialAccounts.orgId, orgId))
        .orderBy(desc(socialAccounts.connectedAt)),
    );

    return ok(buildChannelList(rows));
  }

  /**
   * Which social connectors are configured on this deployment. Booleans only —
   * never secrets — so the web can render each Connect button as ready vs "not
   * set up yet" instead of letting the user click into a 400. Instagram uses the
   * dedicated Instagram Login app (INSTAGRAM_APP_*); Facebook uses the Meta app
   * (META_APP_*).
   */
  @Get('availability')
  @ApiOperation({ summary: 'Which social connectors are configured (booleans, no secrets)' })
  async getAvailability(): Promise<ApiResponse<ConnectorAvailability>> {
    const env = loadEnv();
    const instagram = Boolean(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET);
    const meta = Boolean(env.META_APP_ID && env.META_APP_SECRET);
    const tiktok = Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);
    return ok({ instagram, facebook: meta, tiktok });
  }

  @Get('meta/start')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Get the Meta OAuth authorize URL to begin connecting an account' })
  async getMetaStart(
    @CurrentOrg() orgId: string,
    @Query('provider') providerParam?: string,
  ): Promise<ApiResponse<StartResponse>> {
    await this.assertChannelCapacity(orgId);

    const env = loadEnv();
    if (!env.META_APP_ID) {
      throw new AppError('bad_request', 'META_APP_ID is not configured');
    }

    // Instagram vs Facebook — both served by this one Meta start/callback pair.
    const provider = normalizeMetaPlatform(providerParam);

    // Signed, single-use CSRF state bound to this org AND the chosen platform:
    // the callback is a third-party redirect with no other app state, so
    // `provider` has to travel inside the state to survive the round trip.
    const state = createOAuthState(orgId, env.AUTH_SECRET, provider);

    // Must be byte-identical to the token-exchange redirect_uri (see MetaConnector)
    // and target the API origin — Meta rejects a mismatch.
    const redirectUri = connectorRouteUrl(env, 'meta/callback');
    const url = new URL(META_OAUTH_DIALOG);
    url.searchParams.set('client_id', env.META_APP_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', META_SCOPES.join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);

    return ok({ url: url.toString() });
  }

  @Get('meta/callback')
  @Public()
  @ApiOperation({ summary: 'Complete the Meta OAuth exchange and connect the account' })
  async getMetaCallback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    try {
      // Provider returned an error (e.g. the user denied consent) or no code.
      if (error || !code) {
        this.redirectToSettings(res, 'instagram', false);
        return;
      }

      // A provider redirect is a third-party navigation with no JWT: the org (and
      // the instagram/facebook choice made at `start`) come from the signed
      // `state`. This also rejects forged/expired state (throws) before any work.
      const { orgId, provider: stateProvider } = readOAuthStateWithProvider(state, loadEnv().AUTH_SECRET);
      const provider = normalizeMetaPlatform(stateProvider);
      const { tokens, account } = await new MetaConnector().connect(code);
      await this.persistConnectedAccount(orgId, provider, account, tokens);

      this.redirectToSettings(res, provider, true);
    } catch (err) {
      // Never surface raw JSON/stack to the browser mid-OAuth — log + land the
      // user back in the app with an error state they can retry from.
      logger.warn({ err }, 'Meta OAuth callback failed');
      this.redirectToSettings(res, 'instagram', false);
    }
  }

  @Get('instagram/start')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Get the Instagram Login OAuth authorize URL (no Facebook Page required)' })
  async getInstagramStart(@CurrentOrg() orgId: string): Promise<ApiResponse<StartResponse>> {
    await this.assertChannelCapacity(orgId);

    const env = loadEnv();
    if (!env.INSTAGRAM_APP_ID) {
      throw new AppError('bad_request', 'INSTAGRAM_APP_ID is not configured');
    }

    // Signed, single-use CSRF state bound to this org (verified in the callback).
    const state = createOAuthState(orgId, env.AUTH_SECRET);

    // Must be byte-identical to the token-exchange redirect_uri (see
    // InstagramLoginConnector) and target the API origin — Instagram rejects a mismatch.
    const redirectUri = connectorRouteUrl(env, 'instagram/callback');
    const url = new URL(INSTAGRAM_LOGIN_DIALOG);
    url.searchParams.set('client_id', env.INSTAGRAM_APP_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', INSTAGRAM_SCOPES.join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);

    return ok({ url: url.toString() });
  }

  @Get('instagram/callback')
  @Public()
  @ApiOperation({ summary: 'Complete the Instagram Login OAuth exchange and connect the account' })
  async getInstagramCallback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    try {
      // Provider returned an error (e.g. the user denied consent) or no code.
      if (error || !code) {
        this.redirectToSettings(res, 'instagram', false);
        return;
      }

      // Third-party redirect with no JWT: the org comes from the signed `state`
      // issued at `start` (also rejects forged/expired state before any work).
      const orgId = readOAuthState(state, loadEnv().AUTH_SECRET);
      const { tokens, account } = await new InstagramLoginConnector().connect(code);
      await this.persistConnectedAccount(orgId, 'instagram', account, tokens);

      this.redirectToSettings(res, 'instagram', true);
    } catch (err) {
      logger.warn({ err }, 'Instagram OAuth callback failed');
      this.redirectToSettings(res, 'instagram', false);
    }
  }

  @Get('tiktok/start')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Get the TikTok OAuth authorize URL to begin connecting an account' })
  async getTikTokStart(@CurrentOrg() orgId: string): Promise<ApiResponse<StartResponse>> {
    await this.assertChannelCapacity(orgId);

    const env = loadEnv();
    if (!env.TIKTOK_CLIENT_KEY) {
      throw new AppError('bad_request', 'TIKTOK_CLIENT_KEY is not configured');
    }

    // Signed, single-use CSRF state bound to this org (verified in the callback).
    const state = createOAuthState(orgId, env.AUTH_SECRET);

    // Must be byte-identical to the token-exchange redirect_uri (see TikTokConnector)
    // and target the API origin — TikTok rejects a mismatch.
    const redirectUri = connectorRouteUrl(env, 'tiktok/callback');
    const url = new URL(TIKTOK_OAUTH_AUTHORIZE);
    url.searchParams.set('client_key', env.TIKTOK_CLIENT_KEY);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', TIKTOK_SCOPES.join(','));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);

    return ok({ url: url.toString() });
  }

  @Get('tiktok/callback')
  @Public()
  @ApiOperation({ summary: 'Complete the TikTok OAuth exchange and connect the account' })
  async getTikTokCallback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    try {
      // Provider returned an error (e.g. the user denied consent) or no code.
      if (error || !code) {
        this.redirectToSettings(res, 'tiktok', false);
        return;
      }

      // A provider redirect is a third-party navigation with no JWT: the org comes
      // from the signed `state` we issued at `start`. This also rejects
      // forged/expired state (throws) before any work.
      const orgId = readOAuthState(state, loadEnv().AUTH_SECRET);
      const { tokens, account } = await new TikTokConnector().connect(code);
      await this.persistConnectedAccount(orgId, 'tiktok', account, tokens);

      this.redirectToSettings(res, 'tiktok', true);
    } catch (err) {
      logger.warn({ err }, 'TikTok OAuth callback failed');
      this.redirectToSettings(res, 'tiktok', false);
    }
  }

  /**
   * Enforce the org's plan-based `maxChannels` ceiling before a connect flow is
   * started. Shared by the Meta and TikTok `start` routes (DRY). The OAuth
   * *callbacks* are intentionally NOT gated here — they only complete a flow
   * that `start` already authorized, so re-checking there would just reject a
   * user mid-flow after they've already granted consent.
   */
  private async assertChannelCapacity(orgId: string): Promise<void> {
    const { maxChannels, connectedCount } = await withOrgScope(this.db, orgId, async (tx) => {
      const org = await tx.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
        columns: { plan: true, settings: true },
      });
      if (!org) {
        throw new AppError('not_found', 'Organization not found');
      }

      const [row] = await tx
        .select({ value: count(socialAccounts.id) })
        .from(socialAccounts)
        .where(and(eq(socialAccounts.orgId, orgId), eq(socialAccounts.status, 'connected')));

      return {
        maxChannels: resolvePlanCaps(org.plan, org.settings).maxChannels,
        connectedCount: Number(row?.value ?? 0),
      };
    });

    if (connectedCount >= maxChannels) {
      logger.info(
        { orgId, maxChannels, connectedCount },
        'channel connect blocked: plan limit reached',
      );
      throw new AppError(
        'forbidden',
        `Plan limit reached: your plan allows ${maxChannels} connected channel${maxChannels === 1 ? '' : 's'}. Contact your account team to upgrade.`,
      );
    }
  }

  /**
   * Persist a freshly-connected account + its encrypted token in one org-scoped
   * transaction (so RLS is enforced). Shared by the Meta and TikTok callbacks.
   */
  private async persistConnectedAccount(
    orgId: string,
    provider: 'instagram' | 'facebook' | 'tiktok',
    account: ConnectResult['account'],
    tokens: AuthTokens,
  ): Promise<void> {
    await withOrgScope(this.db, orgId, async (tx) => {
      const [row] = await tx
        .insert(socialAccounts)
        .values({
          orgId,
          provider,
          externalId: account.externalId,
          ...(account.handle !== undefined ? { handle: account.handle } : {}),
          ...(account.displayName !== undefined ? { displayName: account.displayName } : {}),
          ...(tokens.scopes !== undefined ? { scopes: tokens.scopes } : {}),
          status: 'connected',
        })
        .returning({ id: socialAccounts.id });

      const socialAccountId = row?.id;
      if (!socialAccountId) {
        throw new AppError('internal_error', 'Failed to persist connected account');
      }

      await tx.insert(connectorTokens).values({
        socialAccountId,
        accessTokenEnc: encryptToken(tokens.accessToken),
        ...(tokens.refreshToken !== undefined
          ? { refreshTokenEnc: encryptToken(tokens.refreshToken) }
          : {}),
        ...(tokens.expiresAt !== undefined ? { expiresAt: tokens.expiresAt } : {}),
      });
    });
  }

  /**
   * Land the browser back in the app after an OAuth callback. `?connected` /
   * `?connect_error` drive a success/error toast on the Settings page — we never
   * return JSON to a top-level navigation the user is looking at.
   */
  private redirectToSettings(res: Response, provider: string, connected: boolean): void {
    const appUrl = loadEnv().APP_URL.replace(/\/+$/, '');
    const param = connected ? `connected=${provider}` : `connect_error=${provider}`;
    res.redirect(`${appUrl}/settings?${param}`);
  }
}
