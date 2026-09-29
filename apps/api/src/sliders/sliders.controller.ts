import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { StorageService, MAX_VIDEO_BYTES } from '../common/storage.service';
import { parse } from '../common/validate';
import { AppError, notFound } from '../common/errors';
import { CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';

const blank = (v: unknown) => (v === '' || v === null || v === 'null' ? undefined : v);
const bool = (v: unknown) => (v === 'true' ? true : v === 'false' ? false : v);
const sliderSchema = z
  .object({
    kind: z.enum(['BANK_OFFER', 'PRODUCT_OFFER', 'CAMPAIGN', 'ANNOUNCEMENT']),
    title: z.string().trim().min(3, 'Enter a headline').max(90),
    subtitle: z.preprocess(blank, z.string().trim().max(200).optional()),
    theme: z.enum(['teal', 'ink', 'gold', 'red']).default('teal'),
    ctaLabel: z.preprocess(blank, z.string().trim().max(30).optional()),
    // Internal paths ("/cases/new") or https links only.
    ctaUrl: z.preprocess(blank, z.string().trim().max(300).regex(/^(\/[\w\-/?=&.%]*|https:\/\/[^\s]+)$/, 'Use a page path like /cases/new or an https:// link').optional()),
    bankId: z.preprocess(blank, z.string().uuid().optional()),
    startsAt: z.preprocess(blank, z.coerce.date().optional()),
    endsAt: z.preprocess(blank, z.coerce.date().optional()),
    active: z.preprocess(bool, z.boolean().default(true)),
    removeMedia: z.preprocess(bool, z.boolean().default(false)),
  })
  .refine((v) => !v.ctaLabel === !v.ctaUrl, { message: 'Give both the button text and where it goes', path: ['ctaUrl'] })
  .refine((v) => !v.startsAt || !v.endsAt || v.startsAt < v.endsAt, { message: 'End must be after start', path: ['endsAt'] });
const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) });

type File = { buffer: Buffer; originalname: string; size: number };

/** Dashboard hero slider (PART 12, 78): Admin adds images, videos, offers and campaigns, schedules and orders them. */
@Controller('sliders')
export class SlidersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private shape(s: any) {
    return {
      ...s,
      mediaType: s.document ? (s.document.mime.startsWith('video/') ? 'VIDEO' : 'IMAGE') : s.mediaUrl ? s.mediaType : 'NONE',
      mediaUrl: s.document ? `/api/v1/sliders/${s.id}/media?v=${s.document.id.slice(0, 8)}` : s.mediaUrl,
      bankName: s.bank?.name ?? null,
      document: undefined,
      bank: undefined,
    };
  }

  /** What everyone sees on the dashboard now. */
  @Get('active')
  async active() {
    const now = new Date();
    const list = await this.prisma.slider.findMany({
      where: { active: true, deletedAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      include: { document: { select: { id: true, mime: true } }, bank: { select: { name: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return list.map((s) => this.shape(s));
  }

  @Get()
  @RequirePermission('SLIDER_MANAGE')
  async all() {
    const list = await this.prisma.slider.findMany({
      where: { deletedAt: null },
      include: { document: { select: { id: true, mime: true, originalName: true, sizeBytes: true } }, bank: { select: { name: true } } },
      orderBy: { sortOrder: 'asc' },
    });
    return list.map((s) => ({ ...this.shape(s), mediaName: s.document?.originalName ?? null }));
  }

  @Post()
  @RequirePermission('SLIDER_MANAGE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VIDEO_BYTES, files: 1 } }))
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta, @UploadedFile() file?: File) {
    const { removeMedia: _r, ...b } = parse(sliderSchema, body);
    const stored = file ? await this.storage.save(file, { video: true, imagesOnly: true }) : null;
    const last = await this.prisma.slider.aggregate({ where: { deletedAt: null }, _max: { sortOrder: true } });
    return this.prisma.$transaction(async (tx) => {
      const doc = stored ? await tx.document.create({ data: { ...stored, uploadedById: user.id } }) : null;
      const s = await tx.slider.create({
        data: { ...b, startsAt: b.startsAt ?? new Date(), mediaType: doc ? (doc.mime.startsWith('video/') ? 'VIDEO' : 'IMAGE') : 'NONE', documentId: doc?.id ?? null, sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: user.id },
      });
      await this.audit.log(tx, user, { action: 'SLIDER_ADDED', entity: 'slider', entityId: s.id, after: { ...s, media: stored?.originalName } }, meta);
      return s;
    });
  }

  @Patch(':id')
  @RequirePermission('SLIDER_MANAGE')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VIDEO_BYTES, files: 1 } }))
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta, @UploadedFile() file?: File) {
    const { removeMedia, ...b } = parse(sliderSchema, body);
    const before = await this.prisma.slider.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Slide');
    const stored = file ? await this.storage.save(file, { video: true, imagesOnly: true }) : null;
    return this.prisma.$transaction(async (tx) => {
      const doc = stored ? await tx.document.create({ data: { ...stored, uploadedById: user.id } }) : null;
      const media = doc
        ? { documentId: doc.id, mediaType: doc.mime.startsWith('video/') ? 'VIDEO' : 'IMAGE', mediaUrl: null }
        : removeMedia
          ? { documentId: null, mediaType: 'NONE', mediaUrl: null }
          : {};
      const s = await tx.slider.update({
        where: { id },
        data: { ...b, subtitle: b.subtitle ?? null, ctaLabel: b.ctaLabel ?? null, ctaUrl: b.ctaUrl ?? null, bankId: b.bankId ?? null, startsAt: b.startsAt ?? before.startsAt, endsAt: b.endsAt ?? null, ...media },
      });
      await this.audit.log(tx, user, { action: 'SLIDER_UPDATED', entity: 'slider', entityId: id, before, after: s }, meta);
      return s;
    });
  }

  @Post('reorder')
  @RequirePermission('SLIDER_MANAGE')
  async reorder(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const { ids } = parse(reorderSchema, body);
    const found = await this.prisma.slider.count({ where: { id: { in: ids }, deletedAt: null } });
    if (found !== ids.length) throw new AppError('VALIDATION_ERROR', 'Some slides no longer exist. Reload and try again.');
    await this.prisma.$transaction(async (tx) => {
      for (const [i, id] of ids.entries()) await tx.slider.update({ where: { id }, data: { sortOrder: i + 1 } });
      await this.audit.log(tx, user, { action: 'SLIDERS_REORDERED', entity: 'slider', after: { ids } }, meta);
    });
    return null;
  }

  @Delete(':id')
  @RequirePermission('SLIDER_MANAGE')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const before = await this.prisma.slider.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Slide');
    await this.prisma.$transaction(async (tx) => {
      await tx.slider.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      await this.audit.log(tx, user, { action: 'SLIDER_DELETED', entity: 'slider', entityId: id, before }, meta);
    });
    return null;
  }

  /** Slide picture or video for signed-in users. Cached privately in the browser. */
  @Get(':id/media')
  async media(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const s = await this.prisma.slider.findFirst({ where: { id, deletedAt: null }, include: { document: true } });
    if (!s?.document) throw notFound('Media');
    const body = await this.storage.read(s.document.storageKey);
    res.set({
      'Content-Type': s.document.mime,
      'Content-Length': String(body.length),
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }
}
