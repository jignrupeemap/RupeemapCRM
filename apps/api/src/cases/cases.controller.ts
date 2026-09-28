import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { caseTransitionSchema, createCaseSchema } from '@rupeemap/shared';
import { CasesService, correctionSchema } from './cases.service';
import { parse } from '../common/validate';
import { CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';

const remarkSchema = z.object({ body: z.string().trim().min(1, 'Enter a remark').max(2000) });

@Controller('cases')
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: unknown) {
    return this.cases.list(user, q);
  }

  @Post('check-duplicate')
  @RequirePermission('CASE_CREATE')
  checkDuplicate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const b = parse(createCaseSchema.pick({ customerMobile: true, customerPan: true, customerName: true }).partial(), body);
    return this.cases.findDuplicates(user, b);
  }

  @Post()
  @RequirePermission('CASE_CREATE')
  create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.cases.create(user, parse(createCaseSchema, body), meta);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cases.detail(user, id);
  }

  @Post(':id/transitions')
  transition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Meta() meta: RequestMeta,
    @Headers('idempotency-key') idem?: string,
  ) {
    const b = parse(caseTransitionSchema, body);
    return this.cases.transition(user, id, b.action, b.version, b.data, meta, idem?.slice(0, 100));
  }

  @Post(':id/corrections')
  correct(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.cases.correct(user, id, parse(correctionSchema, body), meta);
  }

  @Post(':id/remarks')
  remark(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.cases.addRemark(user, id, parse(remarkSchema, body).body, meta);
  }
}
