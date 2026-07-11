import { describe, expect, it } from 'vitest';
import { leadSourceForChannel, shouldAutoSend } from './conversation-engine';

/**
 * `leadSourceForChannel` maps an inbound conversation channel to the CRM lead
 * `source` enum used when the conversation engine auto-creates a lead on first
 * contact. Pure and total — every string resolves to a valid enum value.
 */
describe('leadSourceForChannel', () => {
  it('maps comment channels to the comment source', () => {
    expect(leadSourceForChannel('comment')).toBe('comment');
    expect(leadSourceForChannel('instagram_comment')).toBe('comment');
  });

  it('maps the exact channel strings the Meta/WhatsApp webhook parser emits', () => {
    // Contract with apps/api/src/webhooks/meta-payload.ts — these are the wire
    // values, so comment automation lands leads with source='comment', not 'dm'.
    expect(leadSourceForChannel('fb_comment')).toBe('comment');
    expect(leadSourceForChannel('ig_comment')).toBe('comment');
    expect(leadSourceForChannel('messenger')).toBe('dm');
    expect(leadSourceForChannel('whatsapp')).toBe('dm');
  });

  it('maps form / web channels to the form source', () => {
    expect(leadSourceForChannel('form')).toBe('form');
    expect(leadSourceForChannel('web')).toBe('form');
  });

  it('defaults DMs and unknown channels to dm', () => {
    expect(leadSourceForChannel('dm')).toBe('dm');
    expect(leadSourceForChannel('instagram')).toBe('dm');
    expect(leadSourceForChannel('facebook')).toBe('dm');
    expect(leadSourceForChannel('')).toBe('dm');
  });
});

/**
 * `shouldAutoSend` gates auto-DELIVERY of AI replies: only fully-autonomous
 * modes send; observe/suggest (and anything unexpected) draft for owner review.
 */
describe('shouldAutoSend', () => {
  it('auto modes deliver replies automatically', () => {
    expect(shouldAutoSend('auto_scoped')).toBe(true);
    expect(shouldAutoSend('auto_broad')).toBe(true);
  });

  it('observe / suggest / unknown modes draft for review (no auto-send)', () => {
    expect(shouldAutoSend('suggest')).toBe(false);
    expect(shouldAutoSend('observe')).toBe(false);
    expect(shouldAutoSend('')).toBe(false);
    expect(shouldAutoSend('auto')).toBe(false); // web alias is normalized to auto_scoped upstream
  });
});
