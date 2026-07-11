import type { Connector } from './types';
import { MetaConnector } from './meta';
import { TikTokConnector } from './tiktok';
import { WhatsAppConnector } from './whatsapp';

/**
 * Pick the provider-specific {@link Connector} for a social account's provider.
 * Publishing/pulling must use the account's OWN connector — e.g. a TikTok post
 * cannot be published through the Meta Graph API. Instagram + Facebook are both
 * served by the Meta connector; unknown providers fall back to Meta (the only
 * providers with scheduled posts today are instagram/facebook/tiktok/whatsapp).
 */
export function createConnector(provider: string): Connector {
  switch (provider) {
    case 'tiktok':
      return new TikTokConnector();
    case 'whatsapp':
      return new WhatsAppConnector();
    case 'instagram':
    case 'facebook':
    default:
      return new MetaConnector();
  }
}
