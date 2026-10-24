import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaClientKnownRequestError } from '@prisma/client-runtime-utils';
import { ErrorResponse } from '../interfaces';
import { isProduction } from '../env';
import { captureException } from '../sentry';
import { redactUrl, redactUrlsInText } from '../utils/log-redaction';

/**
 * Prisma error code → { httpStatus, appCode, message } mapping.
 * Only maps codes that can reach the HTTP layer safely.
 */
export const PRISMA_ERROR_MAP: Record<string, { status: number; code: string; message: string }> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    code: 'CONFLICT',
    message: 'A record with this value already exists.',
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    code: 'CONFLICT',
    message: 'Cannot delete, record is still referenced by another entity.',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    code: 'NOT_FOUND',
    message: 'The requested record was not found.',
  },
};

export const HTTP_CODE_MAP: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
};

/**
 * Global exception filter.
 *
 * Handles:
 * 1. HttpException — including pre-formatted validation errors from ValidationPipe
 * 2. PrismaClientKnownRequestError — maps P2002/P2025 to safe HTTP responses
 * 3. Unknown errors — generic 500 (no details in production)
 *
 * Response format: { error: { code, message, details? } }
 * Stack traces are stripped in NODE_ENV=production.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId: string = (request as Request & { id?: string }).id ?? 'unknown';
    const isProd = isProduction();

    // ── Prisma known errors ──────────────────────────────────────────────────
    if (exception instanceof PrismaClientKnownRequestError) {
      const mapped = PRISMA_ERROR_MAP[exception.code];
      const status = mapped?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
      const code = mapped?.code ?? 'INTERNAL_SERVER_ERROR';
      const message = mapped?.message ?? 'An unexpected database error occurred.';

      this.logger.error({
        correlationId,
        path: redactUrl(request.url),
        method: request.method,
        prismaCode: exception.code,
        message: redactUrlsInText(exception.message),
      });

      // Only unmapped Prisma errors (5xx) are worth shipping to Sentry —
      // P2002/P2025 are user errors, not operational problems.
      if (!mapped) captureException(exception);

      const body: ErrorResponse = { error: { code, message } };
      response.status(status).json(body);
      return;
    }

    // ── HttpException (including NestJS built-ins + ValidationPipe errors) ───
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      this.logger.error({
        correlationId,
        path: redactUrl(request.url),
        method: request.method,
        statusCode: status,
        message: redactUrlsInText(exception.message),
      });

      // If the ValidationPipe (or any caller) already produced a structured
      // { error: { code: string, message: string, details? } } object, use it directly.
      // We check that error.code and error.message are strings to avoid matching
      // NestJS's built-in { error: 'Not Found', statusCode, message } shape.
      const preFormattedError =
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null &&
        'error' in exceptionResponse
          ? (exceptionResponse as Record<string, unknown>)['error']
          : undefined;

      if (
        preFormattedError !== null &&
        typeof preFormattedError === 'object' &&
        !Array.isArray(preFormattedError) &&
        typeof (preFormattedError as Record<string, unknown>)['code'] === 'string' &&
        typeof (preFormattedError as Record<string, unknown>)['message'] === 'string'
      ) {
        const preFormatted = preFormattedError as {
          code: string;
          message: string;
          details?: unknown;
        };

        const body: ErrorResponse = {
          error: {
            code: preFormatted.code,
            message: preFormatted.message,
            ...(!isProd && preFormatted.details !== undefined
              ? { details: preFormatted.details }
              : {}),
          },
        };
        response.status(status).json(body);
        return;
      }

      // Standard HttpException — derive code + message from status
      const code = HTTP_CODE_MAP[status] ?? 'UNKNOWN_ERROR';
      const message = extractMessage(exceptionResponse, status);

      const body: ErrorResponse = {
        error: {
          code,
          message,
          ...(!isProd && { details: exceptionResponse }),
        },
      };
      response.status(status).json(body);
      return;
    }

    // ── Unknown / unhandled errors ───────────────────────────────────────────
    this.logger.error({
      correlationId,
      path: redactUrl(request.url),
      method: request.method,
      message: redactUrlsInText(exception instanceof Error ? exception.message : String(exception)),
      stack: exception instanceof Error ? exception.stack : undefined,
    });
    captureException(exception);

    const body: ErrorResponse = {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: isProd
          ? 'Internal server error.'
          : exception instanceof Error
            ? exception.message
            : String(exception),
        ...(!isProd && exception instanceof Error ? { details: exception.stack } : {}),
      },
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}

function extractMessage(exceptionResponse: unknown, status: number): string {
  if (typeof exceptionResponse === 'string') return exceptionResponse;
  if (
    typeof exceptionResponse === 'object' &&
    exceptionResponse !== null &&
    'message' in exceptionResponse
  ) {
    const msg = (exceptionResponse as { message: unknown }).message;
    return Array.isArray(msg) ? msg.join(', ') : String(msg);
  }
  return HttpStatus[status] ?? 'Unknown error';
}
