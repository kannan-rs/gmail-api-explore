import { buildMimeMessage } from '../../domain/mime';
import type {
  EmailProvider,
  OutgoingEmail,
  ProviderMessageLookup,
  ProviderSendResult,
  ProviderVerification,
} from '../email-provider';
import type { GmailApi } from './gmail-api';

function normalizeMessageId(value: string | undefined): string {
  return (value ?? '').trim().replace(/^</, '').replace(/>$/, '');
}

export class GmailProvider implements EmailProvider {
  readonly name = 'gmail' as const;

  constructor(private readonly api: GmailApi) {}

  async send(email: OutgoingEmail): Promise<ProviderSendResult> {
    const raw = await buildMimeMessage(email);
    const rawBase64Url = Buffer.from(raw, 'utf8').toString('base64url');
    const response = await this.api.sendRaw(rawBase64Url);

    return {
      provider: 'gmail',
      providerMessageId: response.id,
      providerThreadId: response.threadId,
      labels: response.labelIds,
    };
  }

  async verifySent(
    providerMessageId: string,
    expectedMessageId: string,
    expectedFrom: string,
  ): Promise<ProviderVerification> {
    const metadata = await this.api.getMessageMetadata(providerMessageId);
    const labels = metadata.labelIds;
    const headers = metadata.headers;
    const reasons: string[] = [];

    if (!labels.includes('SENT')) {
      reasons.push('SENT label missing');
    }
    if (normalizeMessageId(headers['message-id']) !== normalizeMessageId(expectedMessageId)) {
      reasons.push('Message-ID mismatch');
    }
    if (!(headers.from ?? '').toLowerCase().includes(expectedFrom.toLowerCase())) {
      reasons.push('From header mismatch');
    }

    return {
      verified: reasons.length === 0,
      labels,
      headers,
      reason: reasons.length === 0 ? null : reasons.join('; '),
    };
  }

  async findByMessageId(messageId: string): Promise<ProviderMessageLookup> {
    const expected = normalizeMessageId(messageId);
    const page = await this.api.listMessagesByLabel(['SENT'], 100);

    for (const ref of page.messages) {
      const metadata = await this.api.getMessageMetadata(ref.id);
      if (normalizeMessageId(metadata.headers['message-id']) === expected) {
        return {
          found: true,
          providerMessageId: ref.id,
          providerThreadId: ref.threadId ?? metadata.threadId,
          labels: metadata.labelIds,
        };
      }
    }

    return {
      found: false,
      providerMessageId: null,
      providerThreadId: null,
      labels: [],
    };
  }
}
