import type IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { loadEnv, resolvePlanCaps, type Env } from '@brandpilot/config';
import { createDb, organizations, type Database } from '@brandpilot/db';
import { BusinessBrain, VoyageEmbedder } from '@brandpilot/business-brain';
import { AgentRuntime, AnthropicLlmClient } from '@brandpilot/agent-runtime';
import { scrapeUrl, renderImage } from '@brandpilot/connectors';
import { DiscoveryEngine } from '@brandpilot/discovery';
import { BrandIntelligence } from '@brandpilot/brand-intelligence';
import { AudienceIntelligence } from '@brandpilot/audience-intelligence';
import { ContentEngine } from '@brandpilot/content-engine';
import { CreativeStudio } from '@brandpilot/creative-studio';
import { PublishingEngine } from '@brandpilot/publishing';
import { ConversationEngine } from '@brandpilot/conversation';
import { SalesEngine } from '@brandpilot/sales';
import { CustomerPrep } from '@brandpilot/customer-prep';
import { AnalyticsEngine } from '@brandpilot/analytics';
import { OptimizationEngine } from '@brandpilot/optimization';
import { AutomationEngine } from '@brandpilot/automation';
import { buildActionRegistry } from './actions';
import { createRedisConnection } from './redis';
import { RedisCache } from './redis-cache';
import { RedisSpendGuard, type SpendLimits } from './redis-spend-guard';
import { createProducers, type Producers } from './queues';
import { logger } from '@brandpilot/observability';

/**
 * How long a resolved org's plan limits are trusted before re-querying. Plan
 * changes are rare (a manual/billing-driven event, not a hot path), so a
 * coarse 5-minute per-process cache trades a little staleness for avoiding a
 * DB round-trip on every single SpendGuard.consume call.
 */
const PLAN_LIMITS_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Bounded cap on the plan-limits cache's distinct-org entries. Without this,
 * a long-lived worker process accumulates one entry per orgId it has ever
 * seen, for the lifetime of the process — a slow, unbounded memory leak at
 * scale. Eviction below is insertion-order (oldest-inserted-key-first), not
 * strict LRU, which is a deliberate simplicity/cost tradeoff.
 */
const MAX_PLAN_CACHE_ENTRIES = 5000;

/** The two columns `buildPlanLimitsResolver` actually reads off an org row. */
type OrgPlanRow = Pick<
  NonNullable<Awaited<ReturnType<Database['query']['organizations']['findFirst']>>>,
  'plan' | 'settings'
>;

/**
 * Narrow structural slice of {@link Database} that {@link buildPlanLimitsResolver}
 * actually needs — a `findFirst` callable at exactly the `{ where, columns: {
 * plan: true, settings: true } }` shape this code uses. Exported as a named
 * type (rather than inlining `Database`) so tests can pass a minimal fake
 * `db` without constructing a real drizzle client. `Database`'s `findFirst`
 * is generic; this pins it to one concrete instantiation, which `Database`
 * itself satisfies at this call site — not a behavior change.
 */
export type OrganizationsReader = {
  query: {
    organizations: {
      findFirst: (config: {
        where: ReturnType<typeof eq>;
        columns: { plan: true; settings: true };
      }) => Promise<OrgPlanRow | undefined>;
    };
  };
};

/**
 * Build the `resolveLimits` callback wired into {@link RedisSpendGuard}: one
 * query for the org's `plan` + `settings`, mapped through {@link resolvePlanCaps}
 * to the two SpendGuard-metered kinds, memoized per org in a plain in-process
 * `Map` with a TTL. This cache is intentionally NOT shared across worker
 * processes/instances — each process re-populates its own on first use, which
 * is fine given how infrequently plans change.
 *
 * Exported so tests can exercise the cache/eviction/error-logging behavior
 * directly against a fake {@link OrganizationsReader} instead of a real DB.
 */
export function buildPlanLimitsResolver(db: OrganizationsReader): (orgId: string) => Promise<SpendLimits> {
  const cache = new Map<string, { limits: SpendLimits; expiresAt: number }>();

  return async (orgId: string): Promise<SpendLimits> => {
    const cached = cache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.limits;
    }

    let org: Awaited<ReturnType<OrganizationsReader['query']['organizations']['findFirst']>>;
    try {
      org = await db.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
        columns: { plan: true, settings: true },
      });
    } catch (err: unknown) {
      // Fail closed: the caller (RedisSpendGuard.consume, via SpendGuard)
      // must see this rejection and refuse the spend rather than silently
      // falling back to a default cap. Log WHY before rethrowing, since an
      // unlogged rejection here previously surfaced only as an opaque
      // downstream job failure.
      logger.error({ err, orgId }, 'plan limits resolution failed; job will fail closed');
      throw err;
    }

    const caps = resolvePlanCaps(org?.plan ?? 'free', org?.settings);
    const limits: SpendLimits = { llm: caps.dailyLlmCalls, media: caps.dailyMediaCalls };

    // Bounded-memory eviction: once at capacity, drop the oldest-inserted
    // entry before adding the new one (Map preserves insertion order).
    if (cache.size >= MAX_PLAN_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) {
        cache.delete(oldestKey);
      }
    }
    cache.set(orgId, { limits, expiresAt: Date.now() + PLAN_LIMITS_CACHE_TTL_MS });
    return limits;
  };
}

export interface WorkerContext {
  env: Env;
  db: Database;
  connection: IORedis;
  producers: Producers;
  brain: BusinessBrain;
  runtime: AgentRuntime;
  discovery: DiscoveryEngine;
  brand: BrandIntelligence;
  audience: AudienceIntelligence;
  content: ContentEngine;
  creative: CreativeStudio;
  publishing: PublishingEngine;
  conversation: ConversationEngine;
  sales: SalesEngine;
  prep: CustomerPrep;
  analytics: AnalyticsEngine;
  optimization: OptimizationEngine;
  automation: AutomationEngine;
}

/** Compose the whole dependency graph — every module shares one Brain + Runtime. */
export function buildContext(): WorkerContext {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);

  // Shared Redis connection + producer queues. The signal bridge below and the
  // scheduler both publish through these, so the whole write side rides one
  // connection that shutdown can close deterministically.
  const connection = createRedisConnection();
  const producers = createProducers(connection);

  // Performance + cost seams, both riding the shared Redis connection: a
  // read-through cache for hot Brain reads and a per-org daily spend meter.
  // The spend meter's limits are plan-aware: `buildPlanLimitsResolver` maps
  // each org's plan (+ settings override) to its daily LLM/media ceilings.
  const cache = new RedisCache(connection);
  const spendGuard = new RedisSpendGuard(connection, buildPlanLimitsResolver(db));

  const embedder = new VoyageEmbedder(env.VOYAGE_API_KEY);

  // Signal → automation bridge: EVERY signal the Brain durably records is
  // fanned out as an `automation.signal` job. Fire-and-forget — the sink must
  // never block or throw inside `recordSignal` (BusinessBrain already guards it,
  // and `void` drops the returned promise here too).
  const brain = new BusinessBrain({
    db,
    embedder,
    cache,
    signalSink: (orgId, signal) => {
      producers.automationSignal
        .add('signal', {
          orgId,
          signal: {
            type: signal.type,
            ...(signal.payload === undefined ? {} : { payload: signal.payload }),
          },
        })
        .catch((err: unknown) => logger.warn({ err, orgId }, 'automation signal enqueue failed'));
    },
  });

  const llm = new AnthropicLlmClient(env.ANTHROPIC_API_KEY);
  const runtime = new AgentRuntime({ brain, llm, spendGuard });

  const discovery = new DiscoveryEngine({ db, brain, runtime, scrapeUrl });
  const brand = new BrandIntelligence({ db, brain, runtime });
  const audience = new AudienceIntelligence({ db, brain, runtime });
  const content = new ContentEngine({ db, brain, runtime });
  const creative = new CreativeStudio({ db, brain, runtime, renderImage, spendGuard });
  const publishing = new PublishingEngine({ db, brain });
  const conversation = new ConversationEngine({ db, brain, runtime });
  const sales = new SalesEngine({ db, brain, runtime });
  const prep = new CustomerPrep({ db, brain, runtime });
  const analytics = new AnalyticsEngine({ db });
  const optimization = new OptimizationEngine({ db, runtime });

  const automation = new AutomationEngine({
    db,
    actions: buildActionRegistry({ content, sales, prep, brand, audience, optimization, creative }),
  });

  return {
    env,
    db,
    connection,
    producers,
    brain,
    runtime,
    discovery,
    brand,
    audience,
    content,
    creative,
    publishing,
    conversation,
    sales,
    prep,
    analytics,
    optimization,
    automation,
  };
}
