import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { loadEnv, type Env } from '@brandpilot/config';
import { AppError, resilientFetch } from '@brandpilot/core';
import { logger } from '@brandpilot/observability';
import { AuthService, type AuthResult } from './auth.service';
import { Public } from './public.decorator';
import { createNonceState, verifyNonceState } from '../common/oauth-state';

/** Google's OAuth 2.0 / OpenID Connect endpoints. */
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GOOGLE_SCOPES = 'openid email profile';

/** `?oauth_error=` values the web app (login page) understands. */
type OAuthErrorCode = 'google_unavailable' | 'google_failed' | 'email_registered';

interface GoogleTokenResponse {
  access_token?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/**
 * Must be BYTE-IDENTICAL between the authorize step and the token exchange
 * (Google rejects a mismatch) — building it in one place guarantees that.
 * Mirrors `connectorRouteUrl` (packages/config/src/connectors.ts), which can't
 * be reused directly because it's hardcoded to the `/connectors/` prefix.
 */
function googleRedirectUri(env: Pick<Env, 'API_URL'>): string {
  return `${env.API_URL.replace(/\/+$/, '')}/auth/google/callback`;
}

/**
 * "Continue with Google" sign-in/sign-up.
 *
 * Both routes are `@Public()`: `google` is hit directly by a browser
 * link/button (no JWT exists yet), and `callback` is a third-party redirect
 * from Google that cannot carry one either — this mirrors the exact
 * `@Public()` redirect-callback shape `ConnectorsController` uses for
 * Meta/TikTok. The CSRF `state` here binds a random NONCE instead of an
 * `orgId` though: nobody is authenticated yet when the flow starts, so there
 * is no org to bind (see `createNonceState`/`verifyNonceState` in
 * `../common/oauth-state`). Identity instead comes entirely from Google's own
 * (verified) response in the callback, via `AuthService.loginOrRegisterViaGoogle`.
 */
@ApiTags('auth')
@Controller('auth')
export class GoogleOAuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('google')
  @Public()
  @ApiOperation({ summary: 'Redirect to the Google consent screen ("Continue with Google")' })
  async googleStart(@Res() res: Response): Promise<void> {
    const env = loadEnv();
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      this.redirectToLogin(res, env, 'google_unavailable');
      return;
    }

    // Signed, single-use CSRF state. No org exists yet (pre-auth), so unlike
    // the connector OAuth flows this binds a random nonce, not an orgId.
    const state = createNonceState(env.AUTH_SECRET);

    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    url.searchParams.set('redirect_uri', googleRedirectUri(env));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');

    res.redirect(url.toString());
  }

  @Get('google/callback')
  @Public()
  @ApiOperation({ summary: 'Complete the Google OAuth exchange and sign the user in' })
  async googleCallback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const env = loadEnv();
    try {
      // CSRF check FIRST, before any network/DB work — a forged, tampered, or
      // expired state must never reach the token exchange below.
      verifyNonceState(state, env.AUTH_SECRET);

      // Provider returned an error (e.g. the user denied consent) or no code.
      if (error || !code) {
        throw new AppError('bad_request', 'Google OAuth consent was not completed');
      }

      const accessToken = await this.exchangeCode(env, code);
      const profile = await this.fetchProfile(accessToken);
      if (!profile.email) {
        throw new AppError('bad_request', 'Google profile did not include an email');
      }

      const result = await this.authService.loginOrRegisterViaGoogle({
        email: profile.email,
        emailVerified: profile.email_verified === true,
        ...(profile.name ? { name: profile.name } : {}),
      });

      if ('error' in result) {
        this.redirectToLogin(res, env, 'email_registered');
        return;
      }

      this.redirectToAppCallback(res, env, result);
    } catch (err) {
      // Never surface raw JSON/stack to the browser mid-OAuth — log + land the
      // user back on login with a generic, non-leaking error state (mirrors
      // ConnectorsController's callback catch-all).
      logger.warn({ err }, 'Google OAuth callback failed');
      this.redirectToLogin(res, env, 'google_failed');
    }
  }

  /** POST the authorization code to Google's token endpoint; returns the access token. */
  private async exchangeCode(env: Env, code: string): Promise<string> {
    const body = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      code,
      redirect_uri: googleRedirectUri(env),
      grant_type: 'authorization_code',
    });

    const res = await resilientFetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new AppError('bad_request', 'Google token exchange failed');
    }

    const parsed = (await res.json()) as GoogleTokenResponse;
    if (!parsed.access_token) {
      throw new AppError('bad_request', 'Google token exchange returned no access token');
    }
    return parsed.access_token;
  }

  /** Fetch the authenticated user's profile from Google's userinfo endpoint. */
  private async fetchProfile(accessToken: string): Promise<GoogleUserInfo> {
    const res = await resilientFetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new AppError('bad_request', 'Failed to fetch the Google profile');
    }
    return (await res.json()) as GoogleUserInfo;
  }

  /** Land the browser back on login with a `?oauth_error=` code explaining what went wrong. */
  private redirectToLogin(res: Response, env: Pick<Env, 'APP_URL'>, error: OAuthErrorCode): void {
    const appUrl = env.APP_URL.replace(/\/+$/, '');
    res.redirect(`${appUrl}/login?oauth_error=${error}`);
  }

  /**
   * Hand the freshly-issued access + refresh tokens to the web app via the URL
   * FRAGMENT, never a query param: a fragment is never sent to any server (ours
   * or a proxy's), never appears in access/proxy logs, and never leaks through
   * the `Referer` header of a subsequent navigation — unlike a query string, all
   * of which would otherwise expose live bearer credentials. This client-side
   * hand-off (`/auth/callback`) exists because the API is cross-origin from the
   * web app and so cannot set the web app's token cookie directly.
   */
  private redirectToAppCallback(res: Response, env: Pick<Env, 'APP_URL'>, result: AuthResult): void {
    const appUrl = env.APP_URL.replace(/\/+$/, '');
    const fragment = new URLSearchParams({
      token: result.accessToken,
      refresh: result.refreshToken,
    }).toString();
    res.redirect(`${appUrl}/auth/callback#${fragment}`);
  }
}
