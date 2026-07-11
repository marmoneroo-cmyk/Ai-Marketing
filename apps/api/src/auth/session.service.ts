import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull } from 'drizzle-orm';
import { memberships, refreshTokens, type Database } from '@brandpilot/db';
import { AppError } from '@brandpilot/core';
import { REFRESH_TOKEN_TTL_MS } from '@brandpilot/config';
import { logger } from '@brandpilot/observability';
import { DATABASE } from '../db/db.provider';
import { generateOneTimeToken, hashOneTimeToken } from './one-time-token';
import type { JwtPayload } from './jwt.strategy';

/** A signed access token paired with its long-lived, rotating refresh token. */
export interface AuthResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Single, non-distinguishing failure message for every unusable refresh token
 * (unknown, expired, revoked, reused, or lost a rotation race). A caller must
 * not be able to tell those cases apart — detail stays server-side in logs.
 */
const INVALID_SESSION = 'Your session has expired. Please sign in again.';

/**
 * Session issuance and lifecycle. The access token is a short-lived, stateless
 * JWT (see ACCESS_TOKEN_TTL in auth.module); the refresh token is an opaque,
 * server-side-revocable secret persisted only as a SHA-256 hash. Every login
 * path funnels through {@link issue}, and {@link rotate} swaps a refresh token
 * for a fresh pair on every use — so a single leaked refresh token is usable
 * exactly once before rotation invalidates it, and replaying a rotated token is
 * treated as theft (all of that user's sessions are revoked).
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}

  /** Sign an access token and mint a persisted refresh token for a fresh login. */
  async issue(payload: JwtPayload): Promise<AuthResult> {
    const accessToken = this.jwt.sign(payload);
    const { raw } = await this.mint(payload.sub, payload.orgId);
    return { accessToken, refreshToken: raw };
  }

  /**
   * Exchange a refresh token for a new access+refresh pair, rotating the token.
   * Fails closed (generic `unauthorized`) for any unusable token. Reuse of an
   * already-rotated (revoked) token is treated as compromise: every session for
   * the user is revoked and the request is refused.
   */
  async rotate(rawToken: string): Promise<AuthResult> {
    const tokenHash = hashOneTimeToken(rawToken);
    const row = await this.db.query.refreshTokens.findFirst({
      where: eq(refreshTokens.tokenHash, tokenHash),
    });
    if (!row) {
      throw new AppError('unauthorized', INVALID_SESSION);
    }

    // Replaying a token that was already rotated in a COMPLETED prior cycle is a
    // theft signal: the legitimate holder rotated it, so whoever presents it now
    // holds a copy they shouldn't. Revoke every session for the user and refuse.
    if (row.revokedAt != null) {
      await this.revokeAllForUser(row.userId);
      logger.warn({ userId: row.userId }, 'refresh token reuse detected — revoked all sessions');
      throw new AppError('unauthorized', INVALID_SESSION);
    }

    if (row.expiresAt.getTime() < Date.now()) {
      throw new AppError('unauthorized', INVALID_SESSION);
    }

    // Re-derive the current role from membership so a role change (or removal)
    // takes effect on the next refresh rather than persisting for the token's life.
    const membership = await this.db.query.memberships.findFirst({
      where: and(eq(memberships.userId, row.userId), eq(memberships.orgId, row.orgId)),
    });
    if (!membership) {
      // Membership gone (user removed from the org): end the session.
      await this.revoke(rawToken);
      throw new AppError('unauthorized', INVALID_SESSION);
    }

    // Atomic claim: revoke this row ONLY if it is still active. This is the
    // concurrency guard — of two parallel rotations of the same token, exactly
    // one can win the conditional UPDATE, so a stolen token can never be
    // exchanged for a second live session alongside the legitimate one (the
    // TOCTOU that a read-then-write would allow). Losing the claim (0 rows) means
    // a concurrent rotation already consumed it; reject WITHOUT nuking every
    // session, so a benign multi-tab race is just a rejected request rather than
    // a forced global logout — genuine theft is still caught above on the next
    // use of the now-revoked token.
    const claimed = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });
    if (claimed.length === 0) {
      throw new AppError('unauthorized', INVALID_SESSION);
    }

    // We own the rotation: mint the successor, then link the claimed row to it.
    const accessToken = this.jwt.sign({
      sub: row.userId,
      orgId: row.orgId,
      role: membership.role,
    } satisfies JwtPayload);
    const { raw, id: successorId } = await this.mint(row.userId, row.orgId);
    await this.db
      .update(refreshTokens)
      .set({ replacedById: successorId })
      .where(eq(refreshTokens.id, row.id));

    return { accessToken, refreshToken: raw };
  }

  /** Revoke a single refresh token (logout). Silent — never reveals whether it existed. */
  async revoke(rawToken: string): Promise<void> {
    const tokenHash = hashOneTimeToken(rawToken);
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)));
  }

  /** Revoke every active session for a user (reuse response / future logout-all). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  /**
   * Persist a fresh refresh token (hash only) and return the raw value plus the
   * new row id, which the caller uses to link rotation lineage.
   */
  private async mint(userId: string, orgId: string): Promise<{ raw: string; id: string }> {
    const { raw, hash } = generateOneTimeToken();
    const [created] = await this.db
      .insert(refreshTokens)
      .values({
        userId,
        orgId,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      })
      .returning({ id: refreshTokens.id });
    if (!created) {
      throw new AppError('internal_error', 'Failed to create session');
    }
    return { raw, id: created.id };
  }
}
