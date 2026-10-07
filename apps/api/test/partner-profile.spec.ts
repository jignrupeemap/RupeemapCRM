/** Partner profile card (from "Sourced by") and office / residence addresses. */
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

describe('Partner profile and addresses', () => {
  it('addresses can be given when the partner is registered', async () => {
    const admin = await login('9000000001');
    const mobile = `78${String(Date.now()).slice(-8)}`;
    const r = await admin.post('/api/v1/users').set(H).send({
      name: 'Address Test DSA', mobile, role: 'DSA', email: 'addr.dsa@example.com',
      officeAddress: '201, Shivalik Plaza, Ambawadi, Ahmedabad 380015', residenceAddress: 'B-12, Satyam Society, Vastrapur, Ahmedabad 380054',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const u = await prisma.user.findUniqueOrThrow({ where: { mobile } });
    expect(u.officeAddress).toContain('Shivalik Plaza');
    expect(u.residenceAddress).toContain('Satyam Society');
    await prisma.user.update({ where: { id: u.id }, data: { deletedAt: new Date() } });
  });

  it('Admin and Executives open the Sourced-by profile; partners cannot', async () => {
    const ravi = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
    const [admin, priya, mehul, raviA] = await Promise.all(['9000000001', '9000000002', '9000000003', '9000000004'].map(login));
    const card = await priya.get(`/api/v1/users/${ravi.id}/card`);
    expect(card.status, JSON.stringify(card.body)).toBe(200);
    expect(card.body.data).toMatchObject({ name: 'Ravi Parmar', mobile: '9000000004', role: 'TEAM_PARTNER' });
    expect(card.body.data.dsa.name).toBe('Mehul Desai');
    expect((await admin.get(`/api/v1/users/${ravi.id}/card`)).status).toBe(200);
    expect((await mehul.get(`/api/v1/users/${ravi.id}/card`)).status).toBe(403);
    expect((await raviA.get(`/api/v1/users/${ravi.id}/card`)).status).toBe(403);
  });

  it('Admin and Executives can fill in missing addresses later; every change is audited', async () => {
    const ravi = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000004' } });
    const priya = await login('9000000002');
    const r = await priya.patch(`/api/v1/users/${ravi.id}/contact`).set(H).send({ officeAddress: '5, Navrang Complex, Navrangpura, Ahmedabad', residenceAddress: '' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.officeAddress).toContain('Navrang Complex');
    expect(r.body.data.residenceAddress).toBeNull();
    expect((await priya.get(`/api/v1/users/${ravi.id}/card`)).body.data.officeAddress).toContain('Navrang Complex');
    expect(await prisma.auditLog.count({ where: { action: 'USER_CONTACT_UPDATED', entityId: ravi.id } })).toBeGreaterThan(0);
    expect((await priya.patch(`/api/v1/users/${ravi.id}/contact`).set(H).send({ email: 'not-an-email' })).status).toBe(400);

    const mehul = await login('9000000003');
    expect((await mehul.patch(`/api/v1/users/${ravi.id}/contact`).set(H).send({ officeAddress: 'x' })).status).toBe(403);
    const admin = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000001' } });
    expect((await priya.patch(`/api/v1/users/${admin.id}/contact`).set(H).send({ officeAddress: 'x' })).status).toBe(403);
  });
});
