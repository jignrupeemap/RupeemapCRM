/**
 * Partner inactivity: 60-day alert to Admin and Executives, 90-day automatic
 * deactivation, and Admin-only reactivation.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/bootstrap';

let app: INestApplication;
let http: any;
const prisma = new PrismaClient();
const H = { 'x-requested-with': 'rupeemap' };
const RUN = String(Date.now()).slice(-5);
const IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const mob = (n: number) => `97${RUN}${String(n).padStart(3, '0')}`;
const PASSWORD = 'Rupeemap@123';
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

type Agent = ReturnType<typeof request.agent>;
const agent = (): Agent => request.agent(http).set('x-forwarded-for', IP) as unknown as Agent;

async function login(mobile: string) {
  const a = agent();
  const r = await a.post('/api/v1/auth/login').send({ login: mobile, password: PASSWORD });
  return { a, r };
}

/** An activated DSA whose last business was `days` ago. */
async function partner(admin: Agent, n: number, days: number) {
  const mobile = mob(n);
  const r = await admin.post('/api/v1/users').set(H).send({ name: `Idle Partner ${n}`, mobile, role: 'DSA' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const hash = (await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } })).passwordHash;
  await prisma.user.update({ where: { mobile }, data: { status: 'ACTIVE', passwordHash: hash, createdAt: daysAgo(days), activatedAt: daysAgo(days) } });
  return { id: r.body.data.id as string, mobile };
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

describe('Partner inactivity', () => {
  let admin: Agent, exec: Agent;
  let idle95: { id: string; mobile: string }, idle65: { id: string; mobile: string }, fresh: { id: string; mobile: string };

  beforeAll(async () => {
    admin = (await login('9000000001')).a;
    exec = (await login('9000000002')).a;
    idle95 = await partner(admin, 1, 95);
    idle65 = await partner(admin, 2, 65);
    fresh = await partner(admin, 3, 10);
  });

  it('lists partners by days without business, for staff only', async () => {
    const r = await exec.get('/api/v1/inactivity/partners').query({ minDays: 60, q: `97${RUN}` });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const ids = r.body.data.items.map((i: any) => i.id);
    expect(ids).toContain(idle95.id);
    expect(ids).toContain(idle65.id);
    expect(ids).not.toContain(fresh.id);
    const row = r.body.data.items.find((i: any) => i.id === idle65.id);
    expect(row.daysInactive).toBeGreaterThanOrEqual(64);
    const dsa = (await login('9000000003')).a;
    expect((await dsa.get('/api/v1/inactivity/partners')).status).toBe(403);
  });

  it('only Admin can run the check; it alerts at 60 days and deactivates at 90', async () => {
    expect((await exec.post('/api/v1/inactivity/run').set(H)).status).toBe(403);
    const r = await admin.post('/api/v1/inactivity/run').set(H);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.deactivated).toBeGreaterThanOrEqual(1);
    expect(r.body.data.alerted).toBeGreaterThanOrEqual(1);

    const u95 = await prisma.user.findUniqueOrThrow({ where: { id: idle95.id } });
    expect(u95.status).toBe('DEACTIVATED');
    const u65 = await prisma.user.findUniqueOrThrow({ where: { id: idle65.id } });
    expect(u65.status).toBe('ACTIVE');
    expect(u65.inactivityAlertedAt).not.toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fresh.id } })).inactivityAlertedAt).toBeNull();

    const execUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000002' } });
    const n = await prisma.notificationRecipient.findFirst({
      where: { userId: execUser.id, notification: { title: { contains: 'inactive for 60+ days' } } },
      include: { notification: true },
      orderBy: { notification: { createdAt: 'desc' } },
    });
    expect(n?.notification.body).toContain('Idle Partner 2');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'USER_AUTO_DEACTIVATED', entityId: idle95.id } });
    expect(audit).not.toBeNull();
  });

  it('does not alert twice for the same inactive spell', async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: idle65.id } })).inactivityAlertedAt;
    await admin.post('/api/v1/inactivity/run').set(H);
    const after = (await prisma.user.findUniqueOrThrow({ where: { id: idle65.id } })).inactivityAlertedAt;
    expect(after?.getTime()).toBe(before?.getTime());
  });

  it('a deactivated partner cannot sign in', async () => {
    const { r } = await login(idle95.mobile);
    expect(r.status).toBe(403);
    expect(r.body.message).toContain('deactivated');
  });

  it('only Admin can reactivate, with a reason, and the clock restarts', async () => {
    expect((await exec.post(`/api/v1/inactivity/partners/${idle95.id}/reactivate`).set(H).send({ reason: 'Called, will log cases' })).status).toBe(403);
    expect((await exec.post(`/api/v1/users/${idle95.id}/status`).set(H).send({ action: 'ACTIVATE', reason: 'Trying the back door' })).status).toBe(403);
    expect((await admin.post(`/api/v1/users/${idle95.id}/status`).set(H).send({ action: 'ACTIVATE', reason: 'Wrong button' })).status).toBe(403);
    expect((await admin.post(`/api/v1/inactivity/partners/${idle95.id}/reactivate`).set(H).send({})).status).toBe(400);

    const r = await admin.post(`/api/v1/inactivity/partners/${idle95.id}/reactivate`).set(H).send({ reason: 'Called, will log cases this month' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe('ACTIVE');
    expect((await login(idle95.mobile)).r.status).toBe(201);

    const list = await admin.get('/api/v1/inactivity/partners').query({ minDays: 30, q: idle95.mobile });
    expect(list.body.data.items.map((i: any) => i.id)).not.toContain(idle95.id);
    expect(await prisma.auditLog.findFirst({ where: { action: 'USER_REACTIVATED', entityId: idle95.id } })).not.toBeNull();
  });
});
