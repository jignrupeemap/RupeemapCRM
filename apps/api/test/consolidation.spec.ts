/** Admin sees one consistent set of numbers: dashboard, partner-wise table, Payout page and the database all agree. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/bootstrap';

let app: INestApplication;
let http: any;
const prisma = new PrismaClient();
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
  await app.close();
  await prisma.$disconnect();
});

const STATUSES = ['LOGIN', 'SANCTION', 'DISBURSED', 'HANDOVER', 'QUERY', 'REJECT', 'WITHDRAW'] as const;

describe('Consolidated Admin figures', () => {
  let admin: any, dsa: any;
  beforeAll(async () => {
    [admin, dsa] = await Promise.all(['9000000001', '9000000003'].map(login));
  });

  async function check(range: { from?: string; to?: string }) {
    const [sum, partners, payPage] = await Promise.all([
      admin.get('/api/v1/dashboard/summary').query(range),
      admin.get('/api/v1/dashboard/partners').query(range),
      admin.get('/api/v1/payouts').query({ ...range, pageSize: 1 }),
    ]);
    expect(sum.status).toBe(200);
    expect(partners.status, JSON.stringify(partners.body)).toBe(200);
    const s = sum.body.data;
    const t = partners.body.data.totals;
    const period = range.from || range.to ? { createdAt: { gte: range.from ? new Date(range.from) : undefined, lte: range.to ? new Date(range.to) : undefined } } : {};

    // Cases: dashboard = partner-wise total = database
    const dbCases = await prisma.loanCase.count({ where: { deletedAt: null, ...period } });
    expect(s.cases.total).toBe(dbCases);
    expect(t.cases.total).toBe(dbCases);
    for (const st of STATUSES) expect(t.cases[st], st).toBe(s.cases[st]);
    expect(t.cases.own + t.cases.team).toBe(t.cases.total);
    expect(Math.round(t.amounts.applied)).toBe(Math.round(s.amounts.applied));
    expect(Math.round(t.amounts.handover)).toBe(Math.round(s.amounts.handover));

    // Payouts: dashboard = partner-wise = Payout page = database, per status
    const dbPay = await prisma.payout.groupBy({ by: ['status'], where: { loanCase: { deletedAt: null }, ...period }, _sum: { amount: true } });
    const db = Object.fromEntries(dbPay.map((r) => [r.status, Number(r._sum.amount ?? 0)]));
    const page = Object.fromEntries((payPage.body.meta.summary as any[]).map((r) => [r.status, r.amount]));
    for (const st of ['PENDING', 'CONFIRMED', 'PAID', 'HOLD']) {
      const k = st.toLowerCase();
      expect(s.payouts[st].amount, `dashboard ${st}`).toBeCloseTo(db[st] ?? 0, 2);
      expect(t.payouts[k], `partners ${st}`).toBeCloseTo(db[st] ?? 0, 2);
      expect(page[st] ?? 0, `payout page ${st}`).toBeCloseTo(db[st] ?? 0, 2);
    }
    expect(t.payouts.dsa + t.payouts.teamPartners).toBeCloseTo(t.payouts.total, 2);
  }

  it('all time: every view agrees with the database', async () => {
    await check({});
  });

  it('a date range: payouts are dated the same way everywhere', async () => {
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    await check({ from, to });
    await check({ from: '2020-01-01T00:00:00.000Z', to: '2020-12-31T23:59:59.999Z' });
  });

  it('a case a partner adds shows on the Admin dashboard straight away', async () => {
    const before = (await admin.get('/api/v1/dashboard/summary')).body.data.cases.total;
    const bank = await prisma.bank.findFirstOrThrow({ where: { active: true } });
    const r = await dsa
      .post('/api/v1/cases')
      .set('x-requested-with', 'rupeemap')
      .send({ customerName: 'Consolidation Check', customerMobile: `98${String(Date.now()).slice(-8)}`, loanType: 'HOME_LOAN', bankId: bank.id, appliedAmount: 1500000 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const after = (await admin.get('/api/v1/dashboard/summary')).body.data.cases.total;
    expect(after).toBe(before + 1);
    await prisma.loanCase.update({ where: { id: r.body.data.id }, data: { deletedAt: new Date() } });
  });

  it("each DSA's row equals the Payout page filtered to that DSA and team", async () => {
    const rows = (await admin.get('/api/v1/dashboard/partners')).body.data.rows.filter((r: any) => r.payouts.total > 0);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const page = await admin.get('/api/v1/payouts').query({ dsaId: r.dsaId, pageSize: 1 });
      const total = (page.body.meta.summary as any[]).reduce((a, s) => a + s.amount, 0);
      expect(total, r.name).toBeCloseTo(r.payouts.total, 2);
    }
  });

  it('clicking a dashboard count opens a list with the same number', async () => {
    const s = (await admin.get('/api/v1/dashboard/summary')).body.data;
    const stuck = await admin.get('/api/v1/cases').query({ stuck: '1', pageSize: 1 });
    expect(stuck.status).toBe(200);
    expect(stuck.body.meta.total).toBe(s.stuckCases);
    const query = await admin.get('/api/v1/cases').query({ status: 'QUERY', pageSize: 1 });
    expect(query.body.meta.total).toBe(s.cases.QUERY);
    const bank = await admin.get('/api/v1/payouts').query({ bankReceived: '1', pageSize: 1 });
    expect(bank.body.meta.total).toBe(s.bankReceived.count);
    const active = s.users.filter((u: any) => u.status === 'ACTIVE').reduce((a: number, u: any) => a + u.count, 0);
    const users = await admin.get('/api/v1/users').query({ status: 'ACTIVE', pageSize: 1 });
    expect(users.body.meta.total).toBe(active);
  });

  it('partners cannot open the partner-wise table', async () => {
    expect((await dsa.get('/api/v1/dashboard/partners')).status).toBe(403);
  });
});
