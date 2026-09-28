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

  it('sorts lowest first and rejects unknown sort columns', async () => {
    const admin = await login('9000000001');
    const r = await admin.get('/api/v1/reports/projects').query({ sort: 'logins', dir: 'asc' });
    const logins = r.body.data.items.map((i: any) => i.logins);
    expect(logins).toEqual([...logins].sort((a: number, b: number) => a - b));
    const bad = await admin.get('/api/v1/reports/projects').query({ sort: 'name; DROP TABLE users' });
    expect(bad.status).toBe(400);
  });
});
