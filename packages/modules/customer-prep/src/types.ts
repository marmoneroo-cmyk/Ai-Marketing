/** Structured pre-meeting briefing the model returns (parsed defensively; never throws). */
export interface Briefing {
  summary: string;
  businessSummary: string;
  interests: string[];
  talkingPoints: string[];
  intentEstimate: number;
}

/** Minimal facts about the contact fed into the briefing prompt. */
export interface BriefingContext {
  name: string;
  recentMessages: string[];
  grounding: string;
}

export interface BriefingResult {
  summary: string;
  talkingPoints: string[];
}
