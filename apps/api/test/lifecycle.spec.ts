/**
 * End-to-end API scenario from PART 103 (phases 1–6 scope) plus the PART 89
 * critical RBAC checks. Runs against a real PostgreSQL and Redis.
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
// Unique per run: fresh mobiles and a fresh client IP so rate limits never carry over.
const RUN = String(Date.now()).slice(-5);
const IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const mob = (n: number) => `98${RUN}${String(n).padStart(3, '0')}`;
const PASSWORD = 'Rupeemap@123';

type Agent = ReturnType<typeof request.agent>;

async function login(mobile: string, password = PASSWORD): Promise<Agent> {
  const a = agent();
  const r = await a.post('/api/v1/auth/login').send({ login: mobile, password });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return a;
}

function agent(): Agent {
  const a = request.agent(http);
  a.set('x-forwarded-for', IP);
  return a;
}

async function activate(mobile: string, password: string): Promise<Agent> {
  const a = agent();
  const req = await a.post('/api/v1/auth/otp/request').send({ mobile, purpose: 'ACTIVATE' });
  expect(req.status).toBe(201);
  const sms = await a.get(`/api/v1/auth/dev/last-sms/${mobile}`);
  const otp = sms.body.data.otp as string;
  expect(otp).toMatch(/^\d{6}$/);
  const wrong = await a.post('/api/v1/auth/otp/verify').send({ mobile, purpose: 'ACTIVATE', otp: otp === '000000' ? '111111' : '000000' });
  expect(wrong.status).toBe(400);
  const v = await a.post('/api/v1/auth/otp/verify').send({ mobile, purpose: 'ACTIVATE', otp });
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  const s = await a.post('/api/v1/auth/password/set').send({ token: v.body.data.token, password });
  expect(s.status, JSON.stringify(s.body)).toBe(201);
  // OTP is one-time
  const again = await a.post('/api/v1/auth/otp/verify').send({ mobile, purpose: 'ACTIVATE', otp });
  expect(again.status).toBe(400);
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

describe('Loan case lifecycle', () => {
  const dsaMobile = mob(1);
  const tpMobile = mob(2);
  let admin: Agent, exec: Agent, dsa: Agent, tp: Agent;
  let dsaId: string, tpId: string, caseId: string, version = 0;
  let bankId: string, projectId: string;

  it('rejects anonymous and cross-site requests', async () => {
    expect((await agent().get('/api/v1/cases')).status).toBe(401);
    admin = await login('9000000001');
    const r = await admin.post('/api/v1/users').send({ name: 'X', mobile: mob(99), role: 'DSA' });
    expect(r.status).toBe(403); // missing x-requested-with header on a cookie write
    expect(r.body).toMatchObject({ success: false, code: 'FORBIDDEN' });
  });

  it('Admin creates a DSA with a payout slab (never above 0.98%)', async () => {
    const tooHigh = await admin.post('/api/v1/users').set(H).send({ name: 'Kiran Shah', mobile: dsaMobile, role: 'DSA', payoutPercent: 0.99 });
    expect(tooHigh.body.code).toBe('VALIDATION_ERROR');
    const r = await admin.post('/api/v1/users').set(H).send({ name: 'Kiran Shah', mobile: dsaMobile, role: 'DSA', payoutPercent: 0.9 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe('PENDING_ACTIVATION');
    dsaId = r.body.data.id;
    const dup = await admin.post('/api/v1/users').set(H).send({ name: 'Again', mobile: dsaMobile, role: 'DSA' });
    expect(dup.body.code).toBe('CONFLICT');
  });

  it('DSA cannot log in before activation, then activates with OTP', async () => {
    const r = await agent().post('/api/v1/auth/login').send({ login: dsaMobile, password: 'Whatever1' });
    expect(r.status).toBe(403);
    dsa = await activate(dsaMobile, 'KiranPass2026');
    const me = await dsa.get('/api/v1/auth/me');
    expect(me.body.data).toMatchObject({ role: 'DSA', status: 'ACTIVE', kycStatus: 'DOCUMENTS_PENDING' });
  });

  it('DSA creates a Team Partner; rate is capped at the DSA rate', async () => {
    const over = await dsa.post('/api/v1/users').set(H).send({ name: 'Too High', mobile: mob(98), role: 'TEAM_PARTNER', payoutPercent: 1.5 });
    expect(over.body.code).toBe('VALIDATION_ERROR');
    const r = await dsa.post('/api/v1/users').set(H).send({ name: 'Arjun Patel', mobile: tpMobile, role: 'TEAM_PARTNER', payoutPercent: 0.6 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    tpId = r.body.data.id;
    const cannotDsa = await dsa.post('/api/v1/users').set(H).send({ name: 'Nope', mobile: mob(97), role: 'DSA' });
    expect(cannotDsa.status).toBe(403);
  });

  it('Team Partner verifies mobile, creates password, cannot create users', async () => {
    tp = await activate(tpMobile, 'ArjunPass2026');
    const r = await tp.post('/api/v1/users').set(H).send({ name: 'Sub', mobile: mob(96), role: 'TEAM_PARTNER' });
    expect(r.status).toBe(403);
    const list = await tp.get('/api/v1/users');
    expect(list.status).toBe(403);
  });

  it('Team Partner creates a case that starts at LOGIN with a unique case number', async () => {
    const banks = await tp.get('/api/v1/banks');
    bankId = banks.body.data.find((b: any) => b.shortName === 'HDFC').id;
    const projects = await tp.get('/api/v1/projects');
    projectId = projects.body.data[0].id;
    const r = await tp.post('/api/v1/cases').set(H).send({
      customerName: 'Bhavesh Modi',
      customerMobile: `97${RUN}123`,
      loanType: 'HOME_LOAN',
      appliedAmount: 4500000,
      bankId,
      projectId,
      salesManagerName: 'Kunal Mehta',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe('LOGIN');
    expect(r.body.data.caseNo).toMatch(/^LDSA-\d{4}-\d{6}$/);
    caseId = r.body.data.id;
    const c = await prisma.loanCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(c.dsaId).toBe(dsaId); // ownership derived on the server
    expect(c.teamPartnerId).toBe(tpId);
    expect(c.createdRole).toBe('TEAM_PARTNER');
  });

  it('warns about a duplicate customer instead of silently creating it', async () => {
    const body = { customerName: 'Bhavesh Modi', customerMobile: `97${RUN}123`, loanType: 'HOME_LOAN', appliedAmount: 4000000, bankId };
    const r = await dsa.post('/api/v1/cases').set(H).send(body);
    expect(r.body.code).toBe('DUPLICATE_SUSPECTED');
    expect(r.body.details.duplicates[0].visible).toBe(true);
  });

  it('enforces the state machine and required fields', async () => {
    const skip = await tp.post(`/api/v1/cases/${caseId}/transitions`).set(H).send({ action: 'HANDOVER', version, data: { handoverAmount: 1, otcPddCleared: true, loanAccountNo: 'X', salesManagerName: 'A', salesManagerEmail: 'a@b.co' } });
    expect(skip.body.code).toBe('INVALID_TRANSITION');
    const missing = await tp.post(`/api/v1/cases/${caseId}/transitions`).set(H).send({ action: 'SANCTION', version, data: {} });
    expect(missing.body.code).toBe('VALIDATION_ERROR');
  });

  it('moves Login → Sanction → Disbursed (part, full) and handles a query', async () => {
    const step = async (a: Agent, action: string, data: object) => {
      const r = await a.post(`/api/v1/cases/${caseId}/transitions`).set(H).send({ action, version, data });
      expect(r.status, `${action}: ${JSON.stringify(r.body)}`).toBe(201);
      version = r.body.data.version;
      return r.body.data;
    };
    expect((await step(tp, 'SANCTION', { sanctionAmount: 4200000 })).status).toBe('SANCTION');
    expect((await step(tp, 'RAISE_QUERY', { remarks: 'Bank needs latest ITR' })).status).toBe('QUERY');
    expect((await step(dsa, 'RESOLVE_QUERY', { remarks: 'ITR shared' })).status).toBe('SANCTION');
    expect((await step(tp, 'DISBURSE', { disbursedAmount: 2000000, disbursementType: 'PART' })).status).toBe('DISBURSED');
    const tooMuch = await tp.post(`/api/v1/cases/${caseId}/transitions`).set(H).send({ action: 'DISBURSE', version, data: { disbursedAmount: 3000000, disbursementType: 'FULL' } });
    expect(tooMuch.body.code).toBe('VALIDATION_ERROR');
    await step(tp, 'DISBURSE', { disbursedAmount: 2200000, disbursementType: 'FULL' });
  });

  it('rejects a stale update (optimistic locking)', async () => {
    const r = await tp.post(`/api/v1/cases/${caseId}/transitions`).set(H).send({ action: 'RAISE_QUERY', version: version - 1, data: { remarks: 'old tab' } });
    expect(r.body.code).toBe('CONFLICT');
  });

  it('Handover creates PENDING payouts with snapshotted rates, exactly once', async () => {
    const data = { handoverAmount: 4200000, otcPddCleared: true, loanAccountNo: 'HDFC00012345', salesManagerName: 'Kunal Mehta', salesManagerEmail: 'kunal.mehta@hdfcbank.example' };
    const key = 'handover-test-1';
    const r = await tp.post(`/api/v1/cases/${caseId}/transitions`).set(H).set('Idempotency-Key', key).send({ action: 'HANDOVER', version, data });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.payoutsCreated).toBe(2);
    const replay = await tp.post(`/api/v1/cases/${caseId}/transitions`).set(H).set('Idempotency-Key', key).send({ action: 'HANDOVER', version, data });
    expect(replay.body.data).toEqual(r.body.data);
    version = r.body.data.version;
    const payouts = await prisma.payout.findMany({ where: { caseId }, orderBy: { beneficiaryRole: 'asc' } });
    expect(payouts).toHaveLength(2);
    const d = payouts.find((p) => p.beneficiaryId === dsaId)!;
    const t = payouts.find((p) => p.beneficiaryId === tpId)!;
    expect(d.status).toBe('PENDING');
    // Slab 0.90%: the Team Partner's 0.60% comes out of it, the DSA keeps 0.30%.
    expect(Number(d.percentSnapshot)).toBe(0.3);
    expect(Number(d.amount)).toBe(12600);
    expect(Number(t.percentSnapshot)).toBe(0.6);
    expect(Number(t.amount)).toBe(25200);
  });

  it('DSA and Team Partner can view but never change payouts', async () => {
    const tpView = await tp.get('/api/v1/payouts');
    expect(tpView.body.data).toHaveLength(1); // only their own line
    expect(tpView.body.data[0].beneficiaryId).toBe(tpId);
    const dsaView = await dsa.get('/api/v1/payouts');
    expect(dsaView.body.data).toHaveLength(2);
    const p = dsaView.body.data[0];
    for (const agent of [dsa, tp]) {
      const r = await agent.patch(`/api/v1/payouts/${p.id}/status`).set(H).send({ status: 'CONFIRMED', version: p.version, reason: 'let me' });
      expect(r.status).toBe(403);
    }
  });

  it('DSA can change a Team Partner’s payout on one case, within their own %, and it is audited', async () => {
    const list = (await dsa.get('/api/v1/payouts')).body.data;
    const tpLine = list.find((x: any) => x.beneficiaryId === tpId);
    const ownLine = list.find((x: any) => x.beneficiaryId === dsaId);
    expect(tpLine.canAdjust).toBe(true);
    expect(ownLine.canAdjust).toBe(false);
    // Not their own line, not above their own 1%, and never by the Team Partner.
    expect((await dsa.patch(`/api/v1/payouts/${ownLine.id}/amount`).set(H).send({ version: ownLine.version, percent: 2, reason: 'raise mine' })).status).toBe(403);
    const over = await dsa.patch(`/api/v1/payouts/${tpLine.id}/amount`).set(H).send({ version: tpLine.version, percent: 0.95, reason: 'too much' });
    expect(over.body.code).toBe('VALIDATION_ERROR');
    const tpTry = await tp.patch(`/api/v1/payouts/${tpLine.id}/amount`).set(H).send({ version: tpLine.version, percent: 0.9, reason: 'give me more' });
    expect(tpTry.status, JSON.stringify(tpTry.body)).toBe(403);

    const byAmount = await dsa.patch(`/api/v1/payouts/${tpLine.id}/amount`).set(H).send({ version: tpLine.version, amount: 29400, reason: 'Special case, customer referred by Ravi' });
    expect(byAmount.status, JSON.stringify(byAmount.body)).toBe(200);
    expect(Number(byAmount.body.data.percentSnapshot)).toBe(0.7);
    expect(Number(byAmount.body.data.dsaPercent)).toBe(0.2); // DSA keeps the rest of the 0.90% slab
    const dsaAfter = await prisma.payout.findUniqueOrThrow({ where: { id: ownLine.id } });
    expect(Number(dsaAfter.amount)).toBe(8400);
    const hist = await prisma.payoutHistory.findFirst({ where: { payoutId: tpLine.id }, orderBy: { changedAt: 'desc' } });
    expect(Number(hist!.prevAmount)).toBe(25200);
    expect(Number(hist!.newAmount)).toBe(29400);
    expect(await prisma.auditLog.count({ where: { action: 'PAYOUT_ADJUSTED', entityId: tpLine.id } })).toBe(1);

    // Executive sets it back by percentage.
    exec = await login('9000000002');
    const back = await exec.patch(`/api/v1/payouts/${tpLine.id}/amount`).set(H).send({ version: byAmount.body.data.version, percent: 0.6, reason: 'Back to standard rate' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(Number(back.body.data.amount)).toBe(25200);
    expect(Number((await prisma.payout.findUniqueOrThrow({ where: { id: ownLine.id } })).percentSnapshot)).toBe(0.3);
  });

  it('first payout KYC blocks Paid until Admin approves', async () => {
    exec = await login('9000000002');
    const list = await exec.get('/api/v1/payouts').query({ beneficiaryId: dsaId });
    let p = list.body.data[0];
    const c = await exec.patch(`/api/v1/payouts/${p.id}/status`).set(H).send({ status: 'CONFIRMED', version: p.version, reason: 'Verified with bank MIS' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const blocked = await exec.patch(`/api/v1/payouts/${p.id}/status`).set(H).send({ status: 'PAID', version: c.body.data.version, reason: 'NEFT', paymentRef: 'UTR123' });
    expect(blocked.body.code).toBe('KYC_NOT_APPROVED');
    const early = await admin.post(`/api/v1/users/${dsaId}/kyc`).set(H).send({ decision: 'APPROVE' });
    expect(early.body.code).toBe('INVALID_TRANSITION'); // nothing uploaded yet
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
    for (const type of ['PAN', 'AADHAAR', 'CANCELLED_CHEQUE', 'PHOTO']) {
      const u = await exec.post(`/api/v1/kyc/${dsaId}/documents/${type}`).set(H).attach('file', png, `${type.toLowerCase()}.png`);
      expect(u.status, JSON.stringify(u.body)).toBe(201);
    }
    expect((await exec.post(`/api/v1/kyc/${dsaId}/submit`).set(H)).status).toBe(201);
    const execKyc = await exec.post(`/api/v1/users/${dsaId}/kyc`).set(H).send({ decision: 'APPROVE' });
    expect(execKyc.status).toBe(403); // Admin is the final verifier
    const ok = await admin.post(`/api/v1/users/${dsaId}/kyc`).set(H).send({ decision: 'APPROVE' });
    expect(ok.status).toBe(201);
    const paid = await exec.patch(`/api/v1/payouts/${p.id}/status`).set(H).send({ status: 'PAID', version: c.body.data.version, reason: 'NEFT', paymentRef: 'UTR123' });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    p = (await dsa.get('/api/v1/payouts').query({ status: 'PAID' })).body.data[0];
    expect(p.paymentRef).toBe('UTR123');
    const history = await prisma.payoutHistory.count({ where: { payoutId: p.id } });
    expect(history).toBe(5); // created, two split changes from the Team Partner adjustment, confirmed, paid
  });

  it('other DSAs cannot see or touch the case', async () => {
    const other = await login('9000000003');
    expect((await other.get(`/api/v1/cases/${caseId}`)).status).toBe(404);
    const r = await other.post(`/api/v1/cases/${caseId}/transitions`).set(H).send({ action: 'RAISE_QUERY', version, data: { remarks: 'x' } });
    expect(r.status).toBe(404);
    const list = await other.get('/api/v1/cases');
    expect(list.body.data.find((c: any) => c.id === caseId)).toBeUndefined();
  });

  it('Admin sees the full timeline and audit history', async () => {
    const r = await admin.get(`/api/v1/cases/${caseId}`);
    expect(r.body.data.stageHistory.map((h: any) => h.action)).toEqual(['CREATE', 'SANCTION', 'RAISE_QUERY', 'RESOLVE_QUERY', 'DISBURSE', 'DISBURSE', 'HANDOVER']);
    expect(r.body.data.audit.length).toBeGreaterThanOrEqual(7);
    expect(r.body.data.remarks.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['QUERY', 'QUERY_RESOLUTION']));
    const tpView = await tp.get(`/api/v1/cases/${caseId}`);
    expect(tpView.body.data.audit).toEqual([]);
  });

  it('history tables cannot be edited, even directly in the database', async () => {
    await expect(prisma.$executeRaw`UPDATE audit_logs SET action = 'x'`).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`DELETE FROM case_stage_history`).rejects.toThrow(/append-only/);
  });

  it('a financial correction needs permission and flows into unpaid payouts', async () => {
    const denied = await dsa.post(`/api/v1/cases/${caseId}/corrections`).set(H).send({ field: 'handoverAmount', value: 4000000, reason: 'typo', version });
    expect(denied.status).toBe(403);
    const r = await exec.post(`/api/v1/cases/${caseId}/corrections`).set(H).send({ field: 'handoverAmount', value: 4000000, reason: 'Bank letter shows 40 L', version });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const t = await prisma.payout.findFirstOrThrow({ where: { caseId, beneficiaryId: tpId } });
    expect(Number(t.amount)).toBe(24000); // still 0.6%, pending
    const d = await prisma.payout.findFirstOrThrow({ where: { caseId, beneficiaryId: dsaId } });
    expect(Number(d.amount)).toBe(12600); // already paid, untouched
  });

  it('blocking a user ends their session immediately', async () => {
    const r = await admin.post(`/api/v1/users/${tpId}/status`).set(H).send({ action: 'BLOCK', reason: 'Documents under review' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await tp.get('/api/v1/auth/me')).status).toBe(401);
    const relogin = await agent().post('/api/v1/auth/login').send({ login: tpMobile, password: 'ArjunPass2026' });
    expect(relogin.status).toBe(403);
  });

  it('Admin promotes a Team Partner to DSA and history stays linked', async () => {
    const created = await dsa.post('/api/v1/users').set(H).send({ name: 'Nisha Joshi', mobile: mob(3), role: 'TEAM_PARTNER' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    await activate(mob(3), 'NishaPass2026');
    const nisha = { id: created.body.data.id as string };
    const denied = await exec.post(`/api/v1/users/${nisha.id}/promote`).set(H).send({ reason: 'Top performer' });
    expect(denied.status).toBe(403);
    const r = await admin.post(`/api/v1/users/${nisha.id}/promote`).set(H).send({ reason: 'Top performer for 6 months' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.role).toBe('DSA');
    const m = await prisma.teamMembership.findFirstOrThrow({ where: { userId: nisha.id } });
    expect(m.endedOn).not.toBeNull();
    const n = await login(mob(3), 'NishaPass2026');
    const me = await n.get('/api/v1/auth/me');
    expect(me.body.data.dsaCode).toMatch(/^DSA-\d{4}$/);
  });

  it('dashboard KPIs respect scope', async () => {
    const adminKpi = await admin.get('/api/v1/dashboard/summary');
    expect(adminKpi.body.data.cases.HANDOVER).toBeGreaterThanOrEqual(1);
    expect(adminKpi.body.data.users.length).toBeGreaterThan(0);
    const other = await login('9000000003');
    const otherKpi = await other.get('/api/v1/dashboard/summary');
    expect(otherKpi.body.data.cases.total).toBe(0);
    expect(otherKpi.body.data.users).toEqual([]);
  });

  it('errors never leak internals', async () => {
    const r = await admin.get('/api/v1/cases/not-a-uuid');
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toMatch(/prisma|stack|\/home\//i);
  });
});
