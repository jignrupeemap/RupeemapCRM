/** Dashboard slider: Admin manages slides with media, schedule and order; everyone sees only live slides. */
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
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(40)]);
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');

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
  await prisma.slider.updateMany({ where: { title: { contains: RUN } }, data: { deletedAt: new Date() } });
  await app.close();
  await prisma.$disconnect();
});

describe('Dashboard slider', () => {
  let admin: any, exec: any, tp: any, imageId: string, videoId: string, futureId: string;

  beforeAll(async () => {
    [admin, exec, tp] = await Promise.all(['9000000001', '9000000002', '9000000004'].map(login));
  });

  it('Admin adds an image slide and a video slide; Executives cannot by default', async () => {
    expect((await exec.post('/api/v1/sliders').set(H).send({ kind: 'CAMPAIGN', title: `No ${RUN}` })).status).toBe(403);
    let r = await admin.post('/api/v1/sliders').set(H).field('kind', 'BANK_OFFER').field('title', `HDFC offer ${RUN}`).field('ctaLabel', 'Add a case').field('ctaUrl', '/cases/new').attach('file', PNG, 'offer.png');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    imageId = r.body.data.id;
    r = await admin.post('/api/v1/sliders').set(H).field('kind', 'CAMPAIGN').field('title', `Video ${RUN}`).attach('file', MP4, 'clip.mp4');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    videoId = r.body.data.id;
    expect((await admin.post('/api/v1/sliders').set(H).field('kind', 'CAMPAIGN').field('title', `Pdf ${RUN}`).attach('file', PDF, 'x.pdf')).body.code).toBe('VALIDATION_ERROR');
    expect((await admin.post('/api/v1/sliders').set(H).send({ kind: 'CAMPAIGN', title: `Bad link ${RUN}`, ctaLabel: 'Go', ctaUrl: 'javascript:alert(1)' })).body.code).toBe('VALIDATION_ERROR');
  });

  it('partners see live slides with their media, not scheduled or inactive ones', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const f = await admin.post('/api/v1/sliders').set(H).send({ kind: 'ANNOUNCEMENT', title: `Future ${RUN}`, startsAt: future });
    futureId = f.body.data.id;
    const live = (await tp.get('/api/v1/sliders/active')).body.data;
    const ids = live.map((s: any) => s.id);
    expect(ids).toEqual(expect.arrayContaining([imageId, videoId]));
    expect(ids).not.toContain(futureId);
    const img = live.find((s: any) => s.id === imageId);
    expect(img.mediaType).toBe('IMAGE');
    expect(live.find((s: any) => s.id === videoId).mediaType).toBe('VIDEO');
    const media = await tp.get(img.mediaUrl);
    expect(media.status).toBe(200);
    expect(media.headers['content-type']).toBe('image/png');
    await admin.patch(`/api/v1/sliders/${imageId}`).set(H).send({ kind: 'BANK_OFFER', title: `HDFC offer ${RUN}`, ctaLabel: 'Add a case', ctaUrl: '/cases/new', active: false });
    expect((await tp.get('/api/v1/sliders/active')).body.data.map((s: any) => s.id)).not.toContain(imageId);
  });

  it('Admin reorders slides and every change is audited', async () => {
    const r = await admin.post('/api/v1/sliders/reorder').set(H).send({ ids: [videoId, imageId, futureId] });
    expect(r.status).toBe(201);
    const rows = await prisma.slider.findMany({ where: { id: { in: [videoId, imageId, futureId] } }, orderBy: { sortOrder: 'asc' } });
    expect(rows.map((s) => s.id)).toEqual([videoId, imageId, futureId]);
    expect((await admin.delete(`/api/v1/sliders/${futureId}`).set(H)).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { entity: 'slider', action: { in: ['SLIDER_ADDED', 'SLIDER_UPDATED', 'SLIDERS_REORDERED', 'SLIDER_DELETED'] } } })).toBeGreaterThanOrEqual(5);
  });
});
