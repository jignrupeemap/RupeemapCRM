/** Audit Log: only Admin (or an executive given AUDIT_VIEW) can read it, filters work, and the hash chain verifies. */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/bootstrap';
import { auditHash } from '../src/common/audit.service';

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

describe('Audit Log', () => {
  let admin: any, exec: any, dsa: any;
  beforeAll(async () => {
    [admin, exec, dsa] = await Promise.all(['9000000001', '9000000002', '9000000003'].map(login));
  });

  it('partners and executives without the permission cannot read it', async () => {
    expect((await dsa.get('/api/v1/audit')).status).toBe(403);
    expect((await exec.get('/api/v1/audit')).status).toBe(403);
    expect((await dsa.get('/api/v1/audit/verify')).status).toBe(403);
  });

  it('Admin lists entries newest first with names and filters', async () => {
    const r = await admin.get('/api/v1/audit').query({ action: 'LOGIN', pageSize: 5 });
    expect(r.status).toBe(200);
    expect(r.body.meta.total).toBeGreaterThan(0);
    const rows = r.body.data;
    expect(rows.every((x: any) => x.action === 'LOGIN')).toBe(true);
    expect(Number(rows[0].id)).toBeGreaterThan(Number(rows[rows.length - 1].id));
    expect(rows[0].actorName).toBeTruthy();
    const f = await admin.get('/api/v1/audit/facets');
    expect(f.body.data.actions.map((a: any) => a.value)).toContain('LOGIN');
    expect((await admin.get('/api/v1/audit').query({ action: 'drop table' })).status).toBe(400);
  });

  it('new entries hash the same after a round trip through the database', async () => {
    const last = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LOGIN', ip: IP }, orderBy: { id: 'desc' } });
    expect(auditHash(last)).toBe(last.hash);
  });

  it('the chain verifies end to end', async () => {
    const r = await admin.get('/api/v1/audit/verify');
    expect(r.status).toBe(200);
    expect(r.body.data.ok, JSON.stringify(r.body.data.broken)).toBe(true);
    expect(r.body.data.checked).toBeGreaterThan(0);
    expect(r.body.data.contentVerified).toBeGreaterThan(0);
  });

  it('the log cannot be changed, and exports are themselves audited', async () => {
    await expect(prisma.$executeRaw`UPDATE audit_logs SET action = 'X' WHERE id = (SELECT MAX(id) FROM audit_logs)`).rejects.toThrow();
    const csv = await admin.get('/api/v1/audit/export').query({ format: 'csv', action: 'LOGIN' }).buffer(true).parse(binary);
    expect(csv.status).toBe(200);
    expect(csv.body.toString('utf8')).toContain('"Time (IST)"');
    const last = await prisma.auditLog.findFirstOrThrow({ where: { action: 'AUDIT_EXPORTED' }, orderBy: { id: 'desc' } });
    expect((last.after as any).format).toBe('csv');
  });
});
