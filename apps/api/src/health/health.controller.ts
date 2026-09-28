import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { Public } from '../common/auth-context';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness: no infrastructure details. */
  @Public()
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: checks dependencies; meant for the internal network / load balancer. */
  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const check = async (fn: () => Promise<unknown>) => {
      try {
        await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000))]);
        return 'up';
      } catch {
        return 'down';
      }
    };
    const [database, redis] = await Promise.all([check(() => this.prisma.$queryRaw`SELECT 1`), check(() => this.redis.client.ping())]);
    const ok = database === 'up' && redis === 'up';
    if (!ok) res.status(503);
    return { status: ok ? 'ready' : 'degraded', database, redis };
  }
}
