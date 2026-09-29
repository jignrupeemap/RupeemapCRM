/** Reports and exports: who can open which report, scope, and export files. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/bootstrap';

let app: INestApplication;
let http: any;
const prisma = new PrismaClient();
const IP = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
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

beforeAll(async () => {
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('Reports', () => {
  let admin: any, dsa: any, tp: any;
  beforeAll(async () => {
    [admin, dsa, tp] = await Promise.all(['9000000001', '9000000003', '9000000004'].map(login));
  });

  it('each role sees only the reports meant for them', async () => {
    const keys = async (a: any) => (await a.get('/api/v1/reports')).body.data.map((r: any) => r.key);
    expect(await keys(admin)).toEqual(expect.arrayContaining(['cases', 'dsa-performance', 'insurance', 'executive-activity']));
    const d = await keys(dsa);
    expect(d).toContain('team-performance');
    expect(d).not.toContain('insurance');
    expect(d).not.toContain('dsa-performance');
    expect(await keys(tp)).not.toContain('team-performance');
    expect((await tp.get('/api/v1/reports/run/team-performance')).status).toBe(403);
    expect((await dsa.get('/api/v1/reports/run/insurance')).status).toBe(403);
  });

  it('the case report is limited to the caller’s scope', async () => {
    const tpUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
    const r = await tp.get('/api/v1/reports/run/cases');
    expect(r.status).toBe(200);
    expect(r.body.data.rowCount).toBe(await prisma.loanCase.count({ where: { deletedAt: null, teamPartnerId: tpUser.id } }));
    const all = await admin.get('/api/v1/reports/run/cases');
    expect(all.body.data.rowCount).toBe(await prisma.loanCase.count({ where: { deletedAt: null } }));
  });

  it('exports CSV and a real Excel file; every role gets only their own data', async () => {
    const csv = await dsa.get('/api/v1/reports/run/cases/export').query({ format: 'csv' }).buffer(true).parse(binary);
    expect(csv.status).toBe(200);
    expect(csv.body.subarray(0, 3).toString('hex')).toBe('efbbbf'); // UTF-8 BOM so Excel shows ₹ correctly
    expect(csv.body.toString('utf8')).toContain('"Case ID"');
    const xlsx = await admin.get('/api/v1/reports/run/banks/export').query({ format: 'xlsx' }).buffer(true).parse(binary);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.body.toString('latin1')).toContain('xl/worksheets/sheet1.xml');
    // Team Partners can export too, but only their own cases.
    const tpCsv = await tp.get('/api/v1/reports/run/cases/export').query({ format: 'csv' }).buffer(true).parse(binary);
    expect(tpCsv.status).toBe(200);
    const tpUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
    const own = new Set((await prisma.loanCase.findMany({ where: { deletedAt: null, teamPartnerId: tpUser.id }, select: { caseNo: true } })).map((c) => c.caseNo));
    const exported = tpCsv.body.toString('utf8').split('\r\n').slice(1).map((l: string) => l.split(',')[0].replace(/"/g, '')).filter((x: string) => x && x !== 'Total');
    expect(exported.length).toBe(own.size);
    expect(exported.every((c: string) => own.has(c))).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'REPORT_EXPORTED' } })).toBeGreaterThanOrEqual(2);
  });

  it('filters narrow the report and its download the same way', async () => {
    const part = await admin.get('/api/v1/reports/run/cases').query({ partPayment: '1' });
    expect(part.status).toBe(200);
    expect(part.body.data.rowCount).toBe(await prisma.loanCase.count({ where: { deletedAt: null, status: 'DISBURSED', disbursementType: 'PART' } }));
    const byStatus = await admin.get('/api/v1/reports/run/cases').query({ status: 'HANDOVER', loanType: 'HOME_LOAN' });
    expect(byStatus.body.data.rowCount).toBe(await prisma.loanCase.count({ where: { deletedAt: null, status: 'HANDOVER', loanType: 'HOME_LOAN' } }));
    expect((await admin.get('/api/v1/reports/run/cases').query({ status: "HANDOVER'; DROP" })).status).toBe(400);
    const csv = await admin.get('/api/v1/reports/run/cases/export').query({ format: 'csv', status: 'HANDOVER', loanType: 'HOME_LOAN' }).buffer(true).parse(binary);
    const lines = csv.body.toString('utf8').split('\r\n').filter((l: string) => l && !l.startsWith('"Total"'));
    expect(lines.length - 1).toBe(byStatus.body.data.rowCount);
  });

  it('every report runs for Admin without errors', async () => {
    for (const key of ['cases', 'dsa-performance', 'team-performance', 'banks', 'payouts', 'recovery', 'insurance', 'queries', 'executive-activity']) {
      const r = await admin.get(`/api/v1/reports/run/${key}`).query({ from: '2020-01-01' });
      expect(r.status, `${key}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(Array.isArray(r.body.data.columns)).toBe(true);
    }
  });
});
