import { Injectable } from '@nestjs/common';
import { logger } from './logger';
import { RedisService } from './redis.service';

/**
 * SMS provider adapter. Development uses a console provider and keeps the last
 * message per mobile in Redis so the preview and E2E tests can read it.
 * Production plugs in a DLT-registered provider (MSG91, Twilio, etc.).
 */
@Injectable()
export class SmsService {
  constructor(private readonly redis: RedisService) {}

  async send(mobile: string, message: string, meta: { otp?: string } = {}) {
    const provider = process.env.SMS_PROVIDER ?? 'console';
    if (provider === 'console') {
      if (process.env.NODE_ENV !== 'production') {
        await this.redis.client.set(`dev:sms:${mobile}`, JSON.stringify({ message, otp: meta.otp, at: new Date() }), 'EX', 900);
      }
      logger.info({ to: mobile.slice(0, 2) + '******' + mobile.slice(-2) }, 'sms queued (console provider)');
      return;
    }
    throw new Error(`SMS provider ${provider} is not configured`);
  }
}
