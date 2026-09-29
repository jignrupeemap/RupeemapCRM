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

  it('exports CSV and a real Excel file; Team Partners cannot export', async () => {
    const csv = await dsa.get('/api/v1/reports/run/cases/export').query({ format: 'csv' }).buffer(true).parse(binary);
    expect(csv.status).toBe(200);
    expect(csv.body.subarray(0, 3).toString('hex')).toBe('efbbbf'); // UTF-8 BOM so Excel shows ₹ correctly
    expect(csv.body.toString('utf8')).toContain('"Case ID"');
    const xlsx = await admin.get('/api/v1/reports/run/banks/export').query({ format: 'xlsx' }).buffer(true).parse(binary);
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.body.toString('latin1')).toContain('xl/worksheets/sheet1.xml');
    expect((await tp.get('/api/v1/reports/run/cases/export')).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'REPORT_EXPORTED' } })).toBeGreaterThanOrEqual(2);
  });

  it('every report runs for Admin without errors', async () => {
    for (const key of ['cases', 'dsa-performance', 'team-performance', 'banks', 'payouts', 'recovery', 'insurance', 'queries', 'executive-activity']) {
      const r = await admin.get(`/api/v1/reports/run/${key}`).query({ from: '2020-01-01' });
      expect(r.status, `${key}: ${JSON.stringify(r.body)}`).toBe(200);
      expect(Array.isArray(r.body.data.columns)).toBe(true);
    }
  });
});
