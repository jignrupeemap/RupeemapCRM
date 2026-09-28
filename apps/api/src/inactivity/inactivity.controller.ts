import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { InactivityService } from './inactivity.service';
import { parse } from '../common/validate';
import { forbidden } from '../common/errors';
import { CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Enter a reason').max(500) });

/** Inactive Partners: Admin and Executives with user access. */
@Controller('inactivity')
export class InactivityController {
  constructor(private readonly inactivity: InactivityService) {}

  private staffOnly(user: AuthUser) {
    if (user.role !== 'ADMIN' && user.role !== 'EXECUTIVE') throw forbidden();
  }

  @Get('partners')
  @RequirePermission('USER_VIEW')
  report(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    this.staffOnly(user);
    return this.inactivity.report(q);
  }

  @Get('summary')
  @RequirePermission('USER_VIEW')
  summary(@CurrentUser() user: AuthUser) {
    this.staffOnly(user);
    return this.inactivity.summary();
  }

  /** Admin can run today's check on demand (it is also run automatically once a day). */
  @Post('run')
  run(@CurrentUser() user: AuthUser, @Meta() meta: RequestMeta) {
    if (user.role !== 'ADMIN') throw forbidden();
    return this.inactivity.check(user, meta);
  }

  @Post('partners/:id/reactivate')
  reactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.inactivity.reactivate(user, id, parse(reasonSchema, body).reason, meta);
  }
}
