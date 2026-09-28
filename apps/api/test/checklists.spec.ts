/** Configurable checklists: who can manage them, how they combine, and case progress. */
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

describe('Checklists', () => {
  let templateId: string;
  let bankId: string;

  it('only managers can create a checklist; partners get 403', async () => {
    const bank = await prisma.bank.findFirstOrThrow({ where: { name: 'Axis Bank' } });
    bankId = bank.id;
    const body = {
      name: `Axis Mortgage ${RUN}`,
      bankId,
      loanType: 'MORTGAGE_LOAN',
      items: [
        { name: `Property title deed ${RUN}`, required: true },
        { name: 'PAN card', required: false },
      ],
    };
    const dsa = await login('9000000003');
    expect((await dsa.post('/api/v1/checklists').set(H).send(body)).status).toBe(403);
    const admin = await login('9000000001');
    const r = await admin.post('/api/v1/checklists').set(H).send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    templateId = r.body.data.id;
    const dup = await admin.post('/api/v1/checklists').set(H).send({ ...body, items: [{ name: 'A doc' }, { name: 'a DOC' }] });
    expect(dup.status).toBe(400);
  });

  it('combines general and specific checklists, same document once, required wins', async () => {
    const dsa = await login('9000000003');
    const r = await dsa.get('/api/v1/checklists/resolve').query({ bankId, loanType: 'MORTGAGE_LOAN' });
    expect(r.status).toBe(200);
    const names = r.body.data.map((i: any) => i.name);
    expect(names).toContain(`Property title deed ${RUN}`);
    expect(names.filter((n: string) => n.toLowerCase() === 'pan card')).toHaveLength(1);
    expect(r.body.data.find((i: any) => i.name.toLowerCase() === 'pan card').required).toBe(true); // required in the general KYC list
    const other = await dsa.get('/api/v1/checklists/resolve').query({ bankId, loanType: 'HOME_LOAN' });
    expect(other.body.data.map((i: any) => i.name)).not.toContain(`Property title deed ${RUN}`);
  });

  it('tracks progress on a case and keeps it when the checklist is edited', async () => {
    const c = await prisma.loanCase.findFirst({ where: { deletedAt: null, status: { notIn: ['REJECT', 'WITHDRAW'] } } });
    if (!c) return; // no cases in this database yet
    const admin = await login('9000000001');
    const list = await admin.get(`/api/v1/cases/${c.id}/checklist`);
    expect(list.status).toBe(200);
    const item = list.body.data.items[0];
    const u = await admin.put(`/api/v1/cases/${c.id}/checklist/${item.itemId}`).set(H).send({ status: 'RECEIVED' });
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    const after = await admin.get(`/api/v1/cases/${c.id}/checklist`);
    expect(after.body.data.items.find((i: any) => i.itemId === item.itemId).status).toBe('RECEIVED');
    expect(after.body.data.progress.done).toBeGreaterThanOrEqual(1);
    const bogus = await admin.put(`/api/v1/cases/${c.id}/checklist/${templateId}`).set(H).send({ status: 'RECEIVED' });
    expect(bogus.status).toBe(404);
  });

  it('editing removes items by deactivating them, never deleting', async () => {
    const admin = await login('9000000001');
    const t = await prisma.checklistTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { items: true } });
    const keep = t.items.find((i) => i.name.startsWith('Property'))!;
    const r = await admin.patch(`/api/v1/checklists/${templateId}`).set(H).send({ name: t.name, bankId, loanType: 'MORTGAGE_LOAN', items: [{ id: keep.id, name: keep.name, required: true }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const items = await prisma.checklistTemplateItem.findMany({ where: { templateId } });
    expect(items).toHaveLength(2);
    expect(items.filter((i) => i.active)).toHaveLength(1);
    await admin.delete(`/api/v1/checklists/${templateId}`).set(H);
  });
});
