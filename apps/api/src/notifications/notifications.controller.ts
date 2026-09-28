import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { RedisService } from '../common/redis.service';
import { parse } from '../common/validate';
import { AppError, forbidden } from '../common/errors';
import { can, CurrentUser, Meta, type AuthUser, type RequestMeta } from '../common/auth-context';

const sendSchema = z.object({
  audience: z.enum(['ALL', 'DSA', 'TEAM_PARTNER', 'EXECUTIVE', 'USER']),
  userId: z.string().uuid().optional(),
  title: z.string().trim().min(3, 'Enter a title').max(120),
  body: z.string().trim().min(3, 'Enter the message').max(2000),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']).default('NORMAL'),
  startsAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
});

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
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
      this.prisma.notificationRecipient.findMany({ where, include: { notification: true }, orderBy: { notification: { createdAt: 'desc' } }, take: 50 }),
      this.prisma.notificationRecipient.count({ where: { ...where, readAt: null } }),
    ]);
    return {
      unreadCount,
      items: items.map((r) => ({
        id: r.notificationId,
        title: r.notification.title,
        body: r.notification.body,
        priority: r.notification.priority,
        caseId: r.notification.caseId,
        createdAt: r.notification.createdAt,
        readAt: r.readAt,
      })),
    };
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

  @Post()
  async send(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
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
    return this.prisma.$transaction(async (tx) => {
      const n = await tx.notification.create({
        data: {
          title: b.title,
          body: b.body,
          priority: b.priority,
          audience: b.audience,
          startsAt: b.startsAt ?? new Date(),
          expiresAt: b.expiresAt,
          sentById: user.id,
        },
      });
      // Batched insert; large audiences move to the worker queue in Phase 14.
      await tx.notificationRecipient.createMany({ data: recipients.map((r) => ({ notificationId: n.id, userId: r.id })) });
      await this.audit.log(tx, user, { action: 'NOTIFICATION_SENT', entity: 'notification', entityId: n.id, after: { ...b, recipients: recipients.length } }, meta);
      return { id: n.id, recipients: recipients.length };
    });
  }
}
