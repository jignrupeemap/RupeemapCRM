import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AppError } from './errors';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }

  /** Fixed-window rate limit. Throws RATE_LIMITED when exceeded. */
  async limit(key: string, max: number, windowSec: number, message = 'Too many attempts. Please wait and try again.') {
    const k = `rl:${key}`;
    const n = await this.client.incr(k);
    if (n === 1) await this.client.expire(k, windowSec);
    if (n > max) throw new AppError('RATE_LIMITED', message);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const v = await this.client.get(key);
    return v ? (JSON.parse(v) as T) : null;
  }

  async setJson(key: string, value: unknown, ttlSec: number) {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSec);
  }
}
