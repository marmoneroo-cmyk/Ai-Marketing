/** Structured lead-qualification judgement the model returns (parsed defensively). */
export interface LeadQualification {
  score: number;
  reasoning: string;
}

/** A single proposal/quote line item the model proposes. */
export interface ProposalLineItem {
  name: string;
  qty: number;
  unitPrice: number;
}

/** Structured proposal + quote draft the model returns for a lead. */
export interface ProposalDraft {
  sections: string[];
  lineItems: ProposalLineItem[];
}

/** Minimal facts about the business fed into the proposal prompt. */
export interface ProposalContext {
  services: string[];
  products: string[];
  offers: string[];
}

export interface QualifyLeadResult {
  score: number;
  status: string;
}

export interface ProposalQuoteResult {
  proposalId: string;
  quoteId: string;
  total: number;
  /** True when the quote total exceeds the auto-finalize cap and needs human review. */
  needsApproval: boolean;
}

export interface PaymentLinkResult {
  url: string;
}

export interface BookAppointmentResult {
  appointmentId: string;
}
