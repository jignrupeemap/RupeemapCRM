import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from './logger';

export type Tx = Prisma.TransactionClient;

/** How long start-up waits for the database (it may still be recovering after a restart). */
const CONNECT_ATTEMPTS = 30;
const CONNECT_DELAY_MS = 2000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.$connect();
        await this.$queryRaw`SELECT 1`;
        return;
      } catch (err) {
        if (attempt >= CONNECT_ATTEMPTS) throw err;
        logger.warn({ attempt, err: (err as Error).message.split('\n').pop() }, 'database not ready yet, retrying');
        await this.$disconnect().catch(() => undefined);
        await new Promise((r) => setTimeout(r, CONNECT_DELAY_MS));
      }
    }
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
