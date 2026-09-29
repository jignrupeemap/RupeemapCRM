/** Payout slab limits: 0.90% standard maximum, 0.98% by Admin only, Team Partner share within the DSA slab. */
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
const RUN = String(Date.now()).slice(-5);
const today = new Date().toISOString().slice(0, 10);

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

describe('Payout slab limits', () => {
  let admin: any, exec: any, dsa: any, dsaId: string, tpId: string;
  const dsaMobile = `95${RUN}001`;

  beforeAll(async () => {
    admin = await login('9000000001');
    exec = await login('9000000002');
    const d = await admin.post('/api/v1/users').set(H).send({ name: `Slab DSA ${RUN}`, mobile: dsaMobile, role: 'DSA', payoutPercent: 0.8 });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    dsaId = d.body.data.id;
    const hash = (await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } })).passwordHash;
    await prisma.user.update({ where: { id: dsaId }, data: { status: 'ACTIVE', passwordHash: hash } });
    dsa = await login(dsaMobile);
    const t = await dsa.post('/api/v1/users').set(H).send({ name: `Slab TP ${RUN}`, mobile: `95${RUN}002`, role: 'TEAM_PARTNER', payoutPercent: 0.5 });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    tpId = t.body.data.id;
  });

  it('a DSA can change a Team Partner’s % any time, but never above the DSA slab', async () => {
    const up = await dsa.post(`/api/v1/users/${tpId}/payout-rates`).set(H).send({ percent: 0.6, effectiveFrom: today, reason: 'Top performer' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const over = await dsa.post(`/api/v1/users/${tpId}/payout-rates`).set(H).send({ percent: 0.85, effectiveFrom: today, reason: 'More' });
    expect(over.body.code).toBe('VALIDATION_ERROR');
    expect(over.body.message).toContain('0.8%');
  });

  it('only Admin can set a DSA slab above 0.90%, and never above 0.98%', async () => {
    // Give the Executive the DSA-slab permission to prove the 0.90% ceiling still holds for them.
    const execUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000002' } });
    await admin.put(`/api/v1/users/${execUser.id}/permissions`).set(H).send({ grants: { PAYOUT_PERCENTAGE_UPDATE_DSA: true } });
    // PAYOUT_PERCENTAGE_UPDATE_DSA is Admin-only and cannot be granted to Executives.
    exec = await login('9000000002');
    expect((await exec.post(`/api/v1/users/${dsaId}/payout-rates`).set(H).send({ percent: 0.85, effectiveFrom: today, reason: 'x y z' })).status).toBe(403);

    expect((await admin.post(`/api/v1/users/${dsaId}/payout-rates`).set(H).send({ percent: 0.99, effectiveFrom: today, reason: 'Too high' })).body.code).toBe('VALIDATION_ERROR');
    const ok = await admin.post(`/api/v1/users/${dsaId}/payout-rates`).set(H).send({ percent: 0.95, effectiveFrom: today, reason: 'Special slab' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);

    // The DSA sees their slab and that Admin set it.
    const me = await dsa.get('/api/v1/auth/me');
    expect(me.body.data.payoutSlab).toMatchObject({ percent: 0.95, setByRole: 'ADMIN' });
  });

  it('even with a 0.95% DSA slab, a Team Partner share cannot pass 0.90%', async () => {
    const r = await dsa.post(`/api/v1/users/${tpId}/payout-rates`).set(H).send({ percent: 0.92, effectiveFrom: today, reason: 'Top performer' });
    expect(r.body.code).toBe('VALIDATION_ERROR');
    const adminTry = await admin.post(`/api/v1/users/${tpId}/payout-rates`).set(H).send({ percent: 0.92, effectiveFrom: today, reason: 'Admin try' });
    expect(adminTry.body.code).toBe('VALIDATION_ERROR');
    expect((await dsa.post(`/api/v1/users/${tpId}/payout-rates`).set(H).send({ percent: 0.9, effectiveFrom: today, reason: 'Max share' })).status).toBe(201);
  });

  it('a DSA cannot set rates for another DSA’s Team Partner', async () => {
    const other = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
    const r = await dsa.post(`/api/v1/users/${other.id}/payout-rates`).set(H).send({ percent: 0.3, effectiveFrom: today, reason: 'Not mine' });
    expect(r.status).toBe(403);
  });
});
