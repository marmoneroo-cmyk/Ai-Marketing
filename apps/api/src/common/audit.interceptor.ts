import {
  Inject,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { auditLogs, withOrgScope, type Database } from '@brandpilot/db';
import { DATABASE } from '../db/db.provider';
import type { AuthContext } from '../auth/jwt.strategy';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface AuthedRequest extends Request {
  user?: AuthContext;
}

/**
 * Writes an append-only `auditLogs` row for every mutating (non-GET) request.
 * Runs after the handler succeeds so failed requests are not recorded as
 * completed actions. Audit failures are logged but never break the response.
 *
 * actorType is always 'user' here (the gateway only serves authenticated user
 * traffic); agent/system actions are audited by their own callers.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const method = request.method.toUpperCase();

    if (!MUTATING_METHODS.has(method)) {
      return next.handle();
    }

    const auth = request.user;
    // Use the matched route pattern (e.g. /orgs/:id) so we never leak
    // identifiers or emails into the action label. When no route matched, fall
    // back to the HTTP method alone rather than the raw path.
    const routePath = (request.route as { path?: string } | undefined)?.path;
    const action = routePath ? `${method} ${routePath}` : method;

    return next.handle().pipe(
      tap(() => {
        // Fire-and-forget: an audit write must not delay or fail the response.
        void this.write(auth, action);
      }),
    );
  }

  private async write(auth: AuthContext | undefined, action: string): Promise<void> {
    // Without an org we cannot satisfy the NOT NULL org_id column; skip
    // unauthenticated mutations (e.g. login) rather than fail.
    if (!auth?.orgId) return;
    const orgId = auth.orgId;
    const actorId = auth.userId;

    try {
      // Write through withOrgScope so the transaction's `app.org_id` GUC is set:
      // `audit_logs` has RLS enabled (rls.ts) and its USING policy doubles as the
      // INSERT WITH CHECK, so a bare pool insert is rejected under FORCE ROW
      // LEVEL SECURITY. This matches how every other org-scoped write runs and
      // enforces tenant isolation at the DB layer.
      await withOrgScope(this.db, orgId, (tx) =>
        tx.insert(auditLogs).values({
          orgId,
          actorType: 'user',
          actorId,
          action,
        }),
      );
    } catch (error: unknown) {
      this.logger.error('Failed to write audit log', error instanceof Error ? error.stack : String(error));
    }
  }
}
