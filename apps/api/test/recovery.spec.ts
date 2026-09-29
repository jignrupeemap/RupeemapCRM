/** Recovery: staff record clawbacks and demands; partners see their own read-only; outstanding is always computed. */
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
const today = new Date().toISOString().slice(0, 10);
const due = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);

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
  await prisma.loanCase.updateMany({ where: { caseNo: { startsWith: 'REC-TEST-' } }, data: { deletedAt: new Date() } });
  await app.close();
  await prisma.$disconnect();
});

describe('Recovery', () => {
  let admin: any, exec: any, dsa: any, ravi: any, nisha: any;
  let payoutId: string, payout2Id: string, recId: string, version = 0;

  beforeAll(async () => {
    [admin, exec, dsa, ravi, nisha] = await Promise.all(['9000000001', '9000000002', '9000000003', '9000000004', '9000000005'].map(login));
    const mehul = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } });
    const raviU = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
    const bank = await prisma.bank.findFirstOrThrow();
    const make = async (n: number) => {
      const customer = await prisma.customer.create({ data: { name: `Recovery Customer ${n}`, mobile: '9811112222' } });
      const c = await prisma.loanCase.create({
        data: { caseNo: `REC-TEST-${Date.now()}-${n}`, customerId: customer.id, loanType: 'HOME_LOAN', appliedAmount: 2000000, handoverAmount: 2000000, status: 'HANDOVER', bankId: bank.id, dsaId: mehul.id, teamPartnerId: raviU.id, createdById: raviU.id, createdRole: 'TEAM_PARTNER' },
      });
      const p = await prisma.payout.create({ data: { caseId: c.id, beneficiaryId: raviU.id, beneficiaryRole: 'TEAM_PARTNER', baseAmount: 2000000, percentSnapshot: 0.5, amount: 10000, status: 'PAID' } });
      return p.id;
    };
    payoutId = await make(1);
    payout2Id = await make(2);
  });

  it('only staff can record a recovery, never more than the payout', async () => {
    const body = { payoutId, recoveryAmount: 10000, recoveryDate: today, bankRemarks: 'Loan foreclosed in 3 months', reason: 'Bank clawback' };
    expect((await dsa.post('/api/v1/recoveries').set(H).send(body)).status).toBe(403);
    expect((await exec.post('/api/v1/recoveries').set(H).send({ ...body, recoveryAmount: 12000 })).body.code).toBe('VALIDATION_ERROR');
    const r = await exec.post('/api/v1/recoveries').set(H).send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    recId = r.body.data.id;
    version = r.body.data.version;
  });

  it('a demand needs a due date and notifies the partner and their DSA', async () => {
    const noDue = await exec.post(`/api/v1/recoveries/${recId}/actions`).set(H).send({ action: 'RAISE_DEMAND', version, reason: 'Please repay' });
    expect(noDue.body.code).toBe('VALIDATION_ERROR');
    const r = await exec.post(`/api/v1/recoveries/${recId}/actions`).set(H).send({ action: 'RAISE_DEMAND', version, reason: 'Please repay', dueDate: due });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    version = r.body.data.version;
    const raviU = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
    expect(await prisma.notificationRecipient.count({ where: { userId: raviU.id, notification: { title: { startsWith: 'Payout recovery due' } } } })).toBeGreaterThan(0);
  });

  it('partners see their own recovery read-only; other Team Partners never see it', async () => {
    const mine = await ravi.get('/api/v1/recoveries');
    expect(mine.body.data.map((x: any) => x.id)).toContain(recId);
    expect(mine.body.data.find((x: any) => x.id === recId).outstanding).toBe(10000);
    expect((await dsa.get(`/api/v1/recoveries/${recId}`)).status).toBe(200);
    expect((await nisha.get(`/api/v1/recoveries/${recId}`)).status).toBe(404);
    expect((await ravi.post(`/api/v1/recoveries/${recId}/receipts`).set(H).send({ version, amount: 100, receivedOn: today })).status).toBe(403);
    expect((await dsa.post(`/api/v1/recoveries/${recId}/actions`).set(H).send({ action: 'WAIVE', version, reason: 'Please waive' })).status).toBe(403);
  });

  it('receipts move it to partially then fully recovered; outstanding is computed', async () => {
    let r = await exec.post(`/api/v1/recoveries/${recId}/receipts`).set(H).send({ version, amount: 3000, receivedOn: today, reference: 'UPI123' });
    expect(r.body.data).toMatchObject({ status: 'PARTIALLY_RECOVERED', outstanding: 7000 });
    version = r.body.data.version;
    expect((await exec.post(`/api/v1/recoveries/${recId}/receipts`).set(H).send({ version, amount: 7500, receivedOn: today })).body.code).toBe('VALIDATION_ERROR');
    r = await exec.post(`/api/v1/recoveries/${recId}/receipts`).set(H).send({ version, amount: 7000, receivedOn: today, reference: 'NEFT9' });
    expect(r.body.data).toMatchObject({ status: 'FULLY_RECOVERED', outstanding: 0 });
    version = r.body.data.version;
    r = await exec.post(`/api/v1/recoveries/${recId}/actions`).set(H).send({ action: 'CLOSE', version, reason: 'All recovered' });
    expect(r.body.data.status).toBe('CLOSED');
    const d = await admin.get(`/api/v1/recoveries/${recId}`);
    expect(d.body.data.receipts).toHaveLength(2);
    expect(d.body.data.history.length).toBeGreaterThanOrEqual(5);
  });

  it('only Admin can waive, and only Admin sends the WhatsApp demand (no customer contact details)', async () => {
    const c = await exec.post('/api/v1/recoveries').set(H).send({ payoutId: payout2Id, recoveryAmount: 4000, recoveryDate: today, reason: 'Bank clawback' });
    const id2 = c.body.data.id;
    const d = await exec.post(`/api/v1/recoveries/${id2}/actions`).set(H).send({ action: 'RAISE_DEMAND', version: c.body.data.version, reason: 'Repay', dueDate: due });
    expect((await exec.post(`/api/v1/recoveries/${id2}/whatsapp`).set(H)).status).toBe(403);
    const wa = await admin.post(`/api/v1/recoveries/${id2}/whatsapp`).set(H);
    expect(wa.status, JSON.stringify(wa.body)).toBe(201);
    expect(wa.body.data.text).toContain('REC-TEST-');
    expect(wa.body.data.text).toContain('Recovery Customer 2');
    expect(wa.body.data.text).not.toContain('9811112222'); // customer's mobile never goes out
    expect(wa.body.data.url).toContain('wa.me/919000000004');
    expect((await exec.post(`/api/v1/recoveries/${id2}/actions`).set(H).send({ action: 'WAIVE', version: d.body.data.version, reason: 'Goodwill' })).status).toBe(403);
    const w = await admin.post(`/api/v1/recoveries/${id2}/actions`).set(H).send({ action: 'WAIVE', version: d.body.data.version, reason: 'Goodwill' });
    expect(w.body.data.status).toBe('WAIVED');
  });
});
