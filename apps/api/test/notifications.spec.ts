/** Notifications: who can send to whom, scheduling, attachments and read tracking. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/bootstrap';

let app: INestApplication;
let http: any;
const prisma = new PrismaClient();
const H = { 'x-requested-with': 'rupeemap' };
const IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const RUN = String(Date.now()).slice(-6);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function login(mobile: string) {
  const a = request.agent(http).set('x-forwarded-for', IP);
  const r = await a.post('/api/v1/auth/login').send({ login: mobile, password: 'Rupeemap@123' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return a;
}

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Notifications', () => {
  let admin: any, exec: any, dsa: any, ravi: any;
  let noticeId: string;

  beforeAll(async () => {
    [admin, exec, dsa, ravi] = await Promise.all(['9000000001', '9000000002', '9000000003', '9000000004'].map(login));
  });

  it('only Admin broadcasts by default; Executives send to one person; partners cannot send', async () => {
    const b = { audience: 'DSA', title: `Diwali offer ${RUN}`, body: 'Extra 0.05% on Home Loan handovers this month' };
    expect((await exec.post('/api/v1/notifications').set(H).send(b)).status).toBe(403);
    expect((await dsa.post('/api/v1/notifications').set(H).send({ ...b, audience: 'USER', userId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } })).id })).status).toBe(403);
    const ravi = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
    expect((await exec.post('/api/v1/notifications').set(H).send({ ...b, audience: 'USER', userId: ravi.id, title: `Personal ${RUN}` })).status).toBe(201);
  });

  it('Admin sends to all Team Partners with a PDF attachment; only recipients can open it', async () => {
    const r = await admin
      .post('/api/v1/notifications')
      .set(H)
      .field('audience', 'TEAM_PARTNER')
      .field('title', `Payout policy ${RUN}`)
      .field('body', 'Please read the updated payout policy')
      .field('priority', 'HIGH')
      .attach('file', PDF, 'payout-policy.pdf');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    noticeId = r.body.data.id;
    const mine = await ravi.get('/api/v1/notifications');
    const n = mine.body.data.items.find((x: any) => x.id === noticeId);
    expect(n.attachment.originalName).toBe('payout-policy.pdf');
    expect((await ravi.get(`/api/v1/notifications/${noticeId}/attachment`)).status).toBe(200);
    expect((await dsa.get(`/api/v1/notifications/${noticeId}/attachment`)).status).toBe(404); // DSAs were not in this audience
  });

  it('scheduled notifications appear only from their start date, and expire', async () => {
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const r = await admin.post('/api/v1/notifications').set(H).send({ audience: 'TEAM_PARTNER', title: `Scheduled ${RUN}`, body: 'Coming soon', startsAt: future });
    expect(r.status).toBe(201);
    const titles = (await ravi.get('/api/v1/notifications')).body.data.items.map((x: any) => x.title);
    expect(titles).not.toContain(`Scheduled ${RUN}`);
    const bad = await admin.post('/api/v1/notifications').set(H).send({ audience: 'ALL', title: 'Bad dates', body: 'x y z', startsAt: future, expiresAt: new Date().toISOString() });
    expect(bad.body.code).toBe('VALIDATION_ERROR');
  });

  it('staff see what was sent and how many have read it', async () => {
    await ravi.post(`/api/v1/notifications/${noticeId}/read`).set(H);
    const sent = await admin.get('/api/v1/notifications/sent');
    const row = sent.body.data.find((x: any) => x.id === noticeId);
    expect(row.recipients).toBeGreaterThanOrEqual(2);
    expect(row.read).toBeGreaterThanOrEqual(1);
    expect((await dsa.get('/api/v1/notifications/sent')).status).toBe(403);
  });
});
