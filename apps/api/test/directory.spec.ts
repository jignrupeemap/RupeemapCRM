/** Bankwise Codes and Banker Directory: staff manage, partners see only what is marked visible, sharing is audited. */
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

describe('Bankwise Codes', () => {
  let admin: any, exec: any, tp: any, bankId: string, hiddenId: string;

  beforeAll(async () => {
    [admin, exec, tp] = await Promise.all(['9000000001', '9000000002', '9000000004'].map(login));
    bankId = (await prisma.bank.findFirstOrThrow({ where: { name: 'Axis Bank' } })).id;
  });

  it('Executives add codes; duplicates and partner edits are refused', async () => {
    const body = { bankId, product: 'Home Loan', code: `AXIS-${RUN}`, city: 'Ahmedabad' };
    const r = await exec.post('/api/v1/bank-codes').set(H).send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await exec.post('/api/v1/bank-codes').set(H).send({ ...body, code: `axis-${RUN}` })).body.code).toBe('CONFLICT');
    expect((await tp.post('/api/v1/bank-codes').set(H).send({ ...body, code: `X-${RUN}` })).status).toBe(403);
    const hidden = await exec.post('/api/v1/bank-codes').set(H).send({ ...body, code: `AXIS-STAFF-${RUN}`, visibleToPartners: false });
    hiddenId = hidden.body.data.id;
    await exec.post('/api/v1/bank-codes').set(H).send({ ...body, code: `AXIS-OLD-${RUN}`, effectiveFrom: '2025-01-01', expiresOn: '2025-12-31' });
  });

  it('partners only see current codes marked visible to them', async () => {
    const codes = (await tp.get('/api/v1/bank-codes').query({ q: RUN })).body.data.map((c: any) => c.code);
    expect(codes).toContain(`AXIS-${RUN}`);
    expect(codes).not.toContain(`AXIS-STAFF-${RUN}`);
    expect(codes).not.toContain(`AXIS-OLD-${RUN}`);
    const staff = (await admin.get('/api/v1/bank-codes').query({ q: RUN, show: 'all' })).body.data.map((c: any) => c.code);
    expect(staff).toEqual(expect.arrayContaining([`AXIS-${RUN}`, `AXIS-STAFF-${RUN}`, `AXIS-OLD-${RUN}`]));
    await admin.delete(`/api/v1/bank-codes/${hiddenId}`).set(H);
    expect((await admin.get('/api/v1/bank-codes').query({ q: `AXIS-STAFF-${RUN}`, show: 'all' })).body.data).toHaveLength(0);
  });
});

describe('Banker Directory', () => {
  let admin: any, exec: any, dsa: any, bankerId: string, hiddenId: string;

  beforeAll(async () => {
    [admin, exec, dsa] = await Promise.all(['9000000001', '9000000002', '9000000003'].map(login));
  });

  it('staff add bankers with any designation; partners cannot', async () => {
    const bank = await prisma.bank.findFirstOrThrow({ where: { name: 'Kotak Mahindra Bank' } });
    const d = await exec.post('/api/v1/banker-designations').set(H).send({ name: `Cluster Head ${RUN}`, level: 2 });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const r = await exec.post('/api/v1/bankers').set(H).send({ bankId: bank.id, designationId: d.body.data.id, name: `Anil Verma ${RUN}`, mobile: `97${RUN}11`, email: `anil${RUN}@kotak.example`, city: 'Ahmedabad' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    bankerId = r.body.data.id;
    const h = await exec.post('/api/v1/bankers').set(H).send({ bankId: bank.id, name: `Hidden Banker ${RUN}`, visibleToPartners: false });
    hiddenId = h.body.data.id;
    expect((await exec.post('/api/v1/bankers').set(H).send({ bankId: bank.id, name: 'Duplicate', mobile: `97${RUN}11` })).body.code).toBe('CONFLICT');
    expect((await dsa.post('/api/v1/bankers').set(H).send({ bankId: bank.id, name: 'Nope' })).status).toBe(403);
  });

  it('partners only see bankers marked visible to them', async () => {
    const names = (await dsa.get('/api/v1/bankers').query({ q: RUN })).body.data.map((b: any) => b.name);
    expect(names).toContain(`Anil Verma ${RUN}`);
    expect(names).not.toContain(`Hidden Banker ${RUN}`);
  });

  it('sharing builds a contact card, needs permission, and is audited', async () => {
    expect((await dsa.post('/api/v1/bankers/share').set(H).send({ ids: [bankerId], channel: 'WHATSAPP' })).status).toBe(403);
    const r = await exec.post('/api/v1/bankers/share').set(H).send({ ids: [bankerId, hiddenId], channel: 'WHATSAPP', to: '9876543210' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.count).toBe(2);
    expect(r.body.data.text).toContain(`Anil Verma ${RUN} · Cluster Head ${RUN}`);
    expect(r.body.data.url).toContain('wa.me/919876543210');
    const mail = await exec.post('/api/v1/bankers/share').set(H).send({ ids: [bankerId], channel: 'EMAIL', to: 'dsa@example.com' });
    expect(mail.body.data.url.startsWith('mailto:dsa@example.com')).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'BANKERS_SHARED' } })).toBeGreaterThanOrEqual(2);
  });

  it('only Admin can delete a banker (soft delete)', async () => {
    expect((await exec.delete(`/api/v1/bankers/${hiddenId}`).set(H)).status).toBe(403);
    expect((await admin.delete(`/api/v1/bankers/${hiddenId}`).set(H)).status).toBe(200);
    const row = await prisma.bankerContact.findUniqueOrThrow({ where: { id: hiddenId } });
    expect(row.deletedAt).not.toBeNull();
  });
});
