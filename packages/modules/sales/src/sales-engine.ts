import { and, eq } from 'drizzle-orm';
import type { Database } from '@brandpilot/db';
import {
  appointments,
  approvals,
  contacts,
  deals,
  leads,
  offers,
  organizations,
  paymentLinks,
  proposals,
  quotes,
} from '@brandpilot/db';
import { resolvePlanCaps } from '@brandpilot/config';
import type { BusinessBrain } from '@brandpilot/business-brain';
import type { AgentRuntime } from '@brandpilot/agent-runtime';
import type {
  BookAppointmentResult,
  PaymentLinkResult,
  ProposalQuoteResult,
  QualifyLeadResult,
} from './types';
import {
  buildProposalPrompt,
  buildQualifyPrompt,
  computeTotals,
  parseProposalDraft,
  parseQualification,
  toMoneyString,
} from './sales-generation';

/** Score at or above which a lead is considered qualified (else nurturing). */
const QUALIFIED_THRESHOLD = 0.6;

export interface SalesEngineDeps {
  db: Database;
  brain: BusinessBrain;
  runtime: AgentRuntime;
}

/** Injected payment-provider adapter — a concrete Stripe adapter is a later increment. */
export type CreatePaymentLink = (
  amount: number,
  currency: string,
) => Promise<{ id: string; url: string }>;

/**
 * Module — the sales operator. Qualifies inbound leads, drafts grounded proposals
 * and itemized quotes from the Business Brain's offering catalogue, mints payment
 * links through an injected provider adapter, and books appointments. Everything is
 * org-scoped and every material action is recorded as an episodic signal.
 */
export class SalesEngine {
  private readonly deps: SalesEngineDeps;

  constructor(deps: SalesEngineDeps) {
    this.deps = deps;
  }

  /** Score an inbound lead and set its pipeline status; records a `lead_qualified` signal. */
  async qualifyLead(orgId: string, leadId: string): Promise<QualifyLeadResult> {
    const { db, brain, runtime } = this.deps;

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
      .limit(1);
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    let contactName = '';
    let contactEmail = '';
    if (lead.contactId) {
      const [contact] = await db
        .select({ name: contacts.name, email: contacts.email })
        .from(contacts)
        .where(and(eq(contacts.id, lead.contactId), eq(contacts.orgId, orgId)))
        .limit(1);
      contactName = contact?.name ?? '';
      contactEmail = contact?.email ?? '';
    }

    // Ground lead-fit scoring in the business's ICP + offering catalogue —
    // without this, qualification only ever sees the lead's own fields and has
    // zero knowledge of who the business serves or what it sells.
    const [personas, services, products] = await Promise.all([
      brain.facts.listPersonas(orgId),
      brain.facts.listServices(orgId),
      brain.facts.listProducts(orgId),
    ]);

    const prompt = buildQualifyPrompt({
      name: contactName,
      email: contactEmail,
      source: lead.source ?? '',
      status: lead.status,
      notes: '',
      personas: personas.map((p) => p.name).filter((n): n is string => typeof n === 'string'),
      services: services.map((s) => s.name).filter((n): n is string => typeof n === 'string'),
      products: products.map((p) => p.name).filter((n): n is string => typeof n === 'string'),
    });

    const result = await runtime.run({
      orgId,
      actorId: 'sales',
      task: 'summary',
      prompt,
      groundingQuery: 'Ideal customer profile, target personas, and services/products offered',
    });
    const judgement = parseQualification(result.output);
    const status = judgement.score >= QUALIFIED_THRESHOLD ? 'qualified' : 'nurturing';

    await db
      .update(leads)
      .set({ score: toScoreString(judgement.score), status })
      .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)));

    await brain.recordSignal(orgId, {
      type: 'lead_qualified',
      subjectType: 'lead',
      subjectId: leadId,
      payload: { score: judgement.score, status },
      value: judgement.score,
    });

    return { score: judgement.score, status };
  }

  /** Draft a proposal + itemized quote for a lead from the offering catalogue. */
  async buildProposalAndQuote(orgId: string, leadId: string): Promise<ProposalQuoteResult> {
    const { db, brain, runtime } = this.deps;

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, leadId), eq(leads.orgId, orgId)))
      .limit(1);
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    // Idempotency: if this lead already has an OPEN deal, a proposal was already
    // built for it. A retry/re-fire of the qualify automation must NOT create a
    // duplicate proposal/quote/deal — duplicate open deals double the CRM pipeline
    // and the `openPipeline` KPI (/leads/summary). Return the existing value.
    const [existingDeal] = await db
      .select({ amount: deals.amount })
      .from(deals)
      .where(and(eq(deals.orgId, orgId), eq(deals.leadId, leadId), eq(deals.status, 'open')))
      .limit(1);
    if (existingDeal) {
      return { proposalId: '', quoteId: '', total: Number(existingDeal.amount ?? 0), needsApproval: false };
    }

    const [services, products, activeOffers, orgRows] = await Promise.all([
      brain.facts.listServices(orgId),
      brain.facts.listProducts(orgId),
      db.select({ name: offers.name }).from(offers).where(eq(offers.orgId, orgId)),
      db
        .select({ plan: organizations.plan, settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1),
    ]);
    // Effective auto-finalize ceiling: the org's plan → its configured
    // override (`settings.caps.maxQuoteValue`). Keeps the enforced ceiling in
    // lockstep with what the owner sees on Settings — display == enforcement,
    // now resolved per plan instead of a single global default.
    const maxQuoteValue = resolvePlanCaps(
      orgRows[0]?.plan ?? 'free',
      orgRows[0]?.settings,
    ).maxQuoteValue;

    const prompt = buildProposalPrompt({
      services: services.map((s) => s.name).filter((n): n is string => typeof n === 'string'),
      products: products.map((p) => p.name).filter((n): n is string => typeof n === 'string'),
      offers: activeOffers.map((o) => o.name).filter((n): n is string => typeof n === 'string'),
    });

    // Ground pricing + policy in approved knowledge so quoted figures and terms
    // are anchored to real offerings, not the model's priors.
    const result = await runtime.run({
      orgId,
      actorId: 'sales',
      task: 'strategy',
      prompt,
      groundingQuery: 'Pricing, rates, discounts, and quote/proposal policy for services and products',
      // Quotes/proposals are sent to the buyer — force the guardrail screen +
      // confidence-escalation gate even though `strategy` is otherwise internal.
      customerFacing: true,
    });
    const draft = parseProposalDraft(result.output);
    const { subtotal, total } = computeTotals(draft.lineItems);

    const [proposalRow] = await db
      .insert(proposals)
      .values({
        orgId,
        ...(lead.contactId ? { contactId: lead.contactId } : {}),
        body: { sections: draft.sections },
        status: 'draft',
      })
      .returning();

    const proposalId = proposalRow?.id ?? '';

    const [quoteRow] = await db
      .insert(quotes)
      .values({
        orgId,
        ...(proposalId ? { proposalId } : {}),
        lineItems: draft.lineItems,
        subtotal: toMoneyString(subtotal),
        total: toMoneyString(total),
        status: 'draft',
      })
      .returning();

    const quoteId = quoteRow?.id ?? '';

    // Open a pipeline deal for this opportunity so the CRM pipeline + KPIs
    // (leads "open pipeline", /leads/summary) reflect the quote. Previously no
    // code ever created a deal, so pipeline value was always 0.
    await db.insert(deals).values({
      orgId,
      leadId: lead.id,
      title: 'Proposal',
      amount: toMoneyString(total),
      status: 'open',
    });

    // High-value quotes must never auto-finalize: route to a human approval. The
    // ceiling is the org's configured cap (Settings), not a hardcoded default.
    const needsApproval = total > maxQuoteValue;
    if (needsApproval && quoteId) {
      await db.insert(approvals).values({
        orgId,
        kind: 'quote',
        targetType: 'quote',
        targetId: quoteId,
        requestedBy: 'sales',
        summary: `Quote total ${toMoneyString(total)} exceeds auto-finalize cap ${toMoneyString(maxQuoteValue)}; requires human review.${
          result.citedChunkIds.length > 0 ? ` Citations: ${result.citedChunkIds.join(', ')}.` : ''
        }`,
        status: 'pending',
      });
    }

    return { proposalId, quoteId, total, needsApproval };
  }

  /** Mint a payment link for a quote through the injected provider adapter. */
  async createPaymentLink(
    orgId: string,
    quoteId: string,
    createLink: CreatePaymentLink,
  ): Promise<PaymentLinkResult> {
    const { db } = this.deps;

    const [quote] = await db
      .select({ total: quotes.total, currency: quotes.currency })
      .from(quotes)
      .where(and(eq(quotes.id, quoteId), eq(quotes.orgId, orgId)))
      .limit(1);
    if (!quote) throw new Error(`Quote ${quoteId} not found`);

    const currency = quote.currency ?? 'usd';
    const amount = Number(quote.total ?? '0');
    const link = await createLink(amount, currency);

    await db.insert(paymentLinks).values({
      orgId,
      quoteId,
      externalId: link.id,
      url: link.url,
      amount: toMoneyString(amount),
      currency,
      status: 'created',
    });

    return { url: link.url };
  }

  /** Book an appointment; records an `appointment_booked` signal. */
  async bookAppointment(
    orgId: string,
    input: {
      contactId?: string;
      leadId?: string;
      serviceId?: string;
      startsAt: Date;
      endsAt?: Date;
    },
  ): Promise<BookAppointmentResult> {
    const { db, brain } = this.deps;

    const [appointment] = await db
      .insert(appointments)
      .values({
        orgId,
        ...(input.contactId ? { contactId: input.contactId } : {}),
        ...(input.leadId ? { leadId: input.leadId } : {}),
        ...(input.serviceId ? { serviceId: input.serviceId } : {}),
        startsAt: input.startsAt,
        ...(input.endsAt ? { endsAt: input.endsAt } : {}),
        status: 'booked',
      })
      .returning();

    const appointmentId = appointment?.id ?? '';

    await brain.recordSignal(orgId, {
      type: 'appointment_booked',
      subjectType: 'appointment',
      ...(appointmentId ? { subjectId: appointmentId } : {}),
      // Thread contact/lead ids so the "Pre-meeting briefing" automation
      // (appointment_booked → prep.briefing) receives the contactId it needs.
      payload: {
        startsAt: input.startsAt.toISOString(),
        ...(input.contactId ? { contactId: input.contactId } : {}),
        ...(input.leadId ? { leadId: input.leadId } : {}),
      },
    });

    return { appointmentId };
  }
}

/** Format a [0,1] score as a fixed-scale string for the `leads.score` numeric column. */
function toScoreString(score: number): string {
  return score.toFixed(3);
}
