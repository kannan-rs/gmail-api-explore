import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../domain/errors';

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

function isFastifyError(error: unknown): error is FastifyError {
  return typeof error === 'object' && error !== null && 'statusCode' in error;
}

export function toErrorResponse(error: unknown): { statusCode: number; body: ErrorBody } {
  if (error instanceof AppError) {
    const body: ErrorBody = {
      error: {
        code: error.code,
        message: error.message,
      },
    };
    if (error.details !== null) {
      body.error.details = error.details;
    }
    return { statusCode: error.statusCode, body };
  }

  if (isFastifyError(error)) {
    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    if (statusCode < 500) {
      return {
        statusCode,
        body: {
          error: {
            code: 'BAD_REQUEST',
            message: error.message,
          },
        },
      };
    }
  }

  return {
    statusCode: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
      },
    },
  };
}

export function errorHandler(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const response = toErrorResponse(error);
  if (response.statusCode >= 500) {
    request.log.error(
      {
        code: response.body.error.code,
        name: error instanceof Error ? error.name : 'UnknownError',
        stack: error instanceof Error ? error.stack : undefined,
      },
      'request failed',
    );
  }
  return reply.code(response.statusCode).send(response.body);
}
