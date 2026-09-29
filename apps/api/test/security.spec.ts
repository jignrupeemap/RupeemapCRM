/** Phase 18 hardening: sessions, cross-site protection, caching, file names, passwords and production config. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { passwordSchema } from '@rupeemap/shared';
import { createApp } from '../src/bootstrap';
import { contentDisposition } from '../src/common/http-safety';
import { configProblems } from '../src/common/config-check';
import { hashToken, sessionKey } from '../src/common/auth.guard';
import { RedisService } from '../src/common/redis.service';

let app: INestApplication;
let http: any;
const prisma = new PrismaClient();
const IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function loginAs(mobile: string) {
  const r = await request(http).post('/api/v1/auth/login').set('x-forwarded-for', IP).set('x-client', 'mobile').send({ login: mobile, password: 'Rupeemap@123' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { token: r.body.data.token as string, cookie: r.headers['set-cookie'][0] as string };
}

describe('Security hardening', () => {
  it('session cookie is httpOnly and SameSite; API responses are never cached', async () => {
    const { cookie } = await loginAs('9000000003');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const me = await request(http).get('/api/v1/auth/me').set('Cookie', cookie.split(';')[0]);
    expect(me.status).toBe(200);
    expect(me.headers['cache-control']).toBe('no-store');
    expect(me.headers['x-powered-by']).toBeUndefined();
    expect(me.headers['x-content-type-options']).toBe('nosniff');
  });

  it('blocks cookie-based writes that lack the site header (cross-site form posts)', async () => {
    const { cookie } = await loginAs('9000000003');
    const r = await request(http).post('/api/v1/tickets').set('Cookie', cookie.split(';')[0]).send({});
    expect(r.status).toBe(403);
  });

  it('signs out a session that has been idle too long', async () => {
    const { token } = await loginAs('9000000001');
    const ok = await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(ok.status).toBe(200);
    // Simulate 31 minutes of no activity for this Admin session.
    const th = hashToken(token);
    await prisma.session.update({ where: { tokenHash: th }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    await app.get(RedisService).client.del(sessionKey(th));
    const r = await request(http).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(401);
    expect((await prisma.session.findUniqueOrThrow({ where: { tokenHash: th } })).revokedAt).not.toBeNull();
  });

  it('file names with Indian scripts, quotes or line breaks give a safe download header', () => {
    const h = contentDisposition('inline', 'આધાર "card"\r\nSet-Cookie: x.pdf');
    expect(h).not.toMatch(/[\r\n]/);
    expect(h).toMatch(/^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
    expect(h).toContain('%E0%AA%86'); // Gujarati letter kept in the UTF-8 name
    expect(contentDisposition('attachment', '..\\..\\secret.pdf')).toContain('filename="secret.pdf"');
  });

  it('rejects common and easily guessed new passwords', () => {
    for (const p of ['Password@123', 'Rupeemap@123', 'abcd1234', 'aaaaaaaa1', '12345678ab']) expect(passwordSchema.safeParse(p).success, p).toBe(false);
    for (const p of ['Kesar-Mango-47', 'ArjunPass2026']) expect(passwordSchema.safeParse(p).success, p).toBe(true);
  });

  it('refuses to start in production with placeholder secrets', () => {
    expect(configProblems({ NODE_ENV: 'development' })).toEqual([]);
    const bad = configProblems({ NODE_ENV: 'production', OTP_PEPPER: '<random>', REDIS_URL: 'memory://', WEB_ORIGIN: 'http://crm.example', SMS_PROVIDER: 'console' });
    expect(bad.length).toBeGreaterThanOrEqual(5);
    const good = configProblems({
      NODE_ENV: 'production',
      FILE_ENCRYPTION_KEY: 'a'.repeat(64),
      OTP_PEPPER: 'x9'.repeat(20),
      DATABASE_URL: 'postgresql://crm_app:S3cure@db.internal:5432/rupeemap',
      REDIS_URL: 'rediss://cache.internal:6380',
      WEB_ORIGIN: 'https://crm.rupeemap.in',
      SMS_PROVIDER: 'msg91',
    });
    expect(good).toEqual([]);
  });
});
