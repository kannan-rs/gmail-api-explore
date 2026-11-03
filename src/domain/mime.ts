import { convert } from 'html-to-text';
import { createTransport } from 'nodemailer';
import type { MimeMessageInput } from './types';

export async function buildMimeMessage(input: MimeMessageInput): Promise<string> {
  if (input.html === null && input.text === null) {
    throw new Error('A plain-text or HTML body is required');
  }

  const text =
    input.text ?? (input.html === null ? undefined : convert(input.html, { wordwrap: false }));

  const transport = createTransport({
    streamTransport: true,
    buffer: true,
    newline: 'windows',
  });

  const headers: Record<string, string> = {};
  if (input.trackingId) {
    headers['X-Tracking-ID'] = input.trackingId;
  }
  if (input.readReceiptRequested) {
    headers['Disposition-Notification-To'] = input.from;
    headers['Return-Receipt-To'] = input.from;
    headers['X-Confirm-Reading-To'] = input.from;
  }

  try {
    const info = await transport.sendMail({
      from: input.from,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text,
      html: input.html ?? undefined,
      messageId: input.messageId,
      date: input.date ?? new Date(),
      headers,
      attachments: input.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content,
        contentType: attachment.mimeType,
        contentDisposition: 'attachment',
      })),
    });

    if (!info.message) {
      throw new Error('Failed to build the MIME message');
    }

    return Buffer.isBuffer(info.message) ? info.message.toString('utf8') : info.message.toString();
  } finally {
    transport.close();
  }
}
