/** Banker confirmation mails on payouts: staff attach and view; only Admin removes; partners never see them. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/bootstrap';

let app: INestApplication;
let http: any;
const prisma = new PrismaClient();
const IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const H = { 'x-requested-with': 'rupeemap' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const binary = (res: any, cb: any) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function login(mobile: string) {
  const a = request.agent(http).set('x-forwarded-for', IP);
  const r = await a.post('/api/v1/auth/login').send({ login: mobile, password: 'Rupeemap@123' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return a;
}

let caseId: string;
let payoutId: string;

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  const mehul = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } });
  const ravi = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
  const bank = await prisma.bank.findFirstOrThrow({ where: { active: true } });
  const cust = await prisma.customer.create({ data: { name: 'Banker Mail Customer', mobile: `79${String(Date.now()).slice(-8)}` } });
  const c = await prisma.loanCase.create({
    data: { caseNo: `BM-${Date.now()}`, customerId: cust.id, loanType: 'HOME_LOAN', appliedAmount: 3000000, handoverAmount: 3000000, status: 'HANDOVER', bankId: bank.id, dsaId: mehul.id, teamPartnerId: ravi.id, createdById: ravi.id, createdRole: 'TEAM_PARTNER' },
  });
  caseId = c.id;
  const p = await prisma.payout.create({ data: { caseId: c.id, beneficiaryId: ravi.id, beneficiaryRole: 'TEAM_PARTNER', baseAmount: 3000000, percentSnapshot: 0.5, amount: 15000, status: 'PENDING' } });
  payoutId = p.id;
});

afterAll(async () => {
  await prisma.loanCase.update({ where: { id: caseId }, data: { deletedAt: new Date() } });
  await app.close();
  await prisma.$disconnect();
});

describe('Banker confirmation on payouts', () => {
  let attId: string;

  it('an Admin Executive marks Confirmed and attaches the banker mail', async () => {
    const priya = await login('9000000002');
    const st = await priya.patch(`/api/v1/payouts/${payoutId}/status`).set(H).set('Idempotency-Key', `bm-${Date.now()}`).send({ status: 'CONFIRMED', version: 0, reason: 'Bank confirmed OTC cleared' });
    expect(st.status, JSON.stringify(st.body)).toBe(200);
    const up = await priya.post(`/api/v1/payouts/${payoutId}/attachments`).set(H).field('note', 'HDFC RACPC mail').attach('file', PDF, 'hdfc-confirmation.pdf');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    attId = up.body.data.id;
    const bad = await priya.post(`/api/v1/payouts/${payoutId}/attachments`).set(H).attach('file', Buffer.from('MZ not a pdf'), 'mail.pdf');
    expect(bad.status).toBe(400);
  });

  it('Admin and Executives see it on the payout and can open it', async () => {
    for (const who of ['9000000001', '9000000002']) {
      const a = await login(who);
      const list = await a.get(`/api/v1/payouts/${payoutId}/attachments`);
      expect(list.status).toBe(200);
      expect(list.body.data[0]).toMatchObject({ name: 'hdfc-confirmation.pdf', note: 'HDFC RACPC mail', uploadedByName: 'Priya Shah' });
      expect(list.body.data[0].canDelete).toBe(who === '9000000001');
      const f = await a.get(`/api/v1/payouts/attachments/${attId}/file`).buffer(true).parse(binary);
      expect(f.status).toBe(200);
      expect(f.body.subarray(0, 5).toString()).toBe('%PDF-');
    }
    const admin = await login('9000000001');
    const rows = (await admin.get('/api/v1/payouts').query({ pageSize: 100 })).body.data;
    expect(rows.find((r: any) => r.id === payoutId)._count.attachments).toBe(1);
  });

  it('DSA Partners and Team Partners never see banker mails', async () => {
    for (const who of ['9000000003', '9000000004']) {
      const a = await login(who);
      expect((await a.get(`/api/v1/payouts/${payoutId}/attachments`)).status).toBe(403);
      expect((await a.get(`/api/v1/payouts/attachments/${attId}/file`)).status).toBe(403);
      expect((await a.post(`/api/v1/payouts/${payoutId}/attachments`).set(H).attach('file', PDF, 'x.pdf')).status).toBe(403);
      const rows = (await a.get('/api/v1/payouts').query({ pageSize: 100 })).body.data;
      expect(rows.find((r: any) => r.id === payoutId)?._count).toBeUndefined();
    }
  });

  it('only Admin can remove it, with a reason, and it stays in the audit log', async () => {
    const priya = await login('9000000002');
    expect((await priya.post(`/api/v1/payouts/attachments/${attId}/remove`).set(H).send({ reason: 'wrong file' })).status).toBe(403);
    const admin = await login('9000000001');
    expect((await admin.post(`/api/v1/payouts/attachments/${attId}/remove`).set(H).send({ reason: '' })).status).toBe(400);
    expect((await admin.post(`/api/v1/payouts/attachments/${attId}/remove`).set(H).send({ reason: 'Duplicate upload' })).status).toBe(201);
    expect((await admin.get(`/api/v1/payouts/${payoutId}/attachments`)).body.data).toHaveLength(0);
    const kept = await prisma.payoutAttachment.findUniqueOrThrow({ where: { id: attId } });
    expect(kept.deletedAt).not.toBeNull();
    expect(kept.deleteReason).toBe('Duplicate upload');
    expect(await prisma.auditLog.count({ where: { action: { in: ['PAYOUT_ATTACHMENT_ADDED', 'PAYOUT_ATTACHMENT_REMOVED'] }, entityId: caseId } })).toBe(2);
  });
});
