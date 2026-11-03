export type SendStatus = 'SENDING' | 'SENT' | 'VERIFIED' | 'FAILED';
export type SendMode = 'direct';
export type EmailProviderName = 'gmail';

export interface AttachmentInput {
  filename: string;
  mimeType: string;
  contentBase64: string;
}

export interface AttachmentMetadata {
  filename: string;
  mimeType: string;
  size: number;
  sha256: string;
}

export interface ValidatedAttachment extends AttachmentMetadata {
  content: Buffer;
}

export interface SendEmailRequest {
  clientId: string;
  to: string[] | string;
  cc?: string[] | string;
  bcc?: string[] | string;
  subject: string;
  html?: string;
  text?: string;
  attachments?: AttachmentInput[];
  idempotencyKey?: string;
}

export interface ValidatedSendRequest {
  clientId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string | null;
  text: string | null;
  attachments: ValidatedAttachment[];
  idempotencyKey: string;
}

export interface ValidationOptions {
  maxRecipients?: number;
  maxAttachmentBytes?: number;
  maxAttachments?: number;
  maxBodyBytes?: number;
}

export interface MimeMessageInput {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string | null;
  text: string | null;
  attachments: ValidatedAttachment[];
  messageId: string;
  date?: Date;
  trackingId?: string;
  readReceiptRequested?: boolean;
}
