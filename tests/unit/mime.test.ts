import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildMimeMessage } from '../../src/domain/mime';
import type { ValidatedAttachment } from '../../src/domain/types';

const attachmentContent = Buffer.from('%PDF-1.4 test attachment');
const attachment: ValidatedAttachment = {
  filename: 'statement.pdf',
  mimeType: 'application/pdf',
  size: attachmentContent.length,
  sha256: createHash('sha256').update(attachmentContent).digest('hex'),
  content: attachmentContent,
};

const fixedMessageId = '<11111111-1111-4111-8111-111111111111@example.com>';
const fixedDate = new Date('2026-11-01T10:00:00.000Z');

describe('buildMimeMessage', () => {
  it('builds a multipart message with To, Cc, Bcc, subject, HTML, text fallback, and attachment', async () => {
    const raw = await buildMimeMessage({
      from: 'support-client-01@example.com',
      to: ['borrower@example.com'],
      cc: ['ops@example.com'],
      bcc: ['audit@example.com'],
      subject: 'Loan statement',
      html: '<p>Hello <b>World</b></p>',
      text: null,
      attachments: [attachment],
      messageId: fixedMessageId,
      date: fixedDate,
    });

    expect(raw).toContain('From: support-client-01@example.com');
    expect(raw).toContain('To: borrower@example.com');
    expect(raw).toContain('Cc: ops@example.com');
    expect(raw).toContain('Bcc: audit@example.com');
    expect(raw).toContain('Subject: Loan statement');
    expect(raw).toContain(`Message-ID: ${fixedMessageId}`);
    expect(raw).toContain('Content-Type: multipart/mixed');
    expect(raw).toContain('Content-Type: text/plain');
    expect(raw).toContain('Hello World');
    expect(raw).toContain('Content-Type: text/html');
    expect(raw).toContain('<p>Hello <b>World</b></p>');
    expect(raw).toContain('Content-Type: application/pdf');
    expect(raw).toContain('filename=statement.pdf');
    expect(raw).toContain(attachmentContent.toString('base64'));
    expect(raw).toContain('\r\n');
  });

  it('keeps an explicit plain-text body when provided', async () => {
    const raw = await buildMimeMessage({
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Plain',
      html: '<p>HTML body</p>',
      text: 'Explicit plain body',
      attachments: [],
      messageId: fixedMessageId,
      date: fixedDate,
    });

    expect(raw).toContain('Explicit plain body');
  });

  it('encodes non-ASCII subjects and body content', async () => {
    const raw = await buildMimeMessage({
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'ऋण विवरण',
      html: '<p>नमस्ते</p>',
      text: null,
      attachments: [],
      messageId: fixedMessageId,
      date: fixedDate,
    });

    expect(raw).toContain('Subject: =?UTF-8?');
    expect(raw.toLowerCase()).toContain('content-type: text/html; charset=utf-8');
  });

  it('adds tracking and read-receipt request headers', async () => {
    const raw = await buildMimeMessage({
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Tracked',
      html: '<p>Body</p>',
      text: null,
      attachments: [],
      messageId: fixedMessageId,
      date: fixedDate,
      trackingId: 'trk_abc',
      readReceiptRequested: true,
    });

    expect(raw).toContain('X-Tracking-ID: trk_abc');
    expect(raw).toContain('Disposition-Notification-To: sender@example.com');
    expect(raw).toContain('Return-Receipt-To: sender@example.com');
    expect(raw).toContain('X-Confirm-Reading-To: sender@example.com');
  });

  it('preserves the exact Message-ID supplied by the caller', async () => {
    const otherMessageId = '<22222222-2222-4222-8222-222222222222@example.com>';
    const raw = await buildMimeMessage({
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      cc: [],
      bcc: [],
      subject: 'Message id',
      html: '<p>Body</p>',
      text: null,
      attachments: [],
      messageId: otherMessageId,
      date: fixedDate,
    });

    expect(raw).toContain(`Message-ID: ${otherMessageId}`);
  });
});
