import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { AppError } from './errors';

const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

/** REDIS_URL=memory:// runs an in-process store for local development without a Redis server. */
function createClient(): Redis {
  if (url.startsWith('memory:')) {
    if (process.env.NODE_ENV === 'production') throw new Error('In-memory Redis is not allowed in production');
    return new RedisMock() as unknown as Redis;
  }
  return new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = createClient();

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
