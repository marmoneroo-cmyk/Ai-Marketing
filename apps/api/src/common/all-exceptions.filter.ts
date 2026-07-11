import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, fail, type ApiResponse } from '@brandpilot/core';
import type { ErrorCode } from '@brandpilot/core';
import { captureError } from '@brandpilot/observability';

/** Map raw HTTP status codes onto our stable error-code vocabulary. */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'bad_request';
    case HttpStatus.UNAUTHORIZED:
      return 'unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'forbidden';
    case HttpStatus.NOT_FOUND:
      return 'not_found';
    case HttpStatus.CONFLICT:
      return 'conflict';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'rate_limited';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'validation_error';
    default:
      return 'internal_error';
  }
}

/** Extract a human-readable message from a Nest HttpException payload. */
function messageFromHttpException(exception: HttpException): string {
  const payload = exception.getResponse();
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const msg = (payload as { message: unknown }).message;
    if (Array.isArray(msg)) return msg.join(', ');
    if (typeof msg === 'string') return msg;
  }
  return exception.message;
}

/**
 * Global exception filter. Converts every thrown error into the `ApiResponse`
 * envelope. Stack traces are logged server-side but never returned to callers.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    if (exception instanceof AppError) {
      // Report + log genuine server faults (status >= 500, e.g. 'internal_error');
      // expected 4xx client errors (bad_request, unauthorized, not_found, conflict,
      // etc.) are not reported. Reuses the AppError's own statusCode — already
      // derived from the code->status table — instead of duplicating it here.
      if (exception.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
        captureError(exception, { path: request.url, method: request.method });
        this.logger.error(exception.message, exception.stack);
      }
      const body: ApiResponse<never> = fail(exception.code, exception.message, exception.details);
      response.status(exception.statusCode).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      // Report server-side (5xx) HttpExceptions to error tracking; expected
      // 4xx client errors are not captured.
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        captureError(exception, { path: request.url, method: request.method });
      }
      const body = fail(codeForStatus(status), messageFromHttpException(exception));
      response.status(status).json(body);
      return;
    }

    // Unknown: report to error tracking, log the detail, return a generic 500
    // without internals.
    captureError(exception, { path: request.url, method: request.method });
    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : String(exception));
    const body = fail('internal_error', 'An unexpected error occurred');
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
