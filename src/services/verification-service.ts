import type { EmailSendRow } from '../db/schema';
import { isAppError, NotFoundError } from '../domain/errors';
import type { ProviderVerification } from '../providers/email-provider';
import type { SendRepository } from '../repositories/send-repository';
import type { CredentialService } from './credential-service';
import type { ProviderResolver } from './provider-resolver';
import { recordVerificationResult } from './verification-result';

export interface VerifySendResult {
  send: EmailSendRow;
  verified: boolean;
  labels: string[];
  reason: string | null;
}

export interface ReconcileResult {
  checked: number;
  verified: number;
  stillUnverified: number;
  errors: number;
  recovered: number;
}

export interface VerificationServiceDeps {
  sends: SendRepository;
  credentials: CredentialService;
  resolveProvider: ProviderResolver;
}

export class VerificationService {
  constructor(private readonly deps: VerificationServiceDeps) {}

  async verify(sendId: string): Promise<VerifySendResult> {
    const send = await this.deps.sends.findById(sendId);
    if (!send) {
      throw new NotFoundError('Send record not found');
    }

    const connection = send.mailboxId
      ? await this.deps.credentials.getConnectionForMailbox(send.mailboxId)
      : await this.deps.credentials.getActiveConnection();
    const provider = this.deps.resolveProvider(connection);

    if (!send.providerMessageId) {
      const lookup = await provider.findByMessageId(send.messageIdHeader);
      if (!lookup.found || !lookup.providerMessageId) {
        return {
          send,
          verified: false,
          labels: [],
          reason: 'Message not found in Gmail',
        };
      }

      const accepted = await this.markAccepted(
        send,
        lookup.providerMessageId,
        lookup.providerThreadId,
        lookup.labels,
      );

      let verification: ProviderVerification;
      try {
        verification = await provider.verifySent(
          lookup.providerMessageId,
          send.messageIdHeader,
          send.fromEmail,
        );
      } catch (error) {
        await this.deps.sends.addEvent(send.id, 'verification_error', {
          code: isAppError(error) ? error.code : 'UNKNOWN',
        });
        return {
          send: accepted,
          verified: false,
          labels: lookup.labels,
          reason: isAppError(error) ? error.message : 'Verification failed',
        };
      }

      const final = await recordVerificationResult(this.deps.sends, accepted, verification);
      return {
        send: final,
        verified: verification.verified,
        labels: verification.labels,
        reason: verification.reason,
      };
    }

    const verification = await provider.verifySent(
      send.providerMessageId,
      send.messageIdHeader,
      send.fromEmail,
    );
    const final = await recordVerificationResult(this.deps.sends, send, verification);

    return {
      send: final,
      verified: verification.verified,
      labels: verification.labels,
      reason: verification.reason,
    };
  }

  async reconcile(days = 2): Promise<ReconcileResult> {
    const rows = await this.deps.sends.recentForReconciliation(days, 100);
    let verified = 0;
    let stillUnverified = 0;
    let errors = 0;
    let recovered = 0;

    for (const row of rows) {
      try {
        const wasSending = row.status === 'SENDING';
        const result = await this.verify(row.id);
        if (result.verified) {
          verified += 1;
        } else {
          stillUnverified += 1;
        }
        if (wasSending && result.send.status !== 'SENDING') {
          recovered += 1;
        }
      } catch (error) {
        errors += 1;
        await this.deps.sends
          .addEvent(row.id, 'reconcile_error', {
            code: isAppError(error) ? error.code : 'UNKNOWN',
          })
          .catch(() => undefined);
      }
    }

    return {
      checked: rows.length,
      verified,
      stillUnverified,
      errors,
      recovered,
    };
  }

  private async markAccepted(
    send: EmailSendRow,
    providerMessageId: string,
    providerThreadId: string | null,
    labels: string[],
  ): Promise<EmailSendRow> {
    const accepted = await this.deps.sends.updateStatus(send.id, {
      status: 'SENT',
      providerMessageId,
      providerThreadId,
      providerLabels: labels,
      errorCode: null,
      errorMessage: null,
      sentAt: send.sentAt ?? new Date(),
      verifiedAt: null,
    });

    await this.deps.sends.addEvent(send.id, 'recovered_from_gmail', {
      providerMessageId,
      providerThreadId,
      labels,
    });

    return accepted;
  }
}
