import { describe, expect, it } from 'vitest';
import {
  buildTrackingLinks,
  createTrackingId,
  decorateEmailBodies,
  isTrackingId,
  normalizeMessageId,
} from '../../src/domain/tracking';

describe('tracking domain', () => {
  it('creates opaque tracking ids', () => {
    const id = createTrackingId();
    expect(id).toMatch(/^trk_[A-Za-z0-9_-]{16,64}$/);
    expect(isTrackingId(id)).toBe(true);
    expect(isTrackingId('not-a-tracking-id')).toBe(false);
  });

  it('builds links only for enabled channels', () => {
    const both = buildTrackingLinks('https://track.example.test/', 'trk_abc', {
      pixelEnabled: true,
      acknowledgementEnabled: true,
    });
    expect(both.openUrl).toBe('https://track.example.test/t/open/trk_abc');
    expect(both.acknowledgeUrl).toBe('https://track.example.test/t/ack/trk_abc');

    const ackOnly = buildTrackingLinks('https://track.example.test', 'trk_abc', {
      pixelEnabled: false,
      acknowledgementEnabled: true,
    });
    expect(ackOnly.openUrl).toBeNull();
    expect(ackOnly.acknowledgeUrl).toBe('https://track.example.test/t/ack/trk_abc');
  });

  it('decorates HTML and text with a tracking footer, acknowledgement link, and pixel', () => {
    const result = decorateEmailBodies({
      html: '<p>Hello</p>',
      text: 'Hello',
      trackingId: 'trk_abc',
      links: {
        openUrl: 'https://track.example.test/t/open/trk_abc',
        acknowledgeUrl: 'https://track.example.test/t/ack/trk_abc',
      },
    });

    expect(result.html).toContain('Tracking ID:');
    expect(result.html).toContain('trk_abc');
    expect(result.html).toContain('Confirm receipt of this email');
    expect(result.html).toContain('<img');
    expect(result.html).toContain('/t/open/trk_abc');
    expect(result.text).toContain('Tracking ID: trk_abc');
    expect(result.text).toContain('Confirm receipt: https://track.example.test/t/ack/trk_abc');
  });

  it('leaves bodies unchanged when no tracking channel is enabled', () => {
    const result = decorateEmailBodies({
      html: '<p>Hello</p>',
      text: 'Hello',
      trackingId: 'trk_abc',
      links: { openUrl: null, acknowledgeUrl: null },
    });
    expect(result).toEqual({ html: '<p>Hello</p>', text: 'Hello' });
  });

  it('normalizes message ids with or without brackets', () => {
    expect(normalizeMessageId('<abc@example.com>')).toBe('abc@example.com');
    expect(normalizeMessageId('abc@example.com')).toBe('abc@example.com');
    expect(normalizeMessageId(null)).toBe('');
  });
});
