import type { Connector } from '@brandpilot/connectors';

export interface DiscoverySources {
  websiteUrl?: string;
  social?: {
    provider: string;
    accountId: string;
    accessToken: string;
    connector: Connector;
  };
}

export interface DnaResult {
  runId: string;
  profile: {
    description: string;
    mission: string;
    usp: string;
    categories: string[];
  };
  personaCount: number;
  competitorCount: number;
  knowledgeDocs: number;
}

/** Structured Business DNA synthesized from the ingested corpus. */
export interface SynthesizedDna {
  description: string;
  mission: string;
  vision: string;
  usp: string;
  categories: string[];
  personas: Array<{
    name: string;
    demographics?: Record<string, unknown>;
    goals?: string[];
    painPoints?: string[];
    buyingTriggers?: string[];
    objections?: string[];
    channels?: string[];
  }>;
  competitors: Array<{
    name: string;
    positioning?: string;
    strengths?: string[];
    weaknesses?: string[];
  }>;
}
