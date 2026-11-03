export interface AppErrorOptions {
  code: string;
  statusCode: number;
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.details = options.details ?? null;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details?: unknown) {
    super(message, { code: 'VALIDATION_ERROR', statusCode: 400, details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Google account is not connected', details?: unknown) {
    super(message, { code: 'UNAUTHORIZED', statusCode: 401, details });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: unknown) {
    super(message, { code: 'NOT_FOUND', statusCode: 404, details });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: unknown) {
    super(message, { code: 'CONFLICT', statusCode: 409, details });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Daily send limit reached', details?: unknown) {
    super(message, { code: 'RATE_LIMIT', statusCode: 429, details });
  }
}

export class ProviderError extends AppError {
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, {
      code: options.code ?? 'PROVIDER_ERROR',
      statusCode: 502,
      details: options.details,
      cause: options.cause,
    });
    this.retryable = options.retryable ?? false;
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: 'CONFIG_ERROR', statusCode: 500, details });
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
