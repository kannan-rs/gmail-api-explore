import type { EmailSendRow } from '../db/schema';
import type { ProviderVerification } from '../providers/email-provider';
import type { SendRepository } from '../repositories/send-repository';

function normalizeMessageId(value: string | undefined): string {
  return (value ?? '').trim().replace(/^</, '').replace(/>$/, '');
}

function isOnlyMessageIdMismatch(reason: string | null): boolean {
  if (!reason) {
    return false;
  }
  const reasons = reason.split('; ');
  return reasons.length > 0 && reasons.every((entry) => entry === 'Message-ID mismatch');
}

async function adoptProviderMessageId(
  sends: SendRepository,
  send: EmailSendRow,
  verification: ProviderVerification,
): Promise<{ send: EmailSendRow; verification: ProviderVerification }> {
  const actual = verification.headers['message-id']?.trim();
  if (
    verification.verified ||
    !actual ||
    !isOnlyMessageIdMismatch(verification.reason) ||
    normalizeMessageId(actual) === normalizeMessageId(send.messageIdHeader)
  ) {
    return { send, verification };
  }

  const updated = await sends.updateMessageIdHeader(send.id, actual);
  await sends.addEvent(send.id, 'message_id_adopted', {
    previous: send.messageIdHeader,
    actual,
  });

  return {
    send: updated,
    verification: { ...verification, verified: true, reason: null },
  };
}

export interface RecordedVerification {
  send: EmailSendRow;
  verification: ProviderVerification;
}

export async function recordVerificationResult(
  sends: SendRepository,
  send: EmailSendRow,
  verification: ProviderVerification,
): Promise<RecordedVerification> {
  const adopted = await adoptProviderMessageId(sends, send, verification);
  const effectiveSend = adopted.send;
  const effectiveVerification = adopted.verification;

  if (!effectiveVerification.verified) {
    await sends.addEvent(effectiveSend.id, 'verification_failed', {
      reason: effectiveVerification.reason ?? 'unknown',
      labels: effectiveVerification.labels,
    });
    return { send: effectiveSend, verification: effectiveVerification };
  }

  const verifiedAt = new Date();
  const updated = await sends.updateStatus(effectiveSend.id, {
    status: 'VERIFIED',
    providerMessageId: effectiveSend.providerMessageId,
    providerThreadId: effectiveSend.providerThreadId,
    providerLabels: effectiveVerification.labels,
    errorCode: null,
    errorMessage: null,
    sentAt: effectiveSend.sentAt,
    verifiedAt,
  });

  await sends.addEvent(effectiveSend.id, 'verified', {
    labels: effectiveVerification.labels,
    verifiedAt: verifiedAt.toISOString(),
  });

  return { send: updated, verification: effectiveVerification };
}
