import { randomBytes } from 'node:crypto';

export type TrackingEventType =
  | 'DELIVERED'
  | 'DEFERRED'
  | 'BOUNCED'
  | 'OPENED'
  | 'READ'
  | 'ACKNOWLEDGED'
  | 'REPLIED'
  | 'COMPLAINED';

export type TrackingSource =
  | 'pixel'
  | 'ack_link'
  | 'gmail_dsn'
  | 'gmail_mdn'
  | 'gmail_thread'
  | 'webhook'
  | 'manual';

export type BounceType = 'hard' | 'soft' | 'unknown';

const HARD_BOUNCE_SIGNALS = [
  'permanent',
  'undeliverable',
  'undelivered',
  'returned to sender',
  'failure',
  'failed',
  'mail delivery failed',
  'address not found',
  'does not exist',
  'user unknown',
  'rejected',
  'blocked',
  '5.1.1',
  '550',
];

const SOFT_BOUNCE_SIGNALS = [
  'delay',
  'delayed',
  'temporary',
  'temporarily',
  'deferred',
  'retrying',
  'will retry',
  'try again',
  'mailbox full',
  'quota exceeded',
  '4.2.2',
  '450',
  '452',
];

export function normalizeBounceType(value: unknown): BounceType {
  if (typeof value !== 'string') {
    return 'unknown';
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'hard' || normalized === 'soft' ? normalized : 'unknown';
}

export function inferBounceTypeFromStatus(value: unknown): BounceType | null {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string') {
    return null;
  }
  const trimmed = text.trim();
  if (/^5(?:\.\d+){1,2}$/.test(trimmed) || /^5\d{2}$/.test(trimmed)) {
    return 'hard';
  }
  if (/^4(?:\.\d+){1,2}$/.test(trimmed) || /^4\d{2}$/.test(trimmed)) {
    return 'soft';
  }
  return null;
}

export function resolveBounceType(payload: Record<string, unknown>): BounceType {
  const explicit = normalizeBounceType(payload.bounceType);
  if (explicit !== 'unknown') {
    return explicit;
  }
  for (const key of ['smtpStatus', 'status', 'statusCode', 'diagnosticCode']) {
    const inferred = inferBounceTypeFromStatus(payload[key]);
    if (inferred) {
      return inferred;
    }
  }
  return 'unknown';
}

export function classifyBounceText(text: string): BounceType {
  const normalized = text.toLowerCase();
  if (SOFT_BOUNCE_SIGNALS.some((signal) => normalized.includes(signal))) {
    return 'soft';
  }
  if (HARD_BOUNCE_SIGNALS.some((signal) => normalized.includes(signal))) {
    return 'hard';
  }
  return 'unknown';
}

export interface TrackingLinks {
  openUrl: string | null;
  acknowledgeUrl: string | null;
}

export interface TrackingDecorationInput {
  html: string | null;
  text: string | null;
  trackingId: string;
  links: TrackingLinks;
}

export function createTrackingId(): string {
  return `trk_${randomBytes(18).toString('base64url')}`;
}

export function isTrackingId(value: string): boolean {
  return /^trk_[A-Za-z0-9_-]{16,64}$/.test(value);
}

export function normalizeMessageId(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^</, '').replace(/>$/, '');
}

export function buildTrackingLinks(
  baseUrl: string,
  trackingId: string,
  options: { pixelEnabled: boolean; acknowledgementEnabled: boolean },
): TrackingLinks {
  const root = baseUrl.replace(/\/+$/, '');
  const token = encodeURIComponent(trackingId);
  return {
    openUrl: options.pixelEnabled ? `${root}/t/open/${token}` : null,
    acknowledgeUrl: options.acknowledgementEnabled ? `${root}/t/ack/${token}` : null,
  };
}

export function decorateEmailBodies(input: TrackingDecorationInput): {
  html: string | null;
  text: string | null;
} {
  const { html, text, trackingId, links } = input;
  if (!links.openUrl && !links.acknowledgeUrl) {
    return { html, text };
  }

  const footerLines: string[] = [`Tracking ID: ${trackingId}`];
  if (links.acknowledgeUrl) {
    footerLines.push(`Confirm receipt: ${links.acknowledgeUrl}`);
  }
  const textFooter = `\n\n-- \n${footerLines.join('\n')}\n`;

  let decoratedHtml = html;
  if (html !== null) {
    const footerParts = [
      `<p style="margin:0;font-size:12px;color:#667085">Tracking ID: <code>${trackingId}</code></p>`,
    ];
    if (links.acknowledgeUrl) {
      footerParts.push(
        `<p style="margin:4px 0 0;font-size:12px"><a href="${links.acknowledgeUrl}">Confirm receipt of this email</a></p>`,
      );
    }
    const pixel = links.openUrl
      ? `<img src="${links.openUrl}" width="1" height="1" alt="" style="display:none" />`
      : '';
    decoratedHtml = `${html}\n<hr style="border:none;border-top:1px solid #d9dde4;margin:16px 0 8px" />\n${footerParts.join('\n')}\n${pixel}`;
  }

  return {
    html: decoratedHtml,
    text: text === null ? null : `${text}${textFooter}`,
  };
}
