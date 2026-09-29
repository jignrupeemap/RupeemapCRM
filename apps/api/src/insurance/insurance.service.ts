import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  INSURANCE_PAYOUT_LABELS,
  INSURANCE_PAYOUT_TRANSITIONS,
  type InsurancePayoutStatus,
  type InsurancePolicyInput,
  insurancePayoutUpdateSchema,
} from '@rupeemap/shared';
import type { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { ScopeService } from '../common/scope.service';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { can, type AuthUser, type RequestMeta } from '../common/auth-context';
import { Paged } from '../common/http';

const isStaff = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'EXECUTIVE';

/**
 * Insurance (PART 34). A separate ledger from loan payouts: the insurance
 * commission is Rupeemap's alone (Rupeemap's rule, 29 Sep 2026) and never feeds
 * any DSA or Team Partner payout, total or dashboard. Partners can see the
 * policy on their own case, never the commission.
 */
@Injectable()
export class InsuranceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  private assertManage(user: AuthUser) {
    if (!isStaff(user) || !can(user, 'INSURANCE_UPDATE')) throw forbidden();
  }

  async forCase(user: AuthUser, caseId: string) {
    if (!can(user, 'INSURANCE_VIEW')) throw forbidden();
    const c = await this.prisma.loanCase.findFirst({ where: { AND: [this.scope.caseWhere(user), { id: caseId }] }, select: { id: true } });
    if (!c) throw notFound('Case');
    const staff = isStaff(user);
    const policies = await this.prisma.insurancePolicy.findMany({
      where: { caseId, deletedAt: null },
      include: staff ? { payout: { include: { history: { orderBy: { changedAt: 'desc' } } } } } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    return {
      policies: policies.map((p: any) => ({ ...p, payout: staff ? (p.payout ?? null) : undefined })),
      canManage: staff && can(user, 'INSURANCE_UPDATE'),
    };
  }

  async create(user: AuthUser, caseId: string, input: InsurancePolicyInput, meta: RequestMeta) {
    this.assertManage(user);
    const c = await this.prisma.loanCase.findFirst({ where: { id: caseId, deletedAt: null } });
    if (!c) throw notFound('Case');
    if (c.status === 'REJECT' || c.status === 'WITHDRAW') throw new AppError('INVALID_TRANSITION', 'Insurance cannot be added to a rejected or withdrawn case');
    const { payoutAmount, ...policy } = input;
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.insurancePolicy.create({ data: { ...policy, caseId, createdById: user.id } });
      const payout = await tx.insurancePayout.create({ data: { policyId: p.id, amount: payoutAmount ?? 0 } });
      await tx.insurancePayoutHistory.create({
        data: { payoutId: payout.id, newAmount: payout.amount, newStatus: 'PENDING', reason: 'Insurance added', changedById: user.id, changedByName: user.name },
      });
      await this.audit.log(tx, user, { action: 'INSURANCE_ADDED', entity: 'case', entityId: caseId, after: { policy: p, payoutAmount: payout.amount } }, meta);
      return { ...p, payout };
    });
  }

  async update(user: AuthUser, id: string, input: InsurancePolicyInput, meta: RequestMeta) {
    this.assertManage(user);
    const before = await this.prisma.insurancePolicy.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound('Insurance');
    const { payoutAmount: _ignored, ...policy } = input; // commission changes go through the payout endpoint
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.insurancePolicy.update({ where: { id }, data: { ...policy, version: { increment: 1 } } });
      await this.audit.log(tx, user, { action: 'INSURANCE_UPDATED', entity: 'case', entityId: before.caseId, before, after: p }, meta);
      return p;
    });
  }

  /** Change Rupeemap's commission amount and/or status. Reason required; history kept. */
  async updatePayout(user: AuthUser, policyId: string, b: z.infer<typeof insurancePayoutUpdateSchema>, meta: RequestMeta) {
    this.assertManage(user);
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM insurance_payouts WHERE policy_id = ${policyId}::uuid FOR UPDATE`;
      if (!row) throw notFound('Insurance payout');
      const p = await tx.insurancePayout.findUniqueOrThrow({ where: { id: row.id }, include: { policy: true } });
      if (p.version !== b.version) throw conflict();
      const next = b.status ?? p.status;
      if (b.status && b.status !== p.status && !INSURANCE_PAYOUT_TRANSITIONS[p.status as InsurancePayoutStatus].includes(b.status)) {
        throw new AppError('INVALID_TRANSITION', `Insurance payout cannot move from ${INSURANCE_PAYOUT_LABELS[p.status as InsurancePayoutStatus]} to ${INSURANCE_PAYOUT_LABELS[b.status]}`);
      }
      if (p.status === 'RECEIVED' && b.amount !== undefined) throw new AppError('INVALID_TRANSITION', 'A received insurance payout cannot be changed');
      const amount = b.amount ?? Number(p.amount);
      if (next === 'RECEIVED' && amount <= 0) throw new AppError('VALIDATION_ERROR', 'Enter the commission amount before marking it received', { fields: { amount: 'Required' } });
      const updated = await tx.insurancePayout.update({
        where: { id: p.id },
        data: {
          amount,
          status: next,
          version: { increment: 1 },
          remarks: b.reason,
          ...(next === 'RECEIVED' ? { receivedOn: b.receivedOn ?? new Date(), reference: b.reference ?? null } : {}),
        },
      });
      await tx.insurancePayoutHistory.create({
        data: {
          payoutId: p.id,
          prevAmount: p.amount,
          newAmount: amount,
          prevStatus: p.status,
          newStatus: next,
          reason: b.reason,
          changedById: user.id,
          changedByName: user.name,
        },
      });
      await this.audit.log(
        tx,
        user,
        { action: 'INSURANCE_PAYOUT_CHANGED', entity: 'case', entityId: p.policy.caseId, before: { amount: p.amount, status: p.status }, after: { amount, status: next, reason: b.reason, reference: b.reference } },
        meta,
      );
      return updated;
    });
  }

  /** Staff register of all insurance with Rupeemap's commission. */
  async list(user: AuthUser, q: { status?: string; from?: string; to?: string; q?: string; page?: string }) {
    if (!isStaff(user) || !can(user, 'INSURANCE_VIEW')) throw forbidden();
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = 20;
    const date = (v?: string) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : undefined);
    const base: Prisma.InsurancePolicyWhereInput[] = [
      { deletedAt: null, loanCase: { deletedAt: null } },
      q.from || q.to ? { createdAt: { gte: date(q.from), lte: date(q.to) } } : {},
      q.q ? { OR: [{ companyName: { contains: q.q, mode: 'insensitive' } }, { policyNumber: { contains: q.q, mode: 'insensitive' } }, { loanCase: { customer: { name: { contains: q.q, mode: 'insensitive' } } } }, { loanCase: { caseNo: { contains: q.q, mode: 'insensitive' } } }] } : {},
    ];
    const where: Prisma.InsurancePolicyWhereInput = { AND: [...base, q.status ? { payout: { status: { in: q.status.split(',') as InsurancePayoutStatus[] } } } : {}] };
    const [items, total, sums] = await Promise.all([
      this.prisma.insurancePolicy.findMany({
        where,
        include: { payout: true, loanCase: { select: { id: true, caseNo: true, customer: { select: { name: true } }, bank: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.insurancePolicy.count({ where }),
      this.prisma.insurancePayout.groupBy({ by: ['status'], where: { policy: { AND: base } }, _sum: { amount: true }, _count: true }),
    ]);
    const paged = new Paged(items, { page, pageSize, total });
    (paged.meta as any).summary = sums.map((s) => ({ status: s.status, count: s._count, amount: Number(s._sum.amount ?? 0) }));
    return paged;
  }

  /** Totals for the staff dashboard. */
  async summary(user: AuthUser, period: { from?: Date; to?: Date }) {
    if (!isStaff(user) || !can(user, 'INSURANCE_VIEW')) return null;
    const where = { policy: { deletedAt: null, loanCase: { deletedAt: null }, createdAt: { gte: period.from, lte: period.to } } };
    const rows = await this.prisma.insurancePayout.groupBy({ by: ['status'], where, _sum: { amount: true }, _count: true });
    const by = (s: string) => rows.find((r) => r.status === s);
    const total = rows.reduce((a, r) => a + Number(r._sum.amount ?? 0), 0);
    return {
      policies: rows.reduce((a, r) => a + r._count, 0),
      total,
      received: Number(by('RECEIVED')?._sum.amount ?? 0),
      pending: total - Number(by('RECEIVED')?._sum.amount ?? 0),
    };
  }
}
