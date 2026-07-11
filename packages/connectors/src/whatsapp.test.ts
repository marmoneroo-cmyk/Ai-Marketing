import { describe, test, expect } from 'vitest';
import { buildTextMessage } from './whatsapp';

describe('buildTextMessage', () => {
  test('builds a well-formed WhatsApp Cloud text message body', () => {
    // Arrange
    const to = '15551234567';
    const body = 'Hello from BrandPilot';

    // Act
    const message = buildTextMessage(to, body);

    // Assert
    expect(message).toEqual({
      messaging_product: 'whatsapp',
      to: '15551234567',
      type: 'text',
      text: { body: 'Hello from BrandPilot' },
    });
  });

  test('always sets messaging_product to whatsapp and type to text', () => {
    const message = buildTextMessage('4915112345678', 'hi');

    expect(message.messaging_product).toBe('whatsapp');
    expect(message.type).toBe('text');
  });

  test('preserves the recipient msisdn verbatim', () => {
    const to = '+15551230000';

    const message = buildTextMessage(to, 'ping');

    expect(message.to).toBe('+15551230000');
  });

  test('nests the message text under text.body', () => {
    const body = 'multi\nline\nmessage';

    const message = buildTextMessage('15551234567', body);

    expect(message.text.body).toBe('multi\nline\nmessage');
  });

  test('preserves an empty body without throwing', () => {
    const message = buildTextMessage('15551234567', '');

    expect(message.text.body).toBe('');
  });
});
