import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { bankCodeSchema } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parse } from '../common/validate';
import { AppError, notFound } from '../common/errors';
import { CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';

const isStaff = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'EXECUTIVE';

/**
 * Bankwise Codes (PART 41). Admin/Executives manage them; partners search
 * only codes marked visible to partners that are active and not expired.
 */
@Controller('bank-codes')
export class BankCodesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('BANK_CODE_VIEW')
  list(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    const staff = isStaff(user);
    const today = new Date(new Date().toISOString().slice(0, 10));
    const current: Prisma.BankCodeWhereInput = { active: true, OR: [{ expiresOn: null }, { expiresOn: { gte: today } }] };
    const where: Prisma.BankCodeWhereInput = {
      AND: [
        { deletedAt: null },
        staff ? (q.show === 'all' ? {} : q.show === 'expired' ? { OR: [{ active: false }, { expiresOn: { lt: today } }] } : current) : { ...current, visibleToPartners: true },
        q.bankId ? { bankId: q.bankId } : {},
        q.product ? { product: { contains: q.product, mode: 'insensitive' } } : {},
        q.city ? { city: { contains: q.city, mode: 'insensitive' } } : {},
        q.q
          ? {
              OR: [
                { code: { contains: q.q, mode: 'insensitive' } },
                { product: { contains: q.q, mode: 'insensitive' } },
                { branch: { contains: q.q, mode: 'insensitive' } },
                { city: { contains: q.q, mode: 'insensitive' } },
                { region: { contains: q.q, mode: 'insensitive' } },
                { bank: { name: { contains: q.q, mode: 'insensitive' } } },
              ],
            }
          : {},
      ],
    };
    return this.prisma.bankCode.findMany({
      where,
      include: { bank: { select: { id: true, name: true, shortName: true } } },
      orderBy: [{ bank: { name: 'asc' } }, { product: 'asc' }, { city: 'asc' }],
      take: 500,
    });
  }

  @Post()
  @RequirePermission('BANK_CODE_MANAGE')
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(bankCodeSchema, body);
    await this.assertUnique(b.bankId, b.product, b.code);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.bankCode.create({ data: { ...b, createdById: user.id } });
      await this.audit.log(tx, user, { action: 'BANK_CODE_ADDED', entity: 'bank_code', entityId: c.id, after: c }, meta);
      return c;
    });
  }

  @Patch(':id')
  @RequirePermission('BANK_CODE_MANAGE')
  async update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(bankCodeSchema, body);
    const before = await this.prisma.bankCode.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Bank code');
    await this.assertUnique(b.bankId, b.product, b.code, id);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.bankCode.update({
        where: { id },
        data: { ...b, city: b.city ?? null, region: b.region ?? null, branch: b.branch ?? null, effectiveFrom: b.effectiveFrom ?? null, expiresOn: b.expiresOn ?? null, remarks: b.remarks ?? null },
      });
      await this.audit.log(tx, user, { action: 'BANK_CODE_UPDATED', entity: 'bank_code', entityId: id, before, after: c }, meta);
      return c;
    });
  }

  @Delete(':id')
  @RequirePermission('BANK_CODE_MANAGE')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Meta() meta: RequestMeta) {
    const before = await this.prisma.bankCode.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Bank code');
    await this.prisma.$transaction(async (tx) => {
      await tx.bankCode.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
      await this.audit.log(tx, user, { action: 'BANK_CODE_DELETED', entity: 'bank_code', entityId: id, before }, meta);
    });
    return null;
  }

  private async assertUnique(bankId: string, product: string, code: string, exceptId?: string) {
    const dup = await this.prisma.bankCode.findFirst({
      where: { bankId, deletedAt: null, product: { equals: product, mode: 'insensitive' }, code: { equals: code, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined },
    });
    if (dup) throw new AppError('CONFLICT', `Code ${code} is already listed for this bank and product`, { fields: { code: 'Already listed' } });
  }
}
