import { type BounceType, classifyBounceText, normalizeMessageId } from '../../domain/tracking';
import type {
  ProviderTrackingEvent,
  TrackingCollectInput,
  TrackingProvider,
  TrackingSendRef,
} from '../tracking-provider';
import type { GmailApi, GmailMessageMetadata } from './gmail-api';

function header(metadata: GmailMessageMetadata, name: string): string {
  return metadata.headers[name.toLowerCase()] ?? '';
}

function lower(value: string): string {
  return value.toLowerCase();
}

function parseHeaderDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function referenceIds(metadata: GmailMessageMetadata): string[] {
  const raw = `${header(metadata, 'in-reply-to')} ${header(metadata, 'references')}`;
  const bracketed = [...raw.matchAll(/<([^>]+)>/g)].map((match) => match[1] ?? '');
  const values = bracketed.length > 0 ? bracketed : [raw];
  return values.map((value) => normalizeMessageId(value)).filter((value) => value.length > 0);
}

function matchSend(
  metadata: GmailMessageMetadata,
  sends: TrackingSendRef[],
): TrackingSendRef | null {
  const references = new Set(referenceIds(metadata));
  if (references.size === 0) {
    return null;
  }
  return sends.find((send) => references.has(normalizeMessageId(send.messageIdHeader))) ?? null;
}

function matchFailedRecipient(
  metadata: GmailMessageMetadata,
  sends: TrackingSendRef[],
): TrackingSendRef | null {
  const failed = new Set(
    header(metadata, 'x-failed-recipients')
      .split(',')
      .map((value) => lower(value.trim()))
      .filter(Boolean),
  );
  if (failed.size === 0) {
    return null;
  }
  const occurredAt = parseHeaderDate(header(metadata, 'date'));
  return (
    sends.find(
      (send) =>
        (!send.sentAt || occurredAt.getTime() >= send.sentAt.getTime()) &&
        [...send.toEmails, ...send.ccEmails, ...send.bccEmails].some((email) =>
          failed.has(lower(email)),
        ),
    ) ?? null
  );
}

function matchReadReceipt(
  metadata: GmailMessageMetadata,
  sends: TrackingSendRef[],
): TrackingSendRef | null {
  const subject = lower(header(metadata, 'subject'))
    .replace(/^(?:read(?:\s+receipt)?|read-receipt|receipt)\s*:\s*/, '')
    .trim();
  const from = lower(header(metadata, 'from'));
  if (subject.length === 0) {
    return null;
  }
  const occurredAt = parseHeaderDate(header(metadata, 'date'));
  return (
    sends.find(
      (send) =>
        (!send.sentAt || occurredAt.getTime() >= send.sentAt.getTime()) &&
        lower(send.subject).trim() === subject &&
        send.toEmails.some((email) => from.includes(lower(email))),
    ) ?? null
  );
}

export function looksLikeBounce(metadata: GmailMessageMetadata): boolean {
  const from = lower(header(metadata, 'from'));
  const subject = lower(header(metadata, 'subject'));
  const contentType = lower(header(metadata, 'content-type'));
  return (
    from.includes('mailer-daemon') ||
    from.includes('postmaster') ||
    from.includes('mail delivery subsystem') ||
    subject.includes('delivery status notification') ||
    subject.includes('undelivered mail returned') ||
    subject.includes('mail delivery failed') ||
    subject.includes('delivery failure') ||
    subject.includes('delayed mail') ||
    (contentType.includes('multipart/report') && contentType.includes('delivery-status'))
  );
}

export function looksLikeReadReceipt(metadata: GmailMessageMetadata): boolean {
  const subject = lower(header(metadata, 'subject')).trim();
  const contentType = lower(header(metadata, 'content-type'));
  return (
    subject.startsWith('read:') ||
    subject.includes('read receipt') ||
    (contentType.includes('multipart/report') && contentType.includes('disposition-notification'))
  );
}

export function classifyDsn(metadata: GmailMessageMetadata): BounceType {
  const subject = header(metadata, 'subject');
  const contentType = header(metadata, 'content-type');
  const classification = classifyBounceText(`${subject} ${contentType}`);
  if (classification !== 'unknown') {
    return classification;
  }
  return header(metadata, 'x-failed-recipients').length > 0 ? 'hard' : 'unknown';
}

function bounceEvent(metadata: GmailMessageMetadata, send: TrackingSendRef): ProviderTrackingEvent {
  const subject = header(metadata, 'subject');
  const bounceType = classifyDsn(metadata);
  const failedRecipients = header(metadata, 'x-failed-recipients')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    sendId: send.id,
    trackingId: send.trackingId,
    eventType: bounceType === 'soft' ? 'DEFERRED' : 'BOUNCED',
    source: 'gmail_dsn',
    providerEventId: metadata.id,
    occurredAt: parseHeaderDate(header(metadata, 'date')),
    payload: {
      bounceType,
      failedRecipients,
      subject,
      from: header(metadata, 'from'),
      gmailMessageId: metadata.id,
      note: 'Gmail metadata sync classifies from DSN headers/subject because it cannot read the DSN body or SMTP status.',
    },
  };
}

function readReceiptEvent(
  metadata: GmailMessageMetadata,
  send: TrackingSendRef,
): ProviderTrackingEvent {
  return {
    sendId: send.id,
    trackingId: send.trackingId,
    eventType: 'READ',
    source: 'gmail_mdn',
    providerEventId: metadata.id,
    occurredAt: parseHeaderDate(header(metadata, 'date')),
    payload: {
      subject: header(metadata, 'subject'),
      from: header(metadata, 'from'),
      gmailMessageId: metadata.id,
    },
  };
}

function replyEvent(
  metadata: GmailMessageMetadata,
  send: TrackingSendRef,
  mailboxEmail: string,
): ProviderTrackingEvent | null {
  const from = lower(header(metadata, 'from'));
  if (from.includes(lower(mailboxEmail))) {
    return null;
  }
  if (looksLikeBounce(metadata) || looksLikeReadReceipt(metadata)) {
    return null;
  }
  if (metadata.id === send.providerMessageId) {
    return null;
  }
  const occurredAt = parseHeaderDate(header(metadata, 'date'));
  if (send.sentAt && occurredAt.getTime() < send.sentAt.getTime()) {
    return null;
  }

  return {
    sendId: send.id,
    trackingId: send.trackingId,
    eventType: 'REPLIED',
    source: 'gmail_thread',
    providerEventId: metadata.id,
    occurredAt,
    payload: {
      from: header(metadata, 'from'),
      subject: header(metadata, 'subject'),
      messageId: header(metadata, 'message-id'),
      gmailMessageId: metadata.id,
    },
  };
}

export class GmailTrackingProvider implements TrackingProvider {
  constructor(private readonly api: GmailApi) {}

  async collectEvents(input: TrackingCollectInput): Promise<ProviderTrackingEvent[]> {
    const events: ProviderTrackingEvent[] = [];
    const days = Math.max(1, Math.min(30, input.days));
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const page = await this.api.listMessagesByLabel(['INBOX'], 500);

    for (const ref of page.messages) {
      const metadata = await this.api.getMessageMetadata(ref.id);
      const occurredAt = parseHeaderDate(header(metadata, 'date'));
      if (occurredAt.getTime() < cutoff) {
        break;
      }
      const bounce = looksLikeBounce(metadata);
      const receipt = looksLikeReadReceipt(metadata);
      const send =
        matchSend(metadata, input.sends) ??
        (bounce ? matchFailedRecipient(metadata, input.sends) : null) ??
        (receipt ? matchReadReceipt(metadata, input.sends) : null);
      if (!send) {
        continue;
      }
      if (bounce) {
        events.push(bounceEvent(metadata, send));
      } else if (receipt) {
        events.push(readReceiptEvent(metadata, send));
      }
    }

    if (this.api.getThreadMetadata) {
      for (const send of input.sends) {
        if (!send.providerThreadId || send.repliedAt) {
          continue;
        }
        const messages = await this.api.getThreadMetadata(send.providerThreadId);
        for (const metadata of messages) {
          const event = replyEvent(metadata, send, input.mailboxEmail);
          if (event) {
            events.push(event);
          }
        }
      }
    }

    return events;
  }
}
