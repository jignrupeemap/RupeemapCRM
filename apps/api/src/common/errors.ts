import { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@rupeemap/shared';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  INVALID_TRANSITION: HttpStatus.CONFLICT,
  KYC_NOT_APPROVED: HttpStatus.CONFLICT,
  DUPLICATE_SUSPECTED: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Business error with a safe, user-facing message. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
  get status() {
    return STATUS[this.code];
  }
}

export const forbidden = (msg = 'You are not authorized to perform this action') => new AppError('FORBIDDEN', msg);
export const notFound = (what = 'Record') => new AppError('NOT_FOUND', `${what} not found`);
export const conflict = (msg = 'This record was changed by someone else. Reload and try again.') =>
  new AppError('CONFLICT', msg);
