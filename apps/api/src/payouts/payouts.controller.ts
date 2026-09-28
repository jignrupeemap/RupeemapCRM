import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PAYOUT_STATUS_LABELS, bankReceiptSchema, canMovePayout, payoutUpdateSchema, type PayoutStatus } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { ScopeService } from '../common/scope.service';
import { NotifyService } from '../common/notify.service';
import { parse } from '../common/validate';
import { AppError, conflict, notFound } from '../common/errors';
import { CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';
import { Paged } from '../common/http';

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
    const where: Prisma.PayoutWhereInput = {
      AND: [
        this.scope.payoutWhere(user),
        { loanCase: { deletedAt: null } },
        q.status ? { status: { in: q.status.split(',') as PayoutStatus[] } } : {},
        q.bankReceived === '1' ? { receivedFromBank: true } : q.bankReceived === '0' ? { receivedFromBank: false } : {},
        q.beneficiaryId ? { beneficiaryId: q.beneficiaryId } : {},
      ],
    };
    const [items, total, sums] = await Promise.all([
      this.prisma.payout.findMany({
        where,
        include: { loanCase: { select: { id: true, caseNo: true, loanType: true, loanAccountNo: true, handoverDate: true, customer: { select: { name: true } }, bank: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.payout.count({ where }),
      this.prisma.payout.groupBy({ by: ['status'], where: { AND: [this.scope.payoutWhere(user), { loanCase: { deletedAt: null } }] }, _sum: { amount: true }, _count: true }),
    ]);
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.beneficiaryId))] } }, select: { id: true, name: true } });
    const kyc = await this.prisma.kycProfile.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { userId: true, status: true } });
    const paged = new Paged(
      items.map((i) => ({ ...i, beneficiary: users.find((u) => u.id === i.beneficiaryId) ?? null, kycStatus: kyc.find((k) => k.userId === i.beneficiaryId)?.status ?? null })),
      { page, pageSize, total },
    );
    (paged.meta as any).summary = sums.map((s) => ({ status: s.status, count: s._count, amount: Number(s._sum.amount ?? 0) }));
    return paged;
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
