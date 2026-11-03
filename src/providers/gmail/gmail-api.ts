import type { OAuth2Client } from 'google-auth-library';
import { type gmail_v1, google } from 'googleapis';
import { ProviderError } from '../../domain/errors';

export interface GmailMessageMetadata {
  id: string;
  threadId: string | null;
  labelIds: string[];
  headers: Record<string, string>;
}

export interface GmailMessageRef {
  id: string;
  threadId: string | null;
}

export interface GmailApi {
  sendRaw(rawBase64Url: string): Promise<{
    id: string;
    threadId: string | null;
    labelIds: string[];
  }>;
  getMessageMetadata(messageId: string): Promise<GmailMessageMetadata>;
  listMessages(query: string, maxResults: number): Promise<GmailMessageRef[]>;
  getThreadMetadata?(threadId: string): Promise<GmailMessageMetadata[]>;
}

const METADATA_HEADERS = [
  'From',
  'To',
  'Cc',
  'Subject',
  'Message-ID',
  'Date',
  'In-Reply-To',
  'References',
  'Content-Type',
  'X-Failed-Recipients',
  'Auto-Submitted',
  'Disposition-Notification-To',
  'Return-Receipt-To',
  'X-Confirm-Reading-To',
];

function toMetadata(message: gmail_v1.Schema$Message, fallbackId: string): GmailMessageMetadata {
  const headers: Record<string, string> = {};
  for (const header of message.payload?.headers ?? []) {
    if (header.name && header.value !== null && header.value !== undefined) {
      headers[header.name.toLowerCase()] = header.value;
    }
  }

  return {
    id: message.id ?? fallbackId,
    threadId: message.threadId ?? null,
    labelIds: message.labelIds ?? [],
    headers,
  };
}

function errorStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } }).response?.status;
}

function errorApiCode(error: unknown): string | undefined {
  const data = (error as { response?: { data?: { error?: unknown } } }).response?.data;
  return typeof data?.error === 'string' ? data.error : undefined;
}

function errorReason(error: unknown): string | undefined {
  const data = (
    error as {
      response?: {
        data?: {
          error?: {
            errors?: Array<{ reason?: unknown }>;
          };
        };
      };
    }
  ).response?.data;
  const reason = data?.error?.errors?.[0]?.reason;
  return typeof reason === 'string' ? reason : undefined;
}

export function mapGmailError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  const status = errorStatus(error);
  const apiCode = errorApiCode(error);
  const reason = errorReason(error);
  const networkCode = (error as { code?: string }).code;

  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
    return new ProviderError(
      'Gmail API is disabled in the Google Cloud project. Enable it in Google Cloud and retry.',
      {
        code: 'GMAIL_API_DISABLED',
        retryable: false,
        details: { status: status ?? null, reason },
        cause: error,
      },
    );
  }

  if (status === 401 || status === 403 || apiCode === 'invalid_grant') {
    return new ProviderError('Gmail authorization failed. Reconnect the Gmail account.', {
      code: 'GMAIL_AUTH',
      retryable: false,
      details: { status: status ?? null, apiCode: apiCode ?? null },
      cause: error,
    });
  }

  if (status === 429) {
    return new ProviderError('Gmail rate limit exceeded', {
      code: 'GMAIL_RATE_LIMIT',
      retryable: true,
      details: { status },
      cause: error,
    });
  }

  if (status !== undefined && status >= 500) {
    return new ProviderError('Gmail is temporarily unavailable', {
      code: 'GMAIL_UNAVAILABLE',
      retryable: true,
      details: { status },
      cause: error,
    });
  }

  if (status === 400) {
    return new ProviderError('Gmail rejected the message', {
      code: 'GMAIL_BAD_REQUEST',
      retryable: false,
      details: { status, apiCode: apiCode ?? null },
      cause: error,
    });
  }

  if (
    networkCode !== undefined &&
    ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(networkCode)
  ) {
    return new ProviderError('Gmail API network error', {
      code: 'GMAIL_NETWORK',
      retryable: true,
      details: { networkCode },
      cause: error,
    });
  }

  return new ProviderError('Gmail API request failed', {
    code: 'GMAIL_ERROR',
    retryable: false,
    details: { status: status ?? null, apiCode: apiCode ?? null },
    cause: error,
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new ProviderError(`${operation} timed out`, {
          code: 'GMAIL_TIMEOUT',
          retryable: true,
        }),
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

export class GoogleGmailApi implements GmailApi {
  private readonly gmail: gmail_v1.Gmail;

  constructor(
    auth: OAuth2Client,
    private readonly timeoutMs: number,
  ) {
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  async sendRaw(rawBase64Url: string): Promise<{
    id: string;
    threadId: string | null;
    labelIds: string[];
  }> {
    try {
      const response = await withTimeout(
        this.gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw: rawBase64Url },
        }),
        this.timeoutMs,
        'Gmail send',
      );

      const id = response.data.id;
      if (!id) {
        throw new ProviderError('Gmail did not return a message id', {
          code: 'GMAIL_NO_MESSAGE_ID',
          retryable: false,
        });
      }

      return {
        id,
        threadId: response.data.threadId ?? null,
        labelIds: response.data.labelIds ?? [],
      };
    } catch (error) {
      throw mapGmailError(error);
    }
  }

  async getMessageMetadata(messageId: string): Promise<GmailMessageMetadata> {
    try {
      const response = await withTimeout(
        this.gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'metadata',
          metadataHeaders: METADATA_HEADERS,
        }),
        this.timeoutMs,
        'Gmail metadata read',
      );

      return toMetadata(response.data, messageId);
    } catch (error) {
      throw mapGmailError(error);
    }
  }

  async getThreadMetadata(threadId: string): Promise<GmailMessageMetadata[]> {
    try {
      const response = await withTimeout(
        this.gmail.users.threads.get({
          userId: 'me',
          id: threadId,
          format: 'metadata',
          metadataHeaders: METADATA_HEADERS,
        }),
        this.timeoutMs,
        'Gmail thread metadata read',
      );

      return (response.data.messages ?? []).map((message) =>
        toMetadata(message, message.id ?? threadId),
      );
    } catch (error) {
      throw mapGmailError(error);
    }
  }

  async listMessages(query: string, maxResults: number): Promise<GmailMessageRef[]> {
    try {
      const response = await withTimeout(
        this.gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults,
        }),
        this.timeoutMs,
        'Gmail message search',
      );

      return (response.data.messages ?? [])
        .filter((message): message is { id: string; threadId?: string | null } =>
          Boolean(message.id),
        )
        .map((message) => ({
          id: message.id,
          threadId: message.threadId ?? null,
        }));
    } catch (error) {
      throw mapGmailError(error);
    }
  }
}
