import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { createUserSchema, payoutRateSchema, userContactSchema, userStatusActionSchema } from '@rupeemap/shared';
import { UsersService } from './users.service';
import { parse } from '../common/validate';
import { CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';

const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Enter a reason').max(500) });
const permissionsSchema = z.object({ grants: z.record(z.boolean()) });
const kycSchema = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().trim().max(500).optional() });

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.users.create(user, parse(createUserSchema, body), meta);
  }

  @Get()
  @RequirePermission('USER_VIEW')
  list(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    return this.users.list(user, q);
  }

  /** Profile card (name, mobile, email, office and residence address) for Admin / Admin Executive. */
  @Get(':id/card')
  @RequirePermission('USER_VIEW')
  card(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.card(user, id);
  }

  @Patch(':id/contact')
  @RequirePermission('USER_VIEW')
  contact(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.users.updateContact(user, id, parse(userContactSchema, body), meta);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.detail(user, id);
  }

  @Post(':id/status')
  @RequirePermission('USER_BLOCK')
  status(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.users.changeStatus(user, id, parse(userStatusActionSchema, body), meta);
  }

  @Post(':id/reset-password')
  @RequirePermission('USER_RESET_PASSWORD')
  reset(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    return this.users.resetPassword(user, id, meta);
  }

  @Post(':id/promote')
  @RequirePermission('USER_PROMOTE')
  promote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.users.promote(user, id, parse(reasonSchema, body).reason, meta);
  }

  @Put(':id/permissions')
  @RequirePermission('PERMISSION_MANAGE')
  permissions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.users.setPermissions(user, id, parse(permissionsSchema, body).grants, meta);
  }

  @Post(':id/payout-rates')
  rate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.users.setPayoutRate(user, id, parse(payoutRateSchema, body), meta);
  }

  @Post(':id/kyc')
  @RequirePermission('KYC_VERIFY')
  kyc(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(kycSchema, body);
    return this.users.setKycStatus(user, id, b.decision, b.reason, meta);
  }
}
