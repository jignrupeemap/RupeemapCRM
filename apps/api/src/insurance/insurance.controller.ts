import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { insurancePayoutUpdateSchema, insurancePolicySchema } from '@rupeemap/shared';
import { InsuranceService } from './insurance.service';
import { parse } from '../common/validate';
import { CurrentUser, Meta, type AuthUser, type RequestMeta } from '../common/auth-context';

@Controller()
export class InsuranceController {
  constructor(private readonly insurance: InsuranceService) {}

  @Get('insurance')
  list(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    return this.insurance.list(user, q);
  }

  @Get('cases/:id/insurance')
  forCase(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.insurance.forCase(user, id);
  }

  @Post('cases/:id/insurance')
  create(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.insurance.create(user, id, parse(insurancePolicySchema, body), meta);
  }

  @Patch('insurance/:id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.insurance.update(user, id, parse(insurancePolicySchema, body), meta);
  }

  @Patch('insurance/:id/payout')
  payout(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.insurance.updatePayout(user, id, parse(insurancePayoutUpdateSchema, body), meta);
  }
}
