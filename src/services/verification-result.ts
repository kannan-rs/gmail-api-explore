import type { EmailSendRow } from '../db/schema';
import type { ProviderVerification } from '../providers/email-provider';
import type { SendRepository } from '../repositories/send-repository';

export async function recordVerificationResult(
  sends: SendRepository,
  send: EmailSendRow,
  verification: ProviderVerification,
): Promise<EmailSendRow> {
  if (!verification.verified) {
    await sends.addEvent(send.id, 'verification_failed', {
      reason: verification.reason ?? 'unknown',
      labels: verification.labels,
    });
    return send;
  }

  const verifiedAt = new Date();
  const updated = await sends.updateStatus(send.id, {
    status: 'VERIFIED',
    providerMessageId: send.providerMessageId,
    providerThreadId: send.providerThreadId,
    providerLabels: verification.labels,
    errorCode: null,
    errorMessage: null,
    sentAt: send.sentAt,
    verifiedAt,
  });

  await sends.addEvent(send.id, 'verified', {
    labels: verification.labels,
    verifiedAt: verifiedAt.toISOString(),
  });

  return updated;
}
