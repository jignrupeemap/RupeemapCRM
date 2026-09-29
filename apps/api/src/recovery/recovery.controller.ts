import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { recoveryActionSchema, recoveryCreateSchema, recoveryMessageSchema, recoveryReceiptSchema } from '@rupeemap/shared';
import { RecoveryService } from './recovery.service';
import { parse } from '../common/validate';
import { CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';

@Controller('recoveries')
export class RecoveryController {
  constructor(private readonly recovery: RecoveryService) {}

  @Get()
  @RequirePermission('RECOVERY_VIEW')
  list(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    return this.recovery.list(user, q);
  }

  @Get(':id')
  @RequirePermission('RECOVERY_VIEW')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.recovery.detail(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.recovery.create(user, parse(recoveryCreateSchema, body), meta);
  }

  @Post(':id/actions')
  act(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.recovery.act(user, id, parse(recoveryActionSchema, body), meta);
  }

  @Post(':id/receipts')
  receipt(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.recovery.receipt(user, id, parse(recoveryReceiptSchema, body), meta);
  }

  /** Send recovery details to the partner / their DSA by in-app notification, WhatsApp or email. */
  @Post(':id/send')
  @RequirePermission('RECOVERY_UPDATE')
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    return this.recovery.send(user, id, parse(recoveryMessageSchema, body), meta);
  }
}
