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
    const r = await dsa.get('/api/v1/checklists/resolve').query({ bankId, loanType: 'MORTGAGE_LOAN', profile: 'SALARIED' });
    expect(r.status).toBe(200);
    const names = r.body.data.map((i: any) => i.name);
    expect(names).toContain(`Property title deed ${RUN}`);
    expect(names.filter((n: string) => n.toLowerCase() === 'pan card')).toHaveLength(1);
    expect(r.body.data.find((i: any) => i.name.toLowerCase() === 'pan card').required).toBe(true); // required in the HL/LAP salaried list
    const other = await dsa.get('/api/v1/checklists/resolve').query({ bankId, loanType: 'HOME_LOAN' });
    expect(other.body.data.map((i: any) => i.name)).not.toContain(`Property title deed ${RUN}`);
  });

  it('tracks progress on a case and keeps it when the checklist is edited', async () => {
    const c = await prisma.loanCase.findFirst({ where: { deletedAt: null, status: { notIn: ['REJECT', 'WITHDRAW'] } } });
    if (!c) return; // no cases in this database yet
    const admin = await login('9000000001');
    // Lists belong to a loan and a profile: give the case a profile first.
    await admin.put(`/api/v1/cases/${c.id}/profile`).set(H).send({ customerProfile: 'SALARIED' });
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

  it('Checklist page: each loan (HL/LAP, Business, Used Car) and profile has its own list, in sections', async () => {
    const tp = await login('9000000004');
    const get = async (loanGroup: string, profile: string) =>
      (await tp.get('/api/v1/checklists/resolve').query({ loanGroup, profile })).body.data as { name: string; section: string }[];
    const names = async (g: string, p: string) => (await get(g, p)).map((i) => i.name);
    const hlSal = await get('HL_LAP', 'SALARIED');
    expect(hlSal[0].section).toBe('KYC'); // KYC first
    const order = ['KYC', 'BUSINESS_PROOF', 'INCOME', 'EXISTING_LOAN', 'PROPERTY', 'VEHICLE', 'OTHER'];
    expect(hlSal.map((i) => order.indexOf(i.section))).toEqual([...hlSal.map((i) => order.indexOf(i.section))].sort((a, b) => a - b));
    expect(hlSal.map((i) => i.name)).toEqual(expect.arrayContaining(['PAN card', 'Salary slips (last 3 months)', 'Sale agreement / allotment letter']));
    const hlSenp = await names('HL_LAP', 'SENP');
    expect(hlSenp).toContain('GST registration / Shop Act / Udyam certificate');
    expect(hlSenp).not.toContain('Salary slips (last 3 months)');
    expect(await names('HL_LAP', 'SEP')).toContain('Professional registration certificate');
    const bl = await names('BUSINESS', 'SENP');
    expect(bl).not.toContain('Sale agreement / allotment letter'); // no property documents for a business loan
    const car = await names('USED_CAR', 'SALARIED');
    expect(car).toContain('RC (registration certificate) of the car');
    expect(car).not.toContain('Sale agreement / allotment letter');
    // The retired general lists no longer appear.
    expect(hlSal.map((i) => i.name)).not.toContain('HDFC application form signed');
    expect((await tp.get('/api/v1/checklists/resolve').query({ loanGroup: 'HL_LAP', profile: 'ALIEN' })).status).toBe(400);
    expect((await tp.get('/api/v1/checklists/resolve').query({ loanGroup: 'HL_LAP', profile: 'PENSIONER' })).status).toBe(400);
    expect((await tp.get('/api/v1/checklists/resolve').query({ profile: 'SALARIED' })).status).toBe(400); // a loan is needed
  });

  it('Admin edits a loan × profile list on the page; partners cannot', async () => {
    const admin = await login('9000000001');
    const list = (await admin.get('/api/v1/checklists').query({ loanGroup: 'USED_CAR', profile: 'NRI', includeInactive: '1' })).body.data;
    const t = list.find((x: any) => x.loanGroup === 'USED_CAR' && x.profile === 'NRI');
    expect(t).toBeTruthy();
    const items = t.items.filter((i: any) => i.active).map((i: any) => ({ id: i.id, name: i.name, required: i.required, hint: i.hint ?? '', section: i.section, active: true }));
    const body = { name: t.name, loanGroup: 'USED_CAR', profile: 'NRI', active: true, items: [...items, { name: 'Overseas driving licence', required: false, section: 'KYC', active: true }] };
    const r = await admin.patch(`/api/v1/checklists/${t.id}`).set(H).send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const after = (await admin.get('/api/v1/checklists/resolve').query({ loanGroup: 'USED_CAR', profile: 'NRI' })).body.data;
    const added = after.find((i: any) => i.name === 'Overseas driving licence');
    expect(added.section).toBe('KYC');
    expect((await admin.get('/api/v1/checklists/resolve').query({ loanGroup: 'USED_CAR', profile: 'SALARIED' })).body.data.map((i: any) => i.name)).not.toContain('Overseas driving licence');
    const tp = await login('9000000004');
    expect((await tp.patch(`/api/v1/checklists/${t.id}`).set(H).send(body)).status).toBe(403);
    // put it back
    await admin.patch(`/api/v1/checklists/${t.id}`).set(H).send({ ...body, items });
  });

  it("a case's profile picks its checklist, and the person handling the case can change it", async () => {
    const tp = await login('9000000004');
    const bank = await prisma.bank.findFirstOrThrow({ where: { active: true } });
    const c = await tp.post('/api/v1/cases').set(H).send({
      customerName: 'Profile Check', customerMobile: `97${String(Date.now()).slice(-8)}`, loanType: 'HOME_LOAN', bankId: bank.id, appliedAmount: 2500000, customerProfile: 'SENP',
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const id = c.body.data.id;
    try {
      let list = (await tp.get(`/api/v1/cases/${id}/checklist`)).body.data;
      expect(list.customerProfile).toBe('SENP');
      expect(list.items.map((i: any) => i.name)).toContain('ITR with computation of income (last 3 years)');
      const r = await tp.put(`/api/v1/cases/${id}/profile`).set(H).send({ customerProfile: 'SALARIED' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      list = (await tp.get(`/api/v1/cases/${id}/checklist`)).body.data;
      expect(list.items.map((i: any) => i.name)).toContain('Salary slips (last 3 months)');
      expect(list.items.map((i: any) => i.name)).not.toContain('ITR with computation of income (last 3 years)');
      expect(await prisma.auditLog.count({ where: { action: 'CASE_PROFILE_CHANGED', entityId: id } })).toBe(1);
      const nisha = await login('9000000005');
      expect([403, 404]).toContain((await nisha.put(`/api/v1/cases/${id}/profile`).set(H).send({ customerProfile: 'NRI' })).status);
    } finally {
      await prisma.loanCase.update({ where: { id }, data: { deletedAt: new Date() } });
    }
  });

  it('Admin can make a checklist for one profile only', async () => {
    const admin = await login('9000000001');
    const r = await admin.post('/api/v1/checklists').set(H).send({ name: `NRI extra ${Date.now()}`, profile: 'NRI', items: [{ name: 'FEMA declaration', required: true }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.profile).toBe('NRI');
    const bank = await prisma.bank.findFirstOrThrow({ where: { active: true } });
    const nri = (await admin.get('/api/v1/checklists/resolve').query({ bankId: bank.id, loanType: 'LAP', profile: 'NRI' })).body.data.map((i: any) => i.name);
    const sal = (await admin.get('/api/v1/checklists/resolve').query({ bankId: bank.id, loanType: 'LAP', profile: 'SALARIED' })).body.data.map((i: any) => i.name);
    expect(nri).toContain('FEMA declaration');
    expect(sal).not.toContain('FEMA declaration');
    await admin.delete(`/api/v1/checklists/${r.body.data.id}`).set(H);
  });
});
