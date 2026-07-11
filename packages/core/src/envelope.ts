import type { ErrorCode } from './errors';

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
}

/** Consistent response envelope for every API endpoint. */
export type ApiResponse<T> =
  | { success: true; data: T; meta?: PaginationMeta }
  | { success: false; error: { code: ErrorCode; message: string; details?: unknown } };

export function ok<T>(data: T, meta?: PaginationMeta): ApiResponse<T> {
  return meta ? { success: true, data, meta } : { success: true, data };
}

export function fail(code: ErrorCode, message: string, details?: unknown): ApiResponse<never> {
  return {
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}
