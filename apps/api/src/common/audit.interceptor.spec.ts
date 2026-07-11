import { describe, expect, it } from 'vitest';
import { of, lastValueFrom } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Database } from '@brandpilot/db';
import { AuditInterceptor } from './audit.interceptor';
import type { AuthContext } from '../auth/jwt.strategy';

/**
 * Behavioural tests for AuditInterceptor. The key invariant is that audit rows
 * are written THROUGH a transaction (so `withOrgScope` can set the `app.org_id`
 * GUC that `audit_logs`' RLS policy checks) — a bare pool insert would be
 * rejected under FORCE ROW LEVEL SECURITY. We also verify non-mutating and
 * org-less requests are skipped.
 */

interface Recorded {
  transactions: number;
  executed: unknown[];
  inserted: Array<Record<string, unknown>>;
}

/**
 * Fake Database that records transaction/execute/insert calls. `transaction`
 * runs its callback with a fake tx exactly like the real Drizzle client, so the
 * real `withOrgScope` (which the interceptor calls) drives this end to end.
 */
function fakeDb(rec: Recorded): Database {
  const tx = {
    execute: (query: unknown) => {
      rec.executed.push(query);
      return Promise.resolve([]);
    },
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        rec.inserted.push(values);
        return Promise.resolve([]);
      },
    }),
  };
  return {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      rec.transactions++;
      return cb(tx);
    },
  } as unknown as Database;
}

function newRecord(): Recorded {
  return { transactions: 0, executed: [], inserted: [] };
}

/** ExecutionContext whose request carries the given method / auth / route. */
function contextFor(
  method: string,
  user: AuthContext | undefined,
  routePath?: string,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        user,
        route: routePath ? { path: routePath } : undefined,
      }),
    }),
  } as unknown as ExecutionContext;
}

/** CallHandler that emits a single value and completes, like a resolved handler. */
function handlerOf(value: unknown): CallHandler {
  return { handle: () => of(value) } as unknown as CallHandler;
}

const OWNER: AuthContext = { userId: 'user-1', orgId: 'org-1', role: 'owner' };

/** Let the fire-and-forget `void this.write(...)` promise settle. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AuditInterceptor', () => {
  it('writes an audit row through a transaction (org-scoped) for a mutating request', async () => {
    const rec = newRecord();
    const interceptor = new AuditInterceptor(fakeDb(rec));

    await lastValueFrom(
      interceptor.intercept(contextFor('POST', OWNER, '/leads/:id'), handlerOf('ok')),
    );
    await flush();

    // Went through withOrgScope: a transaction opened and set_config ran first.
    expect(rec.transactions).toBe(1);
    expect(rec.executed).toHaveLength(1);
    // Exactly one audit row, scoped to the actor's org, with the route pattern.
    expect(rec.inserted).toHaveLength(1);
    expect(rec.inserted[0]).toMatchObject({
      orgId: 'org-1',
      actorType: 'user',
      actorId: 'user-1',
      action: 'POST /leads/:id',
    });
  });

  it('falls back to the HTTP method alone when no route pattern matched', async () => {
    const rec = newRecord();
    const interceptor = new AuditInterceptor(fakeDb(rec));

    await lastValueFrom(
      interceptor.intercept(contextFor('DELETE', OWNER), handlerOf('ok')),
    );
    await flush();

    expect(rec.inserted).toHaveLength(1);
    expect(rec.inserted[0]).toMatchObject({ action: 'DELETE' });
  });

  it('does not write for a non-mutating (GET) request', async () => {
    const rec = newRecord();
    const interceptor = new AuditInterceptor(fakeDb(rec));

    await lastValueFrom(
      interceptor.intercept(contextFor('GET', OWNER, '/leads'), handlerOf('ok')),
    );
    await flush();

    expect(rec.transactions).toBe(0);
    expect(rec.inserted).toHaveLength(0);
  });

  it('does not write when the request has no authenticated org', async () => {
    const rec = newRecord();
    const interceptor = new AuditInterceptor(fakeDb(rec));

    await lastValueFrom(
      interceptor.intercept(contextFor('POST', undefined, '/auth/login'), handlerOf('ok')),
    );
    await flush();

    expect(rec.transactions).toBe(0);
    expect(rec.inserted).toHaveLength(0);
  });
});
