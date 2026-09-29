/** Insurance: staff manage it; Rupeemap keeps 100% of the commission; partners never see or share it. */
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
  // Leave the shared test database as we found it.
  await prisma.loanCase.updateMany({ where: { caseNo: { startsWith: 'INS-TEST-' } }, data: { deletedAt: new Date() } });
  await app.close();
  await prisma.$disconnect();
});

describe('Insurance', () => {
  let caseId: string, policyId: string, admin: any, exec: any, dsa: any;
  const policy = { companyName: 'HDFC Life', productName: 'Home Loan Protect', insuranceAmount: 4000000, premiumAmount: 38500, managerName: 'Rohit Shah', managerMobile: '9825099999', payoutAmount: 7700 };

  beforeAll(async () => {
    admin = await login('9000000001');
    exec = await login('9000000002');
    dsa = await login('9000000003');
    const mehul = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } });
    const bank = await prisma.bank.findFirstOrThrow();
    const customer = await prisma.customer.create({ data: { name: 'Insurance Test Customer' } });
    const c = await prisma.loanCase.create({
      data: { caseNo: `INS-TEST-${Date.now()}`, customerId: customer.id, loanType: 'HOME_LOAN', appliedAmount: 4000000, bankId: bank.id, dsaId: mehul.id, createdById: mehul.id, createdRole: 'DSA' },
    });
    caseId = c.id;
  });

  it('partners cannot add insurance; staff can, with Rupeemap’s commission', async () => {
    expect((await dsa.post(`/api/v1/cases/${caseId}/insurance`).set(H).send(policy)).status).toBe(403);
    const r = await exec.post(`/api/v1/cases/${caseId}/insurance`).set(H).send(policy);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    policyId = r.body.data.id;
    expect(Number(r.body.data.payout.amount)).toBe(7700);
  });

  it('the DSA sees the policy on their case but never the commission', async () => {
    const r = await dsa.get(`/api/v1/cases/${caseId}/insurance`);
    expect(r.status).toBe(200);
    expect(r.body.data.policies[0].companyName).toBe('HDFC Life');
    expect(r.body.data.policies[0].payout).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('7700');
    expect((await dsa.get('/api/v1/insurance')).status).toBe(403);
    const other = await login('9000000004');
    expect((await other.get(`/api/v1/cases/${caseId}/insurance`)).status).toBe(404); // not their case
  });

  it('commission moves Pending → Confirmed → Received with a reason and history', async () => {
    const s0 = await exec.get(`/api/v1/cases/${caseId}/insurance`);
    let v = s0.body.data.policies[0].payout.version;
    const skip = await exec.patch(`/api/v1/insurance/${policyId}/payout`).set(H).send({ version: v, status: 'RECEIVED', reason: 'Skip' });
    expect(skip.body.code).toBe('INVALID_TRANSITION');
    let r = await exec.patch(`/api/v1/insurance/${policyId}/payout`).set(H).send({ version: v, status: 'CONFIRMED', amount: 8000, reason: 'Insurer statement' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    v = r.body.data.version;
    r = await admin.patch(`/api/v1/insurance/${policyId}/payout`).set(H).send({ version: v, status: 'RECEIVED', reference: 'NEFT998', reason: 'Credited' });
    expect(r.body.data.status).toBe('RECEIVED');
    const locked = await admin.patch(`/api/v1/insurance/${policyId}/payout`).set(H).send({ version: r.body.data.version, amount: 9000, reason: 'Change' });
    expect(locked.body.code).toBe('INVALID_TRANSITION');
    const hist = await prisma.insurancePayoutHistory.count({ where: { payout: { policyId } } });
    expect(hist).toBe(3);
  });

  it('insurance never creates or changes partner payouts', async () => {
    expect(await prisma.payout.count({ where: { caseId } })).toBe(0);
    const d = await dsa.get('/api/v1/dashboard/summary');
    expect(d.body.data.insurance).toBeNull();
    const a = await admin.get('/api/v1/dashboard/summary');
    expect(a.body.data.insurance.received).toBeGreaterThanOrEqual(8000);
  });
});
