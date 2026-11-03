import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ValidationError } from './errors';
import type {
  AttachmentInput,
  ValidatedAttachment,
  ValidatedSendRequest,
  ValidationOptions,
} from './types';

const DEFAULT_MAX_RECIPIENTS = 50;
const DEFAULT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_ATTACHMENTS = 10;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;
const STRICT_BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}

function toEmailArray(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .split(/[,;]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  if (Array.isArray(value)) {
    return value.map((part) => (typeof part === 'string' ? part.trim() : part));
  }
  return value;
}

function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  return emails.filter((email) => {
    const key = email.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isStrictBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !STRICT_BASE64_PATTERN.test(value)) {
    return false;
  }
  return Buffer.from(value, 'base64').toString('base64') === value;
}

function isSafeFilename(value: string): boolean {
  return (
    value !== '.' &&
    value !== '..' &&
    !/[/\\]/.test(value) &&
    !/[\r\n\0]/.test(value) &&
    value.trim().length > 0
  );
}

function buildAttachmentSchema(maxAttachmentBytes: number) {
  return z
    .strictObject({
      filename: z
        .string()
        .trim()
        .min(1, 'Attachment filename is required')
        .max(255, 'Attachment filename is too long')
        .refine(isSafeFilename, 'Attachment filename contains invalid characters'),
      mimeType: z
        .string()
        .trim()
        .max(255)
        .regex(MIME_TYPE_PATTERN, 'Attachment MIME type is invalid'),
      contentBase64: z
        .string()
        .min(1, 'Attachment content is required')
        .refine(isStrictBase64, 'Attachment content must be valid base64'),
    })
    .transform((value, context): ValidatedAttachment | typeof z.NEVER => {
      const content = Buffer.from(value.contentBase64, 'base64');
      if (content.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['contentBase64'],
          message: 'Attachment content is empty',
        });
        return z.NEVER;
      }
      if (content.length > maxAttachmentBytes) {
        context.addIssue({
          code: 'custom',
          path: ['contentBase64'],
          message: 'Attachment exceeds the maximum size',
        });
        return z.NEVER;
      }
      return {
        filename: value.filename,
        mimeType: value.mimeType,
        size: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        content,
      };
    });
}

function bodyString(maxBodyBytes: number) {
  return z
    .string()
    .nullish()
    .transform((value): string | null => {
      if (value === null || value === undefined || value.trim().length === 0) {
        return null;
      }
      return value;
    })
    .refine(
      (value) => value === null || Buffer.byteLength(value, 'utf8') <= maxBodyBytes,
      'Body exceeds the maximum size',
    );
}

export function validateSendRequest(
  input: unknown,
  options: ValidationOptions = {},
): ValidatedSendRequest {
  const maxRecipients = options.maxRecipients ?? DEFAULT_MAX_RECIPIENTS;
  const maxAttachmentBytes = options.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
  const maxAttachments = options.maxAttachments ?? DEFAULT_MAX_ATTACHMENTS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  const emailArray = (max: number, field: string) =>
    z.preprocess(
      toEmailArray,
      z
        .array(
          z
            .email(`${field} contains an invalid email address`)
            .refine((email) => !hasLineBreak(email), `${field} contains an invalid email address`),
        )
        .transform(dedupeEmails)
        .refine((emails) => emails.length <= max, `${field} has too many recipients`),
    );

  const schema = z
    .strictObject({
      clientId: z
        .string()
        .trim()
        .regex(
          /^[a-z0-9][a-z0-9-]{0,62}$/,
          'clientId must be lowercase letters, digits, or dashes',
        ),
      to: emailArray(maxRecipients, 'to').refine(
        (emails) => emails.length > 0,
        'At least one recipient is required',
      ),
      cc: emailArray(maxRecipients, 'cc')
        .optional()
        .transform((value) => value ?? []),
      bcc: emailArray(maxRecipients, 'bcc')
        .optional()
        .transform((value) => value ?? []),
      subject: z
        .string()
        .trim()
        .min(1, 'Subject is required')
        .max(200, 'Subject is too long')
        .refine((value) => !hasLineBreak(value), 'Subject must not contain line breaks'),
      html: bodyString(maxBodyBytes).optional(),
      text: bodyString(maxBodyBytes).optional(),
      attachments: z
        .array(buildAttachmentSchema(maxAttachmentBytes))
        .max(maxAttachments, `At most ${maxAttachments} attachments are allowed`)
        .optional()
        .transform((value) => value ?? []),
      idempotencyKey: z
        .string()
        .regex(UUID_PATTERN, 'idempotencyKey must be a UUID')
        .optional()
        .transform((value) => value ?? randomUUID()),
    })
    .transform((value) => ({
      ...value,
      html: value.html ?? null,
      text: value.text ?? null,
      to: dedupeEmails(value.to),
      cc: dedupeEmails(value.cc),
      bcc: dedupeEmails(value.bcc),
    }))
    .superRefine((value, context) => {
      if (value.to.length === 0) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: 'At least one recipient is required',
        });
      }
      if (value.html === null && value.text === null) {
        context.addIssue({
          code: 'custom',
          path: ['html'],
          message: 'A plain-text or HTML body is required',
        });
      }
      const totalRecipients = value.to.length + value.cc.length + value.bcc.length;
      if (totalRecipients > maxRecipients) {
        context.addIssue({
          code: 'custom',
          path: ['to'],
          message: `At most ${maxRecipients} recipients are allowed across To, Cc, and Bcc`,
        });
      }
      const totalAttachmentBytes = value.attachments.reduce(
        (total, attachment) => total + attachment.size,
        0,
      );
      if (totalAttachmentBytes > maxAttachmentBytes) {
        context.addIssue({
          code: 'custom',
          path: ['attachments'],
          message: 'Attachments exceed the maximum total size',
        });
      }
    });

  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      'Invalid send request',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    );
  }

  return result.data;
}

export type { AttachmentInput };
