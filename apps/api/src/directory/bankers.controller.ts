import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { bankerSchema, bankerShareSchema } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/validate';
import { AppError, notFound } from '../common/errors';
import { CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';

const isStaff = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'EXECUTIVE';
const designationSchema = z.object({ name: z.string().trim().min(2, 'Enter the designation').max(80), level: z.coerce.number().int().min(0).max(99).default(0) });

/**
 * Banker Directory (PART 42–44). Designations are configurable, with no fixed
 * hierarchy depth. Staff choose which bankers DSA and Team Partners can see.
 */
@Controller()
export class BankersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('bankers')
  @RequirePermission('BANKER_VIEW')
  list(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    const staff = isStaff(user);
    const where: Prisma.BankerContactWhereInput = {
      deletedAt: null,
      ...(staff && q.includeInactive === '1' ? {} : { active: true }),
      ...(staff ? {} : { visibleToPartners: true }),
      ...(q.bankId ? { bankId: q.bankId } : {}),
      ...(q.designationId ? { designationId: q.designationId } : {}),
      ...(q.city ? { city: { equals: q.city, mode: 'insensitive' } } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { branch: { contains: q.q, mode: 'insensitive' } },
              { city: { contains: q.q, mode: 'insensitive' } },
              { product: { contains: q.q, mode: 'insensitive' } },
              { mobile: { contains: q.q } },
            ],
          }
        : {}),
    };
    return this.prisma.bankerContact.findMany({
      where,
      include: { designation: true, bank: { select: { id: true, name: true } } },
      orderBy: [{ bank: { name: 'asc' } }, { designation: { level: 'asc' } }, { name: 'asc' }],
      take: 300,
    });
  }

  @Get('banker-designations')
  @RequirePermission('BANKER_VIEW')
  designations() {
    return this.prisma.bankerDesignation.findMany({ orderBy: [{ level: 'asc' }, { name: 'asc' }] });
  }

  @Post('banker-designations')
  @RequirePermission('BANKER_MANAGE')
  async addDesignation(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(designationSchema, body);
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.bankerDesignation.create({ data: b });
      await this.audit.log(tx, user, { action: 'BANKER_DESIGNATION_ADDED', entity: 'banker_designation', entityId: d.id, after: d }, meta);
      return d;
    });
  }

  @Post('bankers')
  @RequirePermission('BANKER_MANAGE')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(bankerSchema, body);
    await this.assertNoDuplicate(b.bankId, b.mobile, b.email);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.bankerContact.create({ data: b });
      await this.audit.log(tx, user, { action: 'BANKER_ADDED', entity: 'banker', entityId: c.id, after: c }, meta);
      return c;
    });
  }

  @Patch('bankers/:id')
  @RequirePermission('BANKER_MANAGE')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(bankerSchema, body);
    const before = await this.prisma.bankerContact.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Banker');
    await this.assertNoDuplicate(b.bankId, b.mobile, b.email, id);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.bankerContact.update({
        where: { id },
        data: { ...b, designationId: b.designationId ?? null, mobile: b.mobile ?? null, email: b.email ?? null, branch: b.branch ?? null, city: b.city ?? null, region: b.region ?? null, product: b.product ?? null },
      });
      await this.audit.log(tx, user, { action: 'BANKER_UPDATED', entity: 'banker', entityId: id, before, after: c }, meta);
      return c;
    });
  }

  /** Soft delete; cases keep their sales manager link. */
  @Delete('bankers/:id')
  @RequirePermission('BANKER_DELETE')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const before = await this.prisma.bankerContact.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Banker');
    await this.prisma.$transaction(async (tx) => {
      await tx.bankerContact.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      await this.audit.log(tx, user, { action: 'BANKER_DELETED', entity: 'banker', entityId: id, before }, meta);
    });
    return null;
  }

  /** One professional contact card for several bankers, ready for WhatsApp or email (PART 44). */
  @Post('bankers/share')
  @RequirePermission('BANKER_SHARE')
  async share(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(bankerShareSchema, body);
    const list = await this.prisma.bankerContact.findMany({
      where: { id: { in: b.ids }, deletedAt: null },
      include: { designation: true, bank: { select: { name: true } } },
      orderBy: [{ bank: { name: 'asc' } }, { designation: { level: 'asc' } }, { name: 'asc' }],
    });
    if (!list.length) throw notFound('Banker');
    const cards = list.map((c) =>
      [
        `${c.name}${c.designation ? ` · ${c.designation.name}` : ''}`,
        `${c.bank.name}${c.branch ? `, ${c.branch}` : ''}${c.city ? `, ${c.city}` : ''}`,
        c.product ? `Product: ${c.product}` : null,
        c.mobile ? `Mobile: +91 ${c.mobile}` : null,
        c.email ? `Email: ${c.email}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );
    const text = `Banker contacts from Rupeemap\n\n${cards.join('\n\n')}\n\nShared by ${user.name}, Rupeemap`;
    let url: string;
    if (b.channel === 'WHATSAPP') {
      const to = b.to?.replace(/\D/g, '').slice(-10);
      if (b.to && (!to || to.length !== 10)) throw new AppError('VALIDATION_ERROR', 'Enter a 10-digit mobile number', { fields: { to: 'Invalid mobile' } });
      url = `https://wa.me/${to ? `91${to}` : ''}?text=${encodeURIComponent(text)}`;
    } else {
      if (b.to && !z.string().email().safeParse(b.to).success) throw new AppError('VALIDATION_ERROR', 'Enter a valid email', { fields: { to: 'Invalid email' } });
      url = `mailto:${b.to ?? ''}?subject=${encodeURIComponent('Banker contacts from Rupeemap')}&body=${encodeURIComponent(text)}`;
    }
    await this.prisma.$transaction((tx) =>
      this.audit.log(tx, user, { action: 'BANKERS_SHARED', entity: 'banker', after: { ids: list.map((c) => c.id), channel: b.channel, to: b.to ?? null } }, meta),
    );
    return { text, url, count: list.length };
  }

  private async assertNoDuplicate(bankId: string, mobile?: string, email?: string, exceptId?: string) {
    if (!mobile && !email) return;
    const dup = await this.prisma.bankerContact.findFirst({
      where: { bankId, deletedAt: null, NOT: exceptId ? { id: exceptId } : undefined, OR: [...(mobile ? [{ mobile }] : []), ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : [])] },
    });
    if (dup) throw new AppError('CONFLICT', `${dup.name} is already listed for this bank with the same mobile or email`);
  }
}
