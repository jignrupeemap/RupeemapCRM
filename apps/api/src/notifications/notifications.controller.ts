import { contentDisposition } from '../common/http-safety';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { RedisService } from '../common/redis.service';
import { StorageService, MAX_UPLOAD_BYTES } from '../common/storage.service';
import { parse } from '../common/validate';
import { AppError, forbidden, notFound } from '../common/errors';
import { can, CurrentUser, Meta, type AuthUser, type RequestMeta } from '../common/auth-context';

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const sendSchema = z
  .object({
    audience: z.enum(['ALL', 'DSA', 'TEAM_PARTNER', 'EXECUTIVE', 'USER']),
    userId: z.preprocess(blank, z.string().uuid().optional()),
    title: z.string().trim().min(3, 'Enter a title').max(120),
    body: z.string().trim().min(3, 'Enter the message').max(2000),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
    startsAt: z.preprocess(blank, z.coerce.date().optional()),
    expiresAt: z.preprocess(blank, z.coerce.date().optional()),
  })
  .refine((v) => !v.startsAt || !v.expiresAt || v.startsAt < v.expiresAt, { message: 'Expiry must be after the start', path: ['expiresAt'] });

/** In-app notifications (PART 47, 77): bell, read/unread, and staff broadcasts with an optional attachment. */
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async mine(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    const now = new Date();
    const where = {
      userId: user.id,
      notification: { startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ...(unread === '1' ? { readAt: null } : {}),
    };
    const [items, unreadCount] = await Promise.all([
      this.prisma.notificationRecipient.findMany({
        where,
        include: { notification: { include: { document: { select: { id: true, originalName: true } } } } },
        orderBy: { notification: { createdAt: 'desc' } },
        take: 50,
      }),
      this.prisma.notificationRecipient.count({ where: { ...where, readAt: null } }),
    ]);
    const caseIds = [...new Set(items.map((r) => r.notification.caseId).filter((x): x is string => !!x))];
    const cases = caseIds.length ? await this.prisma.loanCase.findMany({ where: { id: { in: caseIds } }, select: { id: true, caseNo: true } }) : [];
    return {
      unreadCount,
      items: items.map((r) => ({
        id: r.notificationId,
        title: r.notification.title,
        body: r.notification.body,
        priority: r.notification.priority,
        caseId: r.notification.caseId,
        caseNo: cases.find((c) => c.id === r.notification.caseId)?.caseNo ?? null,
        attachment: r.notification.document,
        createdAt: r.notification.createdAt,
        readAt: r.readAt,
      })),
    };
  }

  /** Staff: what they (or, for Admin, anyone) have sent, with how many have read it. */
  @Get('sent')
  async sent(@CurrentUser() user: AuthUser) {
    if (!can(user, 'NOTIFICATION_SEND_INDIVIDUAL') && !can(user, 'NOTIFICATION_SEND_BROADCAST')) throw forbidden();
    const list = await this.prisma.notification.findMany({
      where: { audience: { not: 'SYSTEM' }, ...(user.role === 'ADMIN' ? {} : { sentById: user.id }) },
      include: { document: { select: { id: true, originalName: true } }, _count: { select: { recipients: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const reads = await this.prisma.notificationRecipient.groupBy({ by: ['notificationId'], where: { notificationId: { in: list.map((n) => n.id) }, readAt: { not: null } }, _count: true });
    const senders = await this.prisma.user.findMany({ where: { id: { in: list.map((n) => n.sentById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    return list.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      audience: n.audience,
      priority: n.priority,
      startsAt: n.startsAt,
      expiresAt: n.expiresAt,
      createdAt: n.createdAt,
      attachment: n.document,
      sentBy: senders.find((s) => s.id === n.sentById)?.name ?? null,
      recipients: n._count.recipients,
      read: reads.find((r) => r.notificationId === n.id)?._count ?? 0,
    }));
  }

  @Post(':id/read')
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notificationRecipient.updateMany({ where: { notificationId: id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return null;
  }

  @Post('read-all')
  async readAll(@CurrentUser() user: AuthUser) {
    await this.prisma.notificationRecipient.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return null;
  }

  /** JSON, or multipart with an optional "file" attachment (PDF or image, max 10 MB). */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async send(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta, @UploadedFile() file?: { buffer: Buffer; originalname: string; size: number }) {
    const b = parse(sendSchema, body);
    if (b.audience === 'USER' ? !can(user, 'NOTIFICATION_SEND_INDIVIDUAL') : !can(user, 'NOTIFICATION_SEND_BROADCAST')) throw forbidden();
    if (b.audience === 'USER' && !b.userId) throw new AppError('VALIDATION_ERROR', 'Choose the user', { fields: { userId: 'Choose a user' } });
    await this.redis.limit(`notify:${user.id}`, 30, 3600);
    const recipients = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ACTIVE', 'PENDING_ACTIVATION'] },
        ...(b.audience === 'USER' ? { id: b.userId } : b.audience === 'ALL' ? {} : { role: b.audience }),
      },
      select: { id: true },
    });
    if (!recipients.length) throw new AppError('VALIDATION_ERROR', 'No users match this audience');
    const stored = file ? await this.storage.save(file) : null;
    return this.prisma.$transaction(async (tx) => {
      const doc = stored ? await tx.document.create({ data: { ...stored, uploadedById: user.id } }) : null;
      const n = await tx.notification.create({
        data: {
          title: b.title,
          body: b.body,
          priority: b.priority,
          audience: b.audience,
          startsAt: b.startsAt ?? new Date(),
          expiresAt: b.expiresAt,
          sentById: user.id,
          documentId: doc?.id ?? null,
        },
      });
      // Batched insert keeps a send to every partner quick.
      for (let i = 0; i < recipients.length; i += 1000) {
        await tx.notificationRecipient.createMany({ data: recipients.slice(i, i + 1000).map((r) => ({ notificationId: n.id, userId: r.id })) });
      }
      await this.audit.log(tx, user, { action: 'NOTIFICATION_SENT', entity: 'notification', entityId: n.id, after: { ...b, recipients: recipients.length, attachment: stored?.originalName } }, meta);
      return { id: n.id, recipients: recipients.length };
    });
  }

  /** Attachment, only for someone the notification was sent to, or staff who can send. */
  @Get(':id/attachment')
  async attachment(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta, @Res() res: Response) {
    const n = await this.prisma.notification.findUnique({ where: { id }, include: { document: true } });
    if (!n?.document) throw notFound('Attachment');
    const staff = (user.role === 'ADMIN' || user.role === 'EXECUTIVE') && (can(user, 'NOTIFICATION_SEND_INDIVIDUAL') || can(user, 'NOTIFICATION_SEND_BROADCAST'));
    if (!staff && !(await this.prisma.notificationRecipient.count({ where: { notificationId: id, userId: user.id } }))) throw notFound('Attachment');
    const body = await this.storage.read(n.document.storageKey);
    await this.prisma.documentAccessLog.create({ data: { documentId: n.document.id, userId: user.id, ip: meta.ip } });
    res.set({
      'Content-Type': n.document.mime,
      'Content-Length': String(body.length),
      'Content-Disposition': contentDisposition('inline', n.document.originalName),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    });
    res.end(body);
  }
}
