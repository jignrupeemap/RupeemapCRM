/** Project-wise analysis: numbers match the database and respect each role's scope. */
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

describe('Project-wise analysis', () => {
  it('Admin totals match every case linked to a project', async () => {
    const admin = await login('9000000001');
    const r = await admin.get('/api/v1/reports/projects');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const linked = await prisma.loanCase.count({ where: { deletedAt: null, projectId: { not: null }, project: { deletedAt: null } } });
    expect(r.body.data.totals.logins).toBe(linked);
    const unlinked = await prisma.loanCase.count({ where: { deletedAt: null, projectId: null } });
    expect(r.body.data.unlinked.cases).toBe(unlinked);
  });

  it('a DSA only counts their own team’s cases', async () => {
    const dsaUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } });
    const dsa = await login('9000000003');
    const r = await dsa.get('/api/v1/reports/projects');
    expect(r.status).toBe(200);
    const own = await prisma.loanCase.count({ where: { deletedAt: null, dsaId: dsaUser.id, projectId: { not: null }, project: { deletedAt: null } } });
    expect(r.body.data.totals.logins).toBe(own);
  });

  it('a Team Partner only counts cases they sourced themselves', async () => {
    const tpUser = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000005' } });
    const tp = await login('9000000005');
    const r = await tp.get('/api/v1/reports/projects');
    expect(r.status).toBe(200);
    const own = await prisma.loanCase.count({ where: { deletedAt: null, teamPartnerId: tpUser.id, projectId: { not: null }, project: { deletedAt: null } } });
    expect(r.body.data.totals.logins).toBe(own);
  });

  it('only Admin sees the top 5 performers of a project, for any date range', async () => {
    const top = await prisma.loanCase.groupBy({ by: ['projectId'], where: { deletedAt: null, projectId: { not: null } }, _count: true, orderBy: { _count: { projectId: 'desc' } }, take: 1 });
    if (!top.length) return; // no project cases in this database
    const projectId = top[0].projectId!;
    const admin = await login('9000000001');
    const r = await admin.get(`/api/v1/reports/projects/${projectId}/top-performers`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.partners.length).toBeGreaterThan(0);
    expect(r.body.data.partners.length).toBeLessThanOrEqual(5);
    const logins = r.body.data.partners.map((p: any) => p.logins);
    expect(logins).toEqual([...logins].sort((a: number, b: number) => b - a));
    const sum = r.body.data.teams.reduce((a: number, t: any) => a + t.logins, 0);
    expect(sum).toBeLessThanOrEqual(top[0]._count);
    const future = await admin.get(`/api/v1/reports/projects/${projectId}/top-performers`).query({ from: '2099-01-01' });
    expect(future.body.data.partners).toEqual([]);
    for (const m of ['9000000002', '9000000003', '9000000004']) {
      const a = await login(m);
      expect((await a.get(`/api/v1/reports/projects/${projectId}/top-performers`)).status).toBe(403);
    }
  });

  it('sorts lowest first and rejects unknown sort columns', async () => {
    const admin = await login('9000000001');
    const r = await admin.get('/api/v1/reports/projects').query({ sort: 'logins', dir: 'asc' });
    const logins = r.body.data.items.map((i: any) => i.logins);
    expect(logins).toEqual([...logins].sort((a: number, b: number) => a - b));
    const bad = await admin.get('/api/v1/reports/projects').query({ sort: 'name; DROP TABLE users' });
    expect(bad.status).toBe(400);
  });
});
