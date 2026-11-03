import { createHash, randomUUID } from 'node:crypto';
import { ConflictError } from './errors';
import type { ValidatedSendRequest } from './types';

export function createIdempotencyKey(): string {
  return randomUUID();
}

export function createMessageId(fromEmail: string, id: string = randomUUID()): string {
  const atIndex = fromEmail.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === fromEmail.length - 1) {
    throw new Error('Sender email must contain a domain');
  }
  const domain = fromEmail.slice(atIndex + 1).trim();
  if (domain.length === 0) {
    throw new Error('Sender email must contain a domain');
  }
  return `<${id}@${domain}>`;
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashSendRequest(request: ValidatedSendRequest): string {
  const canonical = {
    clientId: request.clientId,
    to: request.to.map((email) => email.toLowerCase()).sort(),
    cc: request.cc.map((email) => email.toLowerCase()).sort(),
    bcc: request.bcc.map((email) => email.toLowerCase()).sort(),
    subject: request.subject,
    html: request.html ?? '',
    text: request.text ?? '',
    attachments: request.attachments.map((attachment) => ({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      sha256: attachment.sha256,
    })),
  };

  return createHash('sha256').update(stableStringify(canonical)).digest('hex');
}

export function assertIdempotencyMatch(existingHash: string, requestHash: string): void {
  if (existingHash !== requestHash) {
    throw new ConflictError('This idempotency key was already used with different content');
  }
}
