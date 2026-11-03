import type { EmailProviderName, MimeMessageInput, ValidatedAttachment } from '../domain/types';

export interface OutgoingEmail {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string | null;
  text: string | null;
  attachments: ValidatedAttachment[];
  messageId: string;
  date: Date;
  trackingId?: string;
  readReceiptRequested?: boolean;
}

export interface ProviderSendResult {
  provider: EmailProviderName;
  providerMessageId: string;
  providerThreadId: string | null;
  labels: string[];
}

export interface ProviderVerification {
  verified: boolean;
  labels: string[];
  headers: Record<string, string>;
  reason: string | null;
}

export interface ProviderMessageLookup {
  found: boolean;
  providerMessageId: string | null;
  providerThreadId: string | null;
  labels: string[];
}

export interface EmailProvider {
  readonly name: EmailProviderName;
  send(email: OutgoingEmail): Promise<ProviderSendResult>;
  verifySent(
    providerMessageId: string,
    expectedMessageId: string,
    expectedFrom: string,
  ): Promise<ProviderVerification>;
  findByMessageId(messageId: string): Promise<ProviderMessageLookup>;
}

export type { MimeMessageInput };
