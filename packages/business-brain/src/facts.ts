import { and, eq } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import {
  businessProfiles,
  products,
  services,
  faqs,
  policies,
  competitors,
  customerPersonas,
} from '@brandpilot/db';

type BusinessProfilePatch = Partial<typeof businessProfiles.$inferInsert>;

/**
 * Structured-knowledge accessors (Business Brain Layer 1). Thin, typed, org-scoped
 * helpers so modules read precise facts without touching Brain tables directly.
 */
export function createFacts(db: Database) {
  return {
    async getBusinessProfile(orgId: string) {
      const [row] = await db
        .select()
        .from(businessProfiles)
        .where(eq(businessProfiles.orgId, orgId))
        .limit(1);
      return row ?? null;
    },

    async upsertBusinessProfile(orgId: string, patch: BusinessProfilePatch) {
      const [row] = await db
        .insert(businessProfiles)
        .values({ ...patch, orgId })
        .onConflictDoUpdate({
          target: businessProfiles.orgId,
          set: { ...patch, updatedAt: new Date() },
        })
        .returning();
      return row ?? null;
    },

    listServices(orgId: string) {
      return db
        .select()
        .from(services)
        .where(and(eq(services.orgId, orgId), eq(services.active, true)));
    },

    listProducts(orgId: string) {
      return db
        .select()
        .from(products)
        .where(and(eq(products.orgId, orgId), eq(products.active, true)));
    },

    /** Only APPROVED FAQs are usable by customer-facing modules. */
    listApprovedFaqs(orgId: string) {
      return db
        .select()
        .from(faqs)
        .where(and(eq(faqs.orgId, orgId), eq(faqs.approved, true)));
    },

    listPolicies(orgId: string) {
      return db.select().from(policies).where(eq(policies.orgId, orgId));
    },

    /**
     * Competitor intel synthesized during discovery. INTERNAL strategy knowledge
     * (positioning, strengths, weaknesses) — consumed by planning/strategy
     * workflows, never routed into the customer-facing grounding pool.
     */
    listCompetitors(orgId: string) {
      return db.select().from(competitors).where(eq(competitors.orgId, orgId));
    },

    /**
     * Customer personas synthesized from discovery + audience analysis (goals,
     * pain points, buying triggers). Consumed by content/strategy planning to
     * target the real audience, not just segment names.
     */
    listPersonas(orgId: string) {
      return db.select().from(customerPersonas).where(eq(customerPersonas.orgId, orgId));
    },
  };
}

export type Facts = ReturnType<typeof createFacts>;
