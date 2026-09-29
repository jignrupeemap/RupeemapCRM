/** First payout KYC documents: upload rules, private access, versions and Admin decision. */
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
const RUN = String(Date.now()).slice(-5);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

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

describe('First payout KYC documents', () => {
  let admin: any, exec: any, partnerId: string, partnerMobile: string;

  beforeAll(async () => {
    admin = await login('9000000001');
    exec = await login('9000000002');
    partnerMobile = `96${RUN}001`;
    const r = await admin.post('/api/v1/users').set(H).send({ name: `KYC Partner ${RUN}`, mobile: partnerMobile, role: 'DSA' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    partnerId = r.body.data.id;
    const hash = (await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } })).passwordHash;
    await prisma.user.update({ where: { id: partnerId }, data: { status: 'ACTIVE', passwordHash: hash } });
  });

  it('checks the real file type, not the name', async () => {
    const fake = await exec.post(`/api/v1/kyc/${partnerId}/documents/PAN`).set(H).attach('file', Buffer.from('MZ this is an exe'), 'pan.pdf');
    expect(fake.status).toBe(400);
    const wrongExt = await exec.post(`/api/v1/kyc/${partnerId}/documents/PAN`).set(H).attach('file', PNG, 'pan.pdf');
    expect(wrongExt.status).toBe(400);
    const none = await exec.post(`/api/v1/kyc/${partnerId}/documents/PAN`).set(H);
    expect(none.status).toBe(400);
    const badType = await exec.post(`/api/v1/kyc/${partnerId}/documents/PASSPORT`).set(H).attach('file', PNG, 'x.png');
    expect(badType.status).toBe(400);
  });

  it('partners cannot upload, even for themselves', async () => {
    const me = await login(partnerMobile);
    const r = await me.post(`/api/v1/kyc/${partnerId}/documents/PAN`).set(H).attach('file', PNG, 'pan.png');
    expect(r.status).toBe(403);
  });

  it('uploads become versions; the set is complete only with every required document', async () => {
    let r = await exec.post(`/api/v1/kyc/${partnerId}/documents/PAN`).set(H).attach('file', PDF, 'PAN card.pdf');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    r = await exec.post(`/api/v1/kyc/${partnerId}/documents/PAN`).set(H).attach('file', PNG, 'pan-clear.png');
    expect(r.body.data.version).toBe(2);
    expect(r.body.data.status).toBe('DOCUMENTS_PENDING');
    const gstBlocked = await exec.post(`/api/v1/kyc/${partnerId}/documents/GST_CERTIFICATE`).set(H).attach('file', PDF, 'gst.pdf');
    expect(gstBlocked.status).toBe(400);
    expect((await exec.post(`/api/v1/kyc/${partnerId}/submit`).set(H)).status).toBe(400);
    for (const t of ['AADHAAR', 'CANCELLED_CHEQUE', 'PHOTO']) {
      r = await exec.post(`/api/v1/kyc/${partnerId}/documents/${t}`).set(H).attach('file', PNG, `${t}.png`);
      expect(r.status).toBe(201);
    }
    expect(r.body.data.status).toBe('UPLOADED');
    // GST registered: now the certificate is required too.
    const g = await exec.put(`/api/v1/kyc/${partnerId}/gst`).set(H).send({ gstApplicable: true });
    expect(g.body.data.status).toBe('DOCUMENTS_PENDING');
    r = await exec.post(`/api/v1/kyc/${partnerId}/documents/GST_CERTIFICATE`).set(H).attach('file', PDF, 'gst.pdf');
    expect(r.body.data.status).toBe('UPLOADED');
    const d = await exec.get(`/api/v1/kyc/${partnerId}`);
    expect(d.body.data.missing).toEqual([]);
    expect(d.body.data.documents.filter((x: any) => x.type === 'PAN')).toHaveLength(2);
  });

  it('files are private: stored encrypted, served only to staff or the owner, and every view is logged', async () => {
    const d = await exec.get(`/api/v1/kyc/${partnerId}`);
    const pan = d.body.data.documents.find((x: any) => x.type === 'PAN' && x.current);
    const r = await exec.get(`/api/v1/kyc/documents/${pan.id}/file`).buffer(true).parse((res: any, cb: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(r.body, PNG)).toBe(0);
    const doc = await prisma.document.findFirstOrThrow({ where: { kyc: { id: pan.id } } });
    expect(doc.encrypted).toBe(true);
    expect(await prisma.documentAccessLog.count({ where: { documentId: doc.id } })).toBeGreaterThanOrEqual(1);

    const owner = await login(partnerMobile);
    expect((await owner.get(`/api/v1/kyc/documents/${pan.id}/file`)).status).toBe(200);
    const other = await login('9000000004');
    expect((await other.get(`/api/v1/kyc/documents/${pan.id}/file`)).status).toBe(403);
    expect((await other.get(`/api/v1/kyc/${partnerId}`)).status).toBe(403);
  });

  it('Admin rejects, Executive re-uploads, Admin approves', async () => {
    expect((await exec.post(`/api/v1/kyc/${partnerId}/submit`).set(H)).status).toBe(201);
    const locked = await exec.post(`/api/v1/kyc/${partnerId}/documents/PHOTO`).set(H).attach('file', PNG, 'p.png');
    expect(locked.body.code).toBe('INVALID_TRANSITION');
    const rej = await admin.post(`/api/v1/users/${partnerId}/kyc`).set(H).send({ decision: 'REJECT', reason: 'Photo is blurred' });
    expect(rej.status).toBe(201);
    expect(rej.body.data.status).toBe('RESUBMISSION_REQUIRED');
    const re = await exec.post(`/api/v1/kyc/${partnerId}/documents/PHOTO`).set(H).attach('file', PNG, 'photo-new.png');
    expect(re.body.data.status).toBe('UPLOADED');
    await exec.post(`/api/v1/kyc/${partnerId}/submit`).set(H);
    const ok = await admin.post(`/api/v1/users/${partnerId}/kyc`).set(H).send({ decision: 'APPROVE' });
    expect(ok.body.data.status).toBe('APPROVED');
    expect((await exec.post(`/api/v1/kyc/${partnerId}/documents/PAN`).set(H).attach('file', PNG, 'x.png')).status).toBe(409);
  });

  it('the staff queue lists partners with their progress', async () => {
    const q = await exec.get('/api/v1/kyc').query({ q: partnerMobile });
    expect(q.status).toBe(200);
    expect(q.body.data[0]).toMatchObject({ userId: partnerId, status: 'APPROVED', uploaded: 5, required: 5 });
    const dsa = await login('9000000003');
    expect((await dsa.get('/api/v1/kyc')).status).toBe(403);
  });
});
