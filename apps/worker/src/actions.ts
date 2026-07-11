import type { ActionHandler } from '@brandpilot/automation';
import type { PublishPlatform } from '@brandpilot/core';
import type { ContentEngine } from '@brandpilot/content-engine';
import type { SalesEngine } from '@brandpilot/sales';
import type { CustomerPrep } from '@brandpilot/customer-prep';
import type { BrandIntelligence } from '@brandpilot/brand-intelligence';
import type { AudienceIntelligence } from '@brandpilot/audience-intelligence';
import type { OptimizationEngine } from '@brandpilot/optimization';
import type { CreativeStudio, CreativeKind } from '@brandpilot/creative-studio';

export interface ActionEngines {
  content: ContentEngine;
  sales: SalesEngine;
  prep: CustomerPrep;
  brand: BrandIntelligence;
  audience: AudienceIntelligence;
  optimization: OptimizationEngine;
  creative: CreativeStudio;
}

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

const CREATIVE_KINDS: readonly CreativeKind[] = ['image', 'carousel', 'story', 'cover', 'thumbnail', 'ad'];

/** Narrow untrusted workflow input to a CreativeKind, defaulting to `image`. */
const asCreativeKind = (v: unknown): CreativeKind =>
  CREATIVE_KINDS.includes(v as CreativeKind) ? (v as CreativeKind) : 'image';

/**
 * The Automation Engine is decoupled from the domain modules — it executes
 * workflow steps by action NAME. This registry binds those names to the real
 * module methods, so a workflow like
 *   comment → conversation.reply → sales.qualify → prep.briefing
 * runs end-to-end without the engine importing any module.
 */
export function buildActionRegistry(e: ActionEngines): Record<string, ActionHandler> {
  return {
    'brand.voice': async ({ orgId }) => {
      await e.brand.computeVoiceProfile(orgId);
      return {};
    },
    'audience.segments': async ({ orgId }) => ({ ...(await e.audience.buildPersonasAndSegments(orgId)) }),
    'content.weekly_plan': async ({ orgId }) => ({
      // Full autonomous run (plan + per-platform variants), identical to the
      // on-demand content worker — so scheduled weekly plans produce approvable
      // drafts, not empty content items.
      ...(await e.content.generateWeeklyPlanWithVariants(orgId, new Date())),
    }),
    'content.variant': async ({ orgId, input }) => ({
      ...(await e.content.generateVariant(
        orgId,
        asString(input.contentItemId),
        asString(input.platform) as PublishPlatform,
      )),
    }),
    'sales.qualify': async ({ orgId, input }) => ({ ...(await e.sales.qualifyLead(orgId, asString(input.leadId))) }),
    'sales.proposal': async ({ orgId, input }) => ({
      ...(await e.sales.buildProposalAndQuote(orgId, asString(input.leadId))),
    }),
    'prep.briefing': async ({ orgId, input }) => ({ ...(await e.prep.buildBriefing(orgId, asString(input.contactId))) }),
    'optimization.analyze': async ({ orgId }) => ({ ...(await e.optimization.analyze(orgId)) }),
    'creative.generate': async ({ orgId, input }) => ({
      ...(await e.creative.generateForContentItem(
        orgId,
        String(input.contentItemId),
        asCreativeKind(input.kind),
      )),
    }),
  };
}
