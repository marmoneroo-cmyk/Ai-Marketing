export const ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'validation_error',
  'internal_error',
  'grounding_insufficient',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  validation_error: 422,
  grounding_insufficient: 422,
  internal_error: 500,
};

/**
 * Application error carrying a stable code + HTTP status. Thrown across
 * services and translated to the API error envelope at the gateway boundary.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export const notFound = (message = 'Not found', details?: unknown): AppError =>
  new AppError('not_found', message, details);
export const forbidden = (message = 'Forbidden', details?: unknown): AppError =>
  new AppError('forbidden', message, details);
export const badRequest = (message = 'Bad request', details?: unknown): AppError =>
  new AppError('bad_request', message, details);
export const groundingInsufficient = (message = 'Insufficient grounding to answer', details?: unknown): AppError =>
  new AppError('grounding_insufficient', message, details);
