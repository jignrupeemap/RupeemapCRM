/** Who can see and change what: every role is blocked from other people's data, even with a direct link. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/bootstrap';
import { hashPassword } from '../src/auth/auth.service';

let app: INestApplication;
let http: any;
const prisma = new PrismaClient();
const RUN = String(Date.now()).slice(-6);
const IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const H = { 'x-requested-with': 'rupeemap' };
const BLOCKED = [403, 404];

async function login(mobile: string, password = 'Rupeemap@123') {
  const a = request.agent(http).set('x-forwarded-for', IP);
  const r = await a.post('/api/v1/auth/login').send({ login: mobile, password });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return a;
}

let otherDsa: { id: string; mobile: string };
let otherCaseId: string;
let nishaCaseId: string;

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();

  // A second, unrelated DSA Partner with one case of their own.
  const mobile = `74${RUN}01`;
  const u = await prisma.user.create({
    data: { name: `Access DSA ${RUN}`, mobile, role: 'DSA', status: 'ACTIVE', mobileVerified: true, passwordHash: await hashPassword('Other-Dsa-2026') },
  });
  await prisma.dsaPartner.create({ data: { userId: u.id, code: `ACC-${RUN}` } });
  otherDsa = { id: u.id, mobile };
  const bank = await prisma.bank.findFirstOrThrow({ where: { active: true } });
  const cust = await prisma.customer.create({ data: { name: 'Private Customer', mobile: `75${RUN}01` } });
  const c = await prisma.loanCase.create({
    data: { caseNo: `ACC-${RUN}-1`, customerId: cust.id, loanType: 'HOME_LOAN', appliedAmount: 1000000, bankId: bank.id, dsaId: u.id, createdById: u.id, createdRole: 'DSA' },
  });
  otherCaseId = c.id;

  // A case sourced by the other Team Partner in Mehul's team (Nisha): Ravi must not see it.
  const mehul = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } });
  const nisha = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000005' } });
  const cust2 = await prisma.customer.create({ data: { name: 'Nisha Customer', mobile: `75${RUN}02` } });
  const c2 = await prisma.loanCase.create({
    data: { caseNo: `ACC-${RUN}-2`, customerId: cust2.id, loanType: 'HOME_LOAN', appliedAmount: 2000000, bankId: bank.id, dsaId: mehul.id, teamPartnerId: nisha.id, createdById: nisha.id, createdRole: 'TEAM_PARTNER' },
  });
  nishaCaseId = c2.id;
});

afterAll(async () => {
  await prisma.loanCase.updateMany({ where: { id: { in: [otherCaseId, nishaCaseId] } }, data: { deletedAt: new Date() } });
  await prisma.user.update({ where: { id: otherDsa.id }, data: { deletedAt: new Date(), status: 'BLOCKED' } });
  await app.close();
  await prisma.$disconnect();
});

describe('Access control', () => {
  it('nothing opens without signing in', async () => {
    for (const path of ['/cases', `/cases/${otherCaseId}`, '/payouts', '/users', '/dashboard/summary', '/dashboard/partners', '/reports', '/audit', '/recoveries']) {
      expect((await request(http).get(`/api/v1${path}`)).status, path).toBe(401);
    }
  });

  it("a DSA cannot open another DSA's case, even with its direct link", async () => {
    const mehul = await login('9000000003');
    expect(BLOCKED).toContain((await mehul.get(`/api/v1/cases/${otherCaseId}`)).status);
    const list = await mehul.get('/api/v1/cases').query({ dsaId: otherDsa.id });
    expect(list.body.meta.total).toBe(0);
    expect(BLOCKED).toContain((await mehul.get(`/api/v1/users/${otherDsa.id}`)).status);
    const search = await mehul.get('/api/v1/cases').query({ q: 'Private Customer' });
    expect(search.body.meta.total).toBe(0);
  });

  it("a Team Partner sees only their own cases, not a teammate's", async () => {
    const ravi = await login('9000000004');
    expect(BLOCKED).toContain((await ravi.get(`/api/v1/cases/${nishaCaseId}`)).status);
    expect(BLOCKED).toContain((await ravi.get(`/api/v1/cases/${otherCaseId}`)).status);
    const raviUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
    const mine = await ravi.get('/api/v1/cases').query({ pageSize: 100 });
    expect(mine.body.data.every((c: any) => c.teamPartnerId === raviUser.id)).toBe(true);
    const pays = await ravi.get('/api/v1/payouts').query({ pageSize: 100 });
    expect(pays.body.data.every((p: any) => p.beneficiaryId === raviUser.id)).toBe(true);
  });

  it('a Team Partner cannot reach staff or team screens', async () => {
    const ravi = await login('9000000004');
    for (const path of ['/users', '/dashboard/partners', '/audit', '/audit/verify', '/reports/run/dsa-performance', '/reports/run/team-performance']) {
      expect((await ravi.get(`/api/v1${path}`)).status, path).toBe(403);
    }
  });

  it('partners cannot move a payout or set their own rate', async () => {
    const mehul = await login('9000000003');
    const payout = await prisma.payout.findFirst({ where: { loanCase: { dsaId: (await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } })).id } } });
    if (payout) {
      const r = await mehul.patch(`/api/v1/payouts/${payout.id}/status`).set(H).send({ status: 'PAID', version: payout.version, reason: 'try' });
      expect(r.status).toBe(403);
    }
    const me = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } });
    const rate = await mehul.post(`/api/v1/users/${me.id}/payout-rates`).set(H).send({ percent: 0.98, effectiveFrom: new Date().toISOString().slice(0, 10), reason: 'self raise' });
    expect(rate.status).toBe(403);
  });

  it('an Admin Executive cannot change permissions or open the audit log by default', async () => {
    const priya = await login('9000000002');
    const target = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000002' } });
    expect((await priya.put(`/api/v1/users/${target.id}/permissions`).set(H).send({ grants: { AUDIT_VIEW: true } })).status).toBe(403);
    expect((await priya.get('/api/v1/audit')).status).toBe(403);
  });

  it('a blocked account is signed out at once and cannot sign back in', async () => {
    const other = await login(otherDsa.mobile, 'Other-Dsa-2026');
    expect((await other.get('/api/v1/auth/me')).status).toBe(200);
    const admin = await login('9000000001');
    const r = await admin.post(`/api/v1/users/${otherDsa.id}/status`).set(H).send({ action: 'BLOCK', reason: 'Access test' });
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    expect((await other.get('/api/v1/auth/me')).status).toBe(401);
    const again = await request(http).post('/api/v1/auth/login').set('x-forwarded-for', IP).send({ login: otherDsa.mobile, password: 'Other-Dsa-2026' });
    expect(again.status).not.toBe(201);
  });
});
