import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { randomUUID } from 'crypto';
import pinoHttp from 'pino-http';
import { AppModule } from './app.module';
import { logger } from './common/logger';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '256kb' });
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps: (req: any) => ({ userId: req.user?.id }),
      serializers: { req: (r) => ({ method: r.method, url: r.url, id: r.id }), res: (r) => ({ statusCode: r.statusCode }) },
    }),
  );
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true });
  app.enableShutdownHooks();
  return app;
}
