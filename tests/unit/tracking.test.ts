import { describe, expect, it } from 'vitest';
import {
  buildTrackingLinks,
  classifyBounceText,
  createTrackingId,
  decorateEmailBodies,
  inferBounceTypeFromStatus,
  isTrackingId,
  normalizeBounceType,
  normalizeMessageId,
  resolveBounceType,
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

  it('normalizes explicit bounce types', () => {
    expect(normalizeBounceType('HARD')).toBe('hard');
    expect(normalizeBounceType(' soft ')).toBe('soft');
    expect(normalizeBounceType('maybe')).toBe('unknown');
    expect(normalizeBounceType(undefined)).toBe('unknown');
  });

  it('infers a bounce type from SMTP status codes', () => {
    expect(inferBounceTypeFromStatus('550')).toBe('hard');
    expect(inferBounceTypeFromStatus('5.1.1')).toBe('hard');
    expect(inferBounceTypeFromStatus('450')).toBe('soft');
    expect(inferBounceTypeFromStatus('4.2.2')).toBe('soft');
    expect(inferBounceTypeFromStatus('delivered')).toBeNull();
  });

  it('prefers explicit bounce types, then SMTP status', () => {
    expect(resolveBounceType({ bounceType: 'soft', smtpStatus: '550' })).toBe('soft');
    expect(resolveBounceType({ smtpStatus: '550' })).toBe('hard');
    expect(resolveBounceType({ statusCode: '4.2.2' })).toBe('soft');
    expect(resolveBounceType({})).toBe('unknown');
  });

  it('classifies DSN subject text as hard, soft, or unknown', () => {
    expect(classifyBounceText('Delivery Status Notification (Failure)')).toBe('hard');
    expect(classifyBounceText('Undelivered Mail Returned to Sender')).toBe('hard');
    expect(classifyBounceText('Mail delivery failed: returning message to sender')).toBe('hard');
    expect(classifyBounceText('Delayed Mail (still being retried)')).toBe('soft');
    expect(classifyBounceText('temporary failure, will retry')).toBe('soft');
    expect(classifyBounceText('Delivery Status Notification')).toBe('unknown');
  });
});
