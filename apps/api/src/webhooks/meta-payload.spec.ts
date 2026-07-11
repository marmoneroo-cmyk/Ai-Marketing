import { describe, expect, it } from 'vitest';
import { parseMetaWebhook } from './meta-payload';

/**
 * The parser maps raw Meta/WhatsApp webhook payloads to inbound records. Critical
 * invariant: a DM's thread id is the PERSON (sender), never the message —
 * `mid`/`message.id` is unique per message, so using it as the thread would open a
 * new conversation for every DM. Those ids become `messageExternalId`, which the
 * engine uses to dedup at-least-once webhook redelivery.
 */
describe('parseMetaWebhook', () => {
  it('threads Messenger DMs by sender (not mid) and captures mid as the dedup id', () => {
    const body = {
      entry: [
        {
          id: 'page_1',
          messaging: [
            { sender: { id: 'psid_42' }, message: { mid: 'mid_A', text: 'hi' } },
            { sender: { id: 'psid_42' }, message: { mid: 'mid_B', text: 'still there?' } },
          ],
        },
      ],
    };
    const recs = parseMetaWebhook(body, 'meta');

    expect(recs).toHaveLength(2);
    // Both messages from psid_42 share ONE thread (previously mid_A vs mid_B → two).
    expect(recs[0]?.externalThreadId).toBe('psid_42');
    expect(recs[1]?.externalThreadId).toBe('psid_42');
    expect(recs[0]?.messageExternalId).toBe('mid_A');
    expect(recs[1]?.messageExternalId).toBe('mid_B');
    expect(recs[0]?.channel).toBe('messenger');
  });

  it('threads WhatsApp by sender number, with message.id as the dedup id', () => {
    const body = {
      entry: [
        {
          id: 'waba_1',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: 'pnid_9' },
                contacts: [{ profile: { name: 'Ava' } }],
                messages: [{ from: '15551234', id: 'wamid_1', text: { body: 'hello' } }],
              },
            },
          ],
        },
      ],
    };
    const recs = parseMetaWebhook(body, 'whatsapp');

    expect(recs).toHaveLength(1);
    expect(recs[0]?.externalThreadId).toBe('15551234'); // sender phone, not message id
    expect(recs[0]?.messageExternalId).toBe('wamid_1');
    expect(recs[0]?.channel).toBe('whatsapp');
  });

  it('threads a comment by comment id (its own dedup id)', () => {
    const body = {
      entry: [
        {
          id: 'page_1',
          changes: [
            {
              field: 'comments',
              value: {
                comment_id: 'cmt_7',
                message: 'love this',
                from: { username: 'fan', name: 'Fan' },
              },
            },
          ],
        },
      ],
    };
    const recs = parseMetaWebhook(body, 'meta');

    expect(recs).toHaveLength(1);
    expect(recs[0]?.externalThreadId).toBe('cmt_7');
    expect(recs[0]?.messageExternalId).toBe('cmt_7');
    expect(recs[0]?.channel).toBe('fb_comment');
  });

  it('drops events with no sender/thread id or empty body', () => {
    const body = {
      entry: [
        {
          id: 'page_1',
          messaging: [
            { sender: {}, message: { mid: 'mid_x', text: 'no sender' } }, // no sender → no thread
            { sender: { id: 'psid_1' }, message: { mid: 'mid_y', text: '  ' } }, // empty body
          ],
        },
      ],
    };
    expect(parseMetaWebhook(body, 'meta')).toEqual([]);
  });
});
