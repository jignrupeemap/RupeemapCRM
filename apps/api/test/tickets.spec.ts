/** Raise Query and Need Assistance: who can raise and see, staff handling, internal notes and attachments. */
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
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');

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
  await prisma.loanCase.updateMany({ where: { caseNo: { startsWith: 'TKT-TEST-' } }, data: { deletedAt: new Date() } });
  await app.close();
  await prisma.$disconnect();
});

describe('Queries and assistance', () => {
  let admin: any, exec: any, dsa: any, ravi: any, nisha: any;
  let caseId: string, queryId: string, assistId: string, version = 0;

  beforeAll(async () => {
    [admin, exec, dsa, ravi, nisha] = await Promise.all(['9000000001', '9000000002', '9000000003', '9000000004', '9000000005'].map(login));
    const mehul = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } });
    const raviU = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
    const bank = await prisma.bank.findFirstOrThrow();
    const customer = await prisma.customer.create({ data: { name: 'Ticket Test Customer' } });
    const c = await prisma.loanCase.create({
      data: { caseNo: `TKT-TEST-${Date.now()}`, customerId: customer.id, loanType: 'HOME_LOAN', appliedAmount: 3000000, bankId: bank.id, dsaId: mehul.id, teamPartnerId: raviU.id, createdById: raviU.id, createdRole: 'TEAM_PARTNER' },
    });
    caseId = c.id;
  });

  it('a Team Partner raises a query with a numbered ID; staff are notified', async () => {
    const r = await ravi.post('/api/v1/tickets').set(H).send({ kind: 'QUERY', category: 'PAYOUT', subject: 'When is my payout?', description: 'Handover done last week', priority: 'HIGH' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.ticketNo).toMatch(/^Q-\d{4}-\d{6}$/);
    queryId = r.body.data.id;
    const execU = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000002' } });
    expect(await prisma.notificationRecipient.count({ where: { userId: execU.id, notification: { title: { contains: r.body.data.ticketNo } } } })).toBe(1);
  });

  it('assistance must name a case the partner can see', async () => {
    expect((await ravi.post('/api/v1/tickets').set(H).send({ kind: 'ASSISTANCE', category: 'DOCUMENTS', subject: 'Help', description: 'Need help' })).body.code).toBe('VALIDATION_ERROR');
    expect((await nisha.post('/api/v1/tickets').set(H).send({ kind: 'ASSISTANCE', category: 'DOCUMENTS', caseId, subject: 'Not mine', description: 'x x x' })).status).toBe(404);
    const r = await ravi.post('/api/v1/tickets').set(H).send({ kind: 'ASSISTANCE', category: 'SANCTION_DELAY', caseId, subject: 'Sanction pending 10 days', description: 'Bank not responding' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.ticketNo).toMatch(/^A-/);
    assistId = r.body.data.id;
  });

  it('the DSA sees their Team Partner’s tickets; other Team Partners do not', async () => {
    expect((await dsa.get('/api/v1/tickets').query({ kind: 'QUERY' })).body.data.map((t: any) => t.id)).toContain(queryId);
    expect((await nisha.get('/api/v1/tickets').query({ kind: 'QUERY' })).body.data.map((t: any) => t.id)).not.toContain(queryId);
    expect((await nisha.get(`/api/v1/tickets/${queryId}`)).status).toBe(404);
  });

  it('staff assign, reply and add an internal note the partner never sees', async () => {
    const execU = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000002' } });
    let d = await admin.get(`/api/v1/tickets/${queryId}`);
    let r = await admin.patch(`/api/v1/tickets/${queryId}`).set(H).send({ version: d.body.data.version, assignedToId: execU.id });
    expect(r.body.data.status).toBe('ASSIGNED');
    expect((await exec.post(`/api/v1/tickets/${queryId}/messages`).set(H).send({ body: 'Check with SBI MIS first', internal: true })).status).toBe(201);
    r = await exec.post(`/api/v1/tickets/${queryId}/messages`).set(H).field('body', 'Payout will be confirmed on Friday').attach('file', PNG, 'statement.png');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe('WAITING');
    expect((await ravi.post(`/api/v1/tickets/${queryId}/messages`).set(H).send({ body: 'sneaky', internal: true })).status).toBe(403);

    const mine = await ravi.get(`/api/v1/tickets/${queryId}`);
    const bodies = mine.body.data.messages.map((m: any) => m.body);
    expect(bodies).toContain('Payout will be confirmed on Friday');
    expect(bodies).not.toContain('Check with SBI MIS first');
    const withFile = mine.body.data.messages.find((m: any) => m.document);
    const f = await ravi.get(`/api/v1/tickets/messages/${withFile.id}/file`);
    expect(f.status).toBe(200);
    expect((await nisha.get(`/api/v1/tickets/messages/${withFile.id}/file`)).status).toBe(404);

    r = await ravi.post(`/api/v1/tickets/${queryId}/messages`).set(H).send({ body: 'Thanks' });
    expect(r.body.data.status).toBe('IN_PROGRESS');
    d = await exec.get(`/api/v1/tickets/${queryId}`);
    version = d.body.data.version;
  });

  it('partners cannot change status except closing their own resolved ticket', async () => {
    expect((await ravi.patch(`/api/v1/tickets/${queryId}`).set(H).send({ version, status: 'RESOLVED' })).status).toBe(403);
    let r = await exec.patch(`/api/v1/tickets/${queryId}`).set(H).send({ version, status: 'RESOLVED', note: 'Confirmed in payout list' });
    expect(r.body.data.status).toBe('RESOLVED');
    r = await ravi.patch(`/api/v1/tickets/${queryId}`).set(H).send({ version: r.body.data.version, status: 'CLOSED' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((await ravi.post(`/api/v1/tickets/${queryId}/messages`).set(H).send({ body: 'one more thing' })).body.code).toBe('INVALID_TRANSITION');
    expect(await prisma.auditLog.count({ where: { entity: 'ticket', entityId: queryId } })).toBeGreaterThanOrEqual(5);
  });

  it('assistance shows on its case and in counts', async () => {
    const list = await exec.get('/api/v1/tickets').query({ kind: 'ASSISTANCE', caseId });
    expect(list.body.data.map((t: any) => t.id)).toEqual([assistId]);
    const counts = await exec.get('/api/v1/tickets/counts');
    expect(counts.body.data.ASSISTANCE.open).toBeGreaterThanOrEqual(1);
  });
});
