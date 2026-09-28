import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { AuditService } from './audit.service';
import { ScopeService } from './scope.service';
import { SmsService } from './sms.service';
import { NotifyService } from './notify.service';

@Global()
@Module({
  providers: [PrismaService, RedisService, AuditService, ScopeService, SmsService, NotifyService],
  exports: [PrismaService, RedisService, AuditService, ScopeService, SmsService, NotifyService],
})
export class CommonModule {}
