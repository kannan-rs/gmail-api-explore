import type { EmailSendRow } from '../db/schema';
import {
  ConflictError,
  isAppError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  UnauthorizedError,
} from '../domain/errors';
import { buildGmailSentUrl } from '../domain/gmail-url';
import { assertIdempotencyMatch, createMessageId, hashSendRequest } from '../domain/idempotency';
import { buildTrackingLinks, createTrackingId, decorateEmailBodies } from '../domain/tracking';
import type { ValidatedSendRequest } from '../domain/types';
import { validateSendRequest } from '../domain/validation';
import type { EmailProvider, ProviderMessageLookup } from '../providers/email-provider';
import type { ClientRepository } from '../repositories/client-repository';
import type { SendRepository } from '../repositories/send-repository';
import type { CredentialService, MailboxConnection } from './credential-service';
import type { ProviderResolver } from './provider-resolver';
import { recordVerificationResult } from './verification-result';

export interface SendServiceConfig {
  dailySendLimit: number;
  maxAttachmentBytes: number;
  maxAttachments: number;
  publicBaseUrl: string;
  trackingEnabled: boolean;
  trackingPixelEnabled: boolean;
  trackingAcknowledgementEnabled: boolean;
  readReceiptRequested: boolean;
}

export interface SendServiceDeps {
  sends: SendRepository;
  clients: ClientRepository;
  credentials: CredentialService;
  resolveProvider: ProviderResolver;
  config: SendServiceConfig;
}

export interface SendEmailResult {
  send: EmailSendRow;
  duplicate: boolean;
  verified: boolean;
  gmailUrl: string | null;
}

interface SafeSendError {
  code: string;
  message: string;
  retryable: boolean;
}

function toSafeSendError(error: unknown): SafeSendError {
  if (error instanceof ProviderError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: false,
    };
  }
  return {
    code: 'SEND_FAILED',
    message: 'The email could not be sent',
    retryable: false,
  };
}

export class SendService {
  constructor(private readonly deps: SendServiceDeps) {}

  async send(input: unknown): Promise<SendEmailResult> {
    const validated = validateSendRequest(input, {
      maxAttachmentBytes: this.deps.config.maxAttachmentBytes,
      maxAttachments: this.deps.config.maxAttachments,
    });
    const requestHash = hashSendRequest(validated);
    const existing = await this.deps.sends.findByIdempotencyKey(validated.idempotencyKey);

    if (existing) {
      return this.handleExisting(existing, validated, requestHash);
    }

    return this.createAndSend(validated, requestHash);
  }

  private async handleExisting(
    existing: EmailSendRow,
    validated: ValidatedSendRequest,
    requestHash: string,
  ): Promise<SendEmailResult> {
    assertIdempotencyMatch(existing.requestHash, requestHash);

    if (existing.status === 'SENT' || existing.status === 'VERIFIED') {
      return this.toResult(existing, true, existing.status === 'VERIFIED');
    }

    const connection = await this.getConnectionForSend(existing);
    const provider = this.deps.resolveProvider(connection);
    const recovered = await this.tryRecover(existing, provider);

    if (recovered) {
      return this.toResult(recovered, true, recovered.status === 'VERIFIED');
    }

    if (existing.status === 'SENDING') {
      throw new ConflictError('A send with this idempotency key is already in progress', {
        sendId: existing.id,
      });
    }

    const retry = await this.deps.sends.updateStatus(existing.id, {
      status: 'SENDING',
      providerMessageId: null,
      providerThreadId: null,
      providerLabels: null,
      errorCode: null,
      errorMessage: null,
      sentAt: null,
      verifiedAt: null,
    });
    await this.deps.sends.addEvent(existing.id, 'retry_started', {});

    return this.performSend(retry, validated, connection, provider);
  }

  private async createAndSend(
    validated: ValidatedSendRequest,
    requestHash: string,
  ): Promise<SendEmailResult> {
    const connection = await this.deps.credentials.getActiveConnection();
    const client = await this.deps.clients.findById(validated.clientId);
    if (!client) {
      throw new NotFoundError('Client not found');
    }

    const sentToday = await this.deps.sends.countToday(connection.mailbox.id);
    if (sentToday >= this.deps.config.dailySendLimit) {
      throw new RateLimitError(
        `Daily send limit of ${this.deps.config.dailySendLimit} has been reached for this mailbox`,
      );
    }

    const provider = this.deps.resolveProvider(connection);
    const messageIdHeader = createMessageId(connection.mailbox.email);
    const trackingId = createTrackingId();
    const links = this.deps.config.trackingEnabled
      ? buildTrackingLinks(this.deps.config.publicBaseUrl, trackingId, {
          pixelEnabled: this.deps.config.trackingPixelEnabled,
          acknowledgementEnabled: this.deps.config.trackingAcknowledgementEnabled,
        })
      : { openUrl: null, acknowledgeUrl: null };
    const decorated = decorateEmailBodies({
      html: validated.html,
      text: validated.text,
      trackingId,
      links,
    });
    const send = await this.deps.sends.create({
      provider: 'gmail',
      mode: 'direct',
      mailboxId: connection.mailbox.id,
      clientId: validated.clientId,
      fromEmail: connection.mailbox.email,
      toEmails: validated.to,
      ccEmails: validated.cc,
      bccEmails: validated.bcc,
      subject: validated.subject,
      bodyHtml: decorated.html,
      bodyText: decorated.text,
      attachments: validated.attachments.map((attachment) => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        sha256: attachment.sha256,
      })),
      messageIdHeader,
      trackingId,
      idempotencyKey: validated.idempotencyKey,
      requestHash,
    });

    await this.deps.sends.addEvent(send.id, 'send_started', {
      provider: 'gmail',
      mailboxId: connection.mailbox.id,
    });

    return this.performSend(send, validated, connection, provider);
  }

  private async performSend(
    send: EmailSendRow,
    validated: ValidatedSendRequest,
    connection: MailboxConnection,
    provider: EmailProvider,
  ): Promise<SendEmailResult> {
    const outgoing = {
      from: connection.mailbox.email,
      to: validated.to,
      cc: validated.cc,
      bcc: validated.bcc,
      subject: validated.subject,
      html: send.bodyHtml,
      text: send.bodyText,
      attachments: validated.attachments,
      messageId: send.messageIdHeader,
      date: new Date(),
      trackingId: send.trackingId,
      readReceiptRequested: this.deps.config.readReceiptRequested,
    };

    try {
      const result = await provider.send(outgoing);
      const sent = await this.deps.sends.updateStatus(send.id, {
        status: 'SENT',
        providerMessageId: result.providerMessageId,
        providerThreadId: result.providerThreadId,
        providerLabels: result.labels,
        errorCode: null,
        errorMessage: null,
        sentAt: new Date(),
        verifiedAt: null,
      });

      await this.deps.sends.addEvent(send.id, 'provider_accepted', {
        provider: result.provider,
        providerMessageId: result.providerMessageId,
        providerThreadId: result.providerThreadId,
        labels: result.labels,
      });

      let final = sent;
      let verified = false;
      try {
        const verification = await provider.verifySent(
          result.providerMessageId,
          send.messageIdHeader,
          connection.mailbox.email,
        );
        const recorded = await recordVerificationResult(this.deps.sends, sent, verification);
        final = recorded.send;
        verified = recorded.verification.verified;
      } catch (error) {
        await this.deps.sends.addEvent(send.id, 'verification_error', {
          code: isAppError(error) ? error.code : 'UNKNOWN',
        });
      }

      return this.toResult(final, false, verified);
    } catch (error) {
      const recovered = await this.tryRecoverAfterSendError(send, provider);
      if (recovered) {
        return this.toResult(recovered, false, recovered.status === 'VERIFIED');
      }

      const safe = toSafeSendError(error);
      await this.deps.sends.updateStatus(send.id, {
        status: 'FAILED',
        providerMessageId: null,
        providerThreadId: null,
        providerLabels: null,
        errorCode: safe.code,
        errorMessage: safe.message,
        sentAt: null,
        verifiedAt: null,
      });
      await this.deps.sends.addEvent(send.id, 'send_failed', {
        code: safe.code,
        retryable: safe.retryable,
      });

      throw new ProviderError(safe.message, {
        code: safe.code,
        retryable: safe.retryable,
        details: { sendId: send.id, status: 'FAILED' },
        cause: error,
      });
    }
  }

  private async tryRecoverAfterSendError(
    send: EmailSendRow,
    provider: EmailProvider,
  ): Promise<EmailSendRow | null> {
    let lookup: ProviderMessageLookup;
    try {
      lookup = await provider.findByMessageId(send.messageIdHeader);
    } catch {
      return null;
    }

    if (!lookup.found || !lookup.providerMessageId) {
      return null;
    }

    const recovered = await this.deps.sends.updateStatus(send.id, {
      status: 'SENT',
      providerMessageId: lookup.providerMessageId,
      providerThreadId: lookup.providerThreadId,
      providerLabels: lookup.labels,
      errorCode: null,
      errorMessage: null,
      sentAt: new Date(),
      verifiedAt: null,
    });
    await this.deps.sends.addEvent(send.id, 'recovered_after_send_error', {
      providerMessageId: lookup.providerMessageId,
      providerThreadId: lookup.providerThreadId,
      labels: lookup.labels,
    });

    try {
      const verification = await provider.verifySent(
        lookup.providerMessageId,
        send.messageIdHeader,
        send.fromEmail,
      );
      const recorded = await recordVerificationResult(this.deps.sends, recovered, verification);
      return recorded.send;
    } catch (error) {
      await this.deps.sends.addEvent(send.id, 'verification_error', {
        code: isAppError(error) ? error.code : 'UNKNOWN',
      });
      return recovered;
    }
  }

  private async tryRecover(
    existing: EmailSendRow,
    provider: EmailProvider,
  ): Promise<EmailSendRow | null> {
    if (existing.providerMessageId) {
      const verification = await provider.verifySent(
        existing.providerMessageId,
        existing.messageIdHeader,
        existing.fromEmail,
      );
      const recorded = await recordVerificationResult(this.deps.sends, existing, verification);
      return recorded.send;
    }

    let lookup: ProviderMessageLookup;
    try {
      lookup = await provider.findByMessageId(existing.messageIdHeader);
    } catch (error) {
      throw new ProviderError('Unable to check Gmail for the previous attempt', {
        code: 'RECOVERY_CHECK_FAILED',
        retryable: true,
        details: { sendId: existing.id },
        cause: error,
      });
    }

    if (!lookup.found || !lookup.providerMessageId) {
      return null;
    }

    const accepted = await this.deps.sends.updateStatus(existing.id, {
      status: 'SENT',
      providerMessageId: lookup.providerMessageId,
      providerThreadId: lookup.providerThreadId,
      providerLabels: lookup.labels,
      errorCode: null,
      errorMessage: null,
      sentAt: existing.sentAt ?? new Date(),
      verifiedAt: null,
    });
    await this.deps.sends.addEvent(existing.id, 'recovered_from_gmail', {
      providerMessageId: lookup.providerMessageId,
      providerThreadId: lookup.providerThreadId,
      labels: lookup.labels,
    });

    try {
      const verification = await provider.verifySent(
        lookup.providerMessageId,
        existing.messageIdHeader,
        existing.fromEmail,
      );
      const recorded = await recordVerificationResult(this.deps.sends, accepted, verification);
      return recorded.send;
    } catch (error) {
      await this.deps.sends.addEvent(existing.id, 'verification_error', {
        code: isAppError(error) ? error.code : 'UNKNOWN',
      });
      return accepted;
    }
  }

  private async getConnectionForSend(send: EmailSendRow): Promise<MailboxConnection> {
    const connection = send.mailboxId
      ? await this.deps.credentials.getConnectionForMailbox(send.mailboxId)
      : await this.deps.credentials.getActiveConnection();

    if (connection.mailbox.email.toLowerCase() !== send.fromEmail.toLowerCase()) {
      throw new UnauthorizedError(
        'The Gmail account used for this send is not connected. Reconnect Gmail.',
        { sendId: send.id },
      );
    }

    return connection;
  }

  private toResult(send: EmailSendRow, duplicate: boolean, verified: boolean): SendEmailResult {
    return {
      send,
      duplicate,
      verified,
      gmailUrl: send.providerMessageId
        ? buildGmailSentUrl(send.fromEmail, send.providerMessageId)
        : null,
    };
  }
}
