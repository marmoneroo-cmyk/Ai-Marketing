import { describe, expect, it } from 'vitest';
import { createConnector } from './factory';
import { MetaConnector } from './meta';
import { InstagramLoginConnector } from './instagram';
import { TikTokConnector } from './tiktok';
import { WhatsAppConnector } from './whatsapp';

describe('createConnector', () => {
  it('routes instagram to the Instagram Login connector (NOT Meta)', () => {
    // Regression guard: the app connects Instagram via Instagram Login, so its
    // account must resolve to InstagramLoginConnector — otherwise follower reads
    // (fetchAudience) are skipped and publishing uses the wrong API/host.
    const connector = createConnector('instagram');
    expect(connector).toBeInstanceOf(InstagramLoginConnector);
    expect(typeof connector.fetchAudience).toBe('function');
  });

  it('routes facebook to the Meta connector', () => {
    expect(createConnector('facebook')).toBeInstanceOf(MetaConnector);
  });

  it('routes tiktok and whatsapp to their own connectors', () => {
    expect(createConnector('tiktok')).toBeInstanceOf(TikTokConnector);
    expect(createConnector('whatsapp')).toBeInstanceOf(WhatsAppConnector);
  });

  it('falls back to Meta for an unknown provider', () => {
    expect(createConnector('linkedin')).toBeInstanceOf(MetaConnector);
  });
});
