import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { map } from 'rxjs';
import { AppError } from './errors';
import { logger } from './logger';

/** A paginated result; the interceptor moves `meta` next to `data`. */
export class Paged<T> {
  constructor(
    public items: T[],
    public meta: { page: number; pageSize: number; total: number },
  ) {}
}

/** { success, data, message } on every successful response. */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((body) => {
        if (body instanceof Paged) return { success: true, data: body.items, meta: body.meta, message: 'OK' };
        return { success: true, data: body ?? null, message: 'Operation completed successfully' };
      }),
    );
  }
}

/** Never leaks stack traces, SQL or paths. Logs the real error with the request id. */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest();
    const requestId = req?.id;

    let status = 500;
    let body: Record<string, unknown> = {
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
    };

    if (err instanceof AppError) {
      status = err.status;
      body = { success: false, code: err.code, message: err.message, details: err.details };
    } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      status = 409;
      body = { success: false, code: 'CONFLICT', message: 'A record with these details already exists' };
    } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      status = 404;
      body = { success: false, code: 'NOT_FOUND', message: 'Record not found' };
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      body = {
        success: false,
        code: status === 404 ? 'NOT_FOUND' : status === 401 ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : 'VALIDATION_ERROR',
        message: status === 404 ? 'Not found' : status === 413 ? 'File is larger than 10 MB' : 'Request could not be processed',
      };
    }

    if (status >= 500) logger.error({ err, requestId, path: req?.url }, 'unhandled error');
    else if (status === 403) logger.warn({ requestId, userId: req?.user?.id, path: req?.url, method: req?.method }, 'forbidden');

    res.status(status).json({ ...body, requestId });
  }
}
