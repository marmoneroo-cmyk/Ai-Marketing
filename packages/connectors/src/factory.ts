import type { Connector } from './types';
import { MetaConnector } from './meta';
import { InstagramLoginConnector } from './instagram';
import { TikTokConnector } from './tiktok';
import { WhatsAppConnector } from './whatsapp';

/**
 * Pick the provider-specific {@link Connector} for a social account's provider.
 * Publishing/pulling/audience-reads must use the account's OWN connector — e.g.
 * a TikTok post cannot be published through the Meta Graph API.
 *
 * `instagram` uses {@link InstagramLoginConnector} — the app connects Instagram
 * via "Instagram API with Instagram Login" (graph.instagram.com, its own
 * app credentials; see connectors.controller `getInstagramCallback`), NOT the
 * Facebook Graph path. Routing it to MetaConnector was a latent bug: it silently
 * skipped follower reads (only InstagramLoginConnector implements
 * `fetchAudience`) and would publish IG posts through the wrong API/host with an
 * Instagram-Login token. `facebook` (and any unknown fallback) stays on Meta.
 */
export function createConnector(provider: string): Connector {
  switch (provider) {
    case 'tiktok':
      return new TikTokConnector();
    case 'whatsapp':
      return new WhatsAppConnector();
    case 'instagram':
      return new InstagramLoginConnector();
    case 'facebook':
    default:
      return new MetaConnector();
  }
}
