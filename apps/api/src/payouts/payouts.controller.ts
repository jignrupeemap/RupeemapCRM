import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PAYOUT_STATUS_LABELS, bankReceiptSchema, canMovePayout, payoutUpdateSchema, type PayoutStatus } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { ScopeService } from '../common/scope.service';
import { NotifyService } from '../common/notify.service';
import { parse } from '../common/validate';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { can, CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';
import { Paged } from '../common/http';

const payoutAdjustSchema = z
  .object({
    version: z.number().int().nonnegative(),
    percent: z.number().min(0, 'Cannot be negative').max(100).optional(),
    amount: z.number().min(0, 'Cannot be negative').max(1e12).optional(),
    reason: z.string().trim().min(3, 'Enter a reason').max(500),
  })
  .refine((v) => (v.percent === undefined) !== (v.amount === undefined), { message: 'Enter either a percentage or an amount', path: ['percent'] });

/** Staff with PAYOUT_UPDATE: any payout. DSA: only Team Partner lines on their own cases. */
export function canAdjustPayout(user: AuthUser, p: { beneficiaryRole: string; loanCase: { dsaId: string } }) {
  if ((user.role === 'ADMIN' || user.role === 'EXECUTIVE') && can(user, 'PAYOUT_UPDATE')) return true;
  return user.role === 'DSA' && p.beneficiaryRole === 'TEAM_PARTNER' && p.loanCase.dsaId === user.id;
}

@Controller('payouts')
export class PayoutsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly notify: NotifyService,
  ) {}

  @Get()
  @RequirePermission('PAYOUT_VIEW')
  async list(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
    const date = (v?: string) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : undefined);
    // Everything except status, so the status totals follow the person and date filters.
    const base: Prisma.PayoutWhereInput[] = [
      this.scope.payoutWhere(user),
      { loanCase: { deletedAt: null } },
      q.bankReceived === '1' ? { receivedFromBank: true } : q.bankReceived === '0' ? { receivedFromBank: false } : {},
      q.beneficiaryId ? { beneficiaryId: q.beneficiaryId } : {},
      q.from || q.to ? { createdAt: { gte: date(q.from), lte: date(q.to) } } : {},
    ];
    const where: Prisma.PayoutWhereInput = { AND: [...base, q.status ? { status: { in: q.status.split(',') as PayoutStatus[] } } : {}] };
    const [items, total, sums] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        include: { loanCase: { select: { id: true, caseNo: true, dsaId: true, teamPartnerId: true, loanType: true, loanAccountNo: true, handoverDate: true, customer: { select: { name: true } }, bank: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payout.count({ where }),
      this.prisma.payout.groupBy({ by: ['status'], where: { AND: base }, _sum: { amount: true }, _count: true }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.beneficiaryId))] } }, select: { id: true, name: true } });
    const kyc = await this.prisma.kycProfile.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, status: true } });
    const paged = new Paged(
      items.map((i) => ({
        ...i,
        beneficiary: users.find((u) => u.id === i.beneficiaryId) ?? null,
        kycStatus: kyc.find((k) => k.userId === i.beneficiaryId)?.status ?? null,
        canAdjust: i.status !== 'PAID' && canAdjustPayout(user, i),
      })),
      { page, pageSize, total },
    );
    (paged.meta as any).summary = sums.map((s) => ({ status: s.status, count: s._count, amount: Number(s._sum.amount ?? 0) }));
    return paged;
  }

  /**
   * Change the payout % or amount on one case (Rupeemap's request, 29 Sep 2026).
   * Admin and Executives with PAYOUT_UPDATE can adjust any unpaid payout; a DSA
   * can adjust only their own Team Partners' lines on their own cases, and not
   * above the DSA's own % on that case. Every change is kept in payout history.
   */
  @Patch(':id/amount')
  async adjust(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(payoutAdjustSchema, body);
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payouts WHERE id = ${id}::uuid FOR UPDATE`;
      if (!row) throw notFound('Payout');
      const p = await tx.payout.findUniqueOrThrow({ where: { id }, include: { loanCase: { select: { id: true, caseNo: true, dsaId: true, deletedAt: true } } } });
      if (p.loanCase.deletedAt) throw notFound('Payout');
      if (!canAdjustPayout(user, p)) throw forbidden('You can change payouts only for your own Team Partners');
      if (p.version !== b.version) throw conflict();
      if (p.status === 'PAID') throw new AppError('INVALID_TRANSITION', 'A paid payout cannot be changed. Record a recovery instead.');

      const base = Number(p.baseAmount);
      const percent = b.percent !== undefined ? b.percent : base ? Math.round((b.amount! / base) * 100 * 1000) / 1000 : 0;
      const amount = b.amount !== undefined ? b.amount : Math.round(((base * b.percent!) / 100) * 100) / 100;
      if (percent > 100) throw new AppError('VALIDATION_ERROR', 'Payout cannot be more than the handover amount', { fields: { amount: 'Too high' } });

      if (user.role === 'DSA') {
        const own = await tx.payout.findFirst({ where: { caseId: p.caseId, beneficiaryId: user.id } });
        const cap = own ? Number(own.percentSnapshot) : null;
        if (cap !== null && percent > cap) {
          throw new AppError('VALIDATION_ERROR', `Team Partner payout cannot be more than your own ${cap}% on this case`, { fields: { percent: `Maximum ${cap}%` } });
        }
      }

      const updated = await tx.payout.update({
        where: { id },
        data: { amount, percentSnapshot: percent, version: { increment: 1 }, remarks: b.reason },
      });
      await tx.payoutHistory.create({
        data: {
          payoutId: id,
          prevStatus: p.status,
          newStatus: p.status,
          prevAmount: p.amount,
          newAmount: amount,
          prevPercent: p.percentSnapshot,
          newPercent: percent,
          reason: `Adjusted for this case: ${b.reason}`,
          changedById: user.id,
          changedByName: user.name,
        },
      });
      await this.audit.log(
        tx,
        user,
        { action: 'PAYOUT_ADJUSTED', entity: 'payout', entityId: id, before: { amount: p.amount, percent: p.percentSnapshot }, after: { amount, percent, reason: b.reason } },
        meta,
      );
      await this.notify.toUsers(tx, [p.beneficiaryId], {
        title: `Payout changed for ${p.loanCase.caseNo}`,
        body: `${percent}% · ₹${amount.toLocaleString('en-IN')} (was ₹${Number(p.amount).toLocaleString('en-IN')}). ${b.reason}`,
        caseId: p.loanCase.id,
        sentById: user.id,
      });
      return { id, amount: updated.amount, percentSnapshot: updated.percentSnapshot, version: updated.version };
    });
  }

  /**
   * Only Admin / permitted Executives reach this (PAYOUT_UPDATE is impossible
   * for DSA and Team Partner roles). KYC gate applies before PAID.
   */
  @Patch(':id/status')
  @RequirePermission('PAYOUT_UPDATE')
  async updateStatus(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta, @Headers('idempotency-key') idem?: string) {
    const b = parse(payoutUpdateSchema, body);
    if (idem) {
      const prev = await this.prisma.idempotencyKey.findUnique({ where: { key: `${user.id}:${idem}` } });
      if (prev) return prev.response;
    }
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payouts WHERE id = ${id}::uuid FOR UPDATE`;
      if (!row) throw notFound('Payout');
      const p = await tx.payout.findUniqueOrThrow({ where: { id }, include: { loanCase: { select: { caseNo: true, id: true } } } });
      if (p.version !== b.version) throw conflict();
      if (!canMovePayout(p.status as PayoutStatus, b.status)) {
        throw new AppError('INVALID_TRANSITION', `Payout cannot move from ${PAYOUT_STATUS_LABELS[p.status as PayoutStatus]} to ${PAYOUT_STATUS_LABELS[b.status]}`);
      }
      if (b.status === 'PAID') {
        const kyc = await tx.kycProfile.findUnique({ where: { userId: p.beneficiaryId } });
        if (kyc?.status !== 'APPROVED') throw new AppError('KYC_NOT_APPROVED', 'First payout KYC verification pending. Admin must approve KYC before this payout can be paid.');
        if (!b.paymentRef) throw new AppError('VALIDATION_ERROR', 'Enter the payment reference (UTR)', { fields: { paymentRef: 'Required for Paid' } });
      }
      const updated = await tx.payout.update({
        where: { id },
        data: {
          status: b.status,
          version: { increment: 1 },
          ...(b.status === 'PAID' ? { paidOn: b.paidOn ?? new Date(), paymentRef: b.paymentRef } : {}),
          remarks: b.reason,
        },
      });
      await tx.payoutHistory.create({
        data: { payoutId: id, prevStatus: p.status, newStatus: b.status, prevAmount: p.amount, newAmount: p.amount, reason: b.reason, changedById: user.id, changedByName: user.name },
      });
      await this.audit.log(tx, user, { action: 'PAYOUT_STATUS_CHANGED', entity: 'payout', entityId: id, before: { status: p.status }, after: { status: b.status, reason: b.reason, paymentRef: b.paymentRef } }, meta);
      await this.notify.toUsers(tx, [p.beneficiaryId], {
        title: `Payout ${PAYOUT_STATUS_LABELS[b.status]} for ${p.loanCase.caseNo}`,
        body: `Amount ₹${Number(p.amount).toLocaleString('en-IN')}${b.status === 'HOLD' ? ` · ${b.reason}` : ''}`,
        caseId: p.loanCase.id,
      });
      const response = { id, status: updated.status, version: updated.version };
      if (idem) await tx.idempotencyKey.create({ data: { key: `${user.id}:${idem}`, userId: user.id, route: `payout-status:${id}`, response } });
      return response;
    });
  }

  @Post(':id/bank-receipt')
  @RequirePermission('PAYOUT_MARK_BANK_RECEIVED')
  async bankReceipt(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Meta() meta: RequestMeta) {
    const b = parse(bankReceiptSchema, body);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payouts WHERE id = ${id}::uuid FOR UPDATE`;
      const p = await tx.payout.findUnique({ where: { id } });
      if (!p) throw notFound('Payout');
      if (p.version !== b.version) throw conflict();
      const updated = await tx.payout.update({
        where: { id },
        data: { receivedFromBank: true, bankReceivedAmount: b.amount, bankReceivedOn: b.receivedOn, version: { increment: 1 } },
      });
      await tx.payoutHistory.create({ data: { payoutId: id, prevStatus: p.status, newStatus: p.status, reason: `Received from bank ₹${b.amount}: ${b.reason}`, changedById: user.id, changedByName: user.name } });
      await this.audit.log(tx, user, { action: 'PAYOUT_BANK_RECEIVED', entity: 'payout', entityId: id, before: { receivedFromBank: p.receivedFromBank }, after: b }, meta);
      return { id, version: updated.version };
    });
  }
}
