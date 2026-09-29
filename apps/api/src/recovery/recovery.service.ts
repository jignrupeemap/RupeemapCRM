import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RECOVERY_ACTIONS,
  RECOVERY_STATUS_LABELS,
  formatINR,
  recoveryActionSchema,
  recoveryCreateSchema,
  recoveryReceiptSchema,
  type RecoveryStatus,
} from '@rupeemap/shared';
import type { z } from 'zod';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../common/notify.service';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { can, type AuthUser, type RequestMeta } from '../common/auth-context';
import { Paged } from '../common/http';

const isStaff = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'EXECUTIVE';
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Only these fields may go into a partner WhatsApp (PART 37): no customer mobile, PAN or loan account. */
export const RECOVERY_WHATSAPP_TEMPLATE =
  'Dear {{dsa_name}}{{team_partner_name}}, the bank has recovered the payout on case {{case_id}} ({{customer_name}}). Please pay {{recovery_amount}} to Rupeemap by {{due_date}}. Thank you, Rupeemap';

/**
 * Recovery (PART 35–37): when a bank claws back a payout, Admin/Executives
 * record it, raise a demand on the partner and enter what the partner repays.
 * Outstanding is always demanded − received, never typed. Partners see their
 * own recoveries read-only.
 */
@Injectable()
export class RecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  private where(user: AuthUser): Prisma.RecoveryWhereInput {
    if (!can(user, 'RECOVERY_VIEW')) return { id: '00000000-0000-0000-0000-000000000000' };
    if (isStaff(user)) return {};
    if (user.role === 'DSA') return { payout: { loanCase: { dsaId: user.id } } };
    if (user.role === 'TEAM_PARTNER') return { beneficiaryId: user.id };
    return { id: '00000000-0000-0000-0000-000000000000' };
  }

  private assertManage(user: AuthUser) {
    if (!isStaff(user) || !can(user, 'RECOVERY_UPDATE')) throw forbidden();
  }

  private async people(ids: string[]) {
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, mobile: true, role: true } });
    return new Map(users.map((u) => [u.id, u]));
  }

  private shape(r: any, people: Map<string, { id: string; name: string; mobile: string; role: string }>, user: AuthUser) {
    const demanded = r.amountDemanded === null ? null : Number(r.amountDemanded);
    const received = Number(r.amountReceived);
    return {
      id: r.id,
      version: r.version,
      status: r.status as RecoveryStatus,
      recoveryAmount: Number(r.recoveryAmount),
      amountDemanded: demanded,
      amountReceived: received,
      outstanding: demanded === null ? null : round2(demanded - received),
      recoveryDate: r.recoveryDate,
      dueDate: r.dueDate,
      overdue: !!r.dueDate && new Date(r.dueDate) < new Date() && ['DEMAND_RAISED', 'PARTIALLY_RECOVERED'].includes(r.status),
      bankRemarks: r.bankRemarks,
      reason: r.reason,
      createdAt: r.createdAt,
      beneficiary: people.get(r.beneficiaryId) ? { id: r.beneficiaryId, name: people.get(r.beneficiaryId)!.name, role: people.get(r.beneficiaryId)!.role } : null,
      payout: { id: r.payout.id, amount: Number(r.payout.amount), percent: Number(r.payout.percentSnapshot), status: r.payout.status },
      loanCase: {
        id: r.payout.loanCase.id,
        caseNo: r.payout.loanCase.caseNo,
        customerName: r.payout.loanCase.customer.name,
        bank: r.payout.loanCase.bank.name,
        dsa: people.get(r.payout.loanCase.dsaId)?.name ?? null,
      },
      receipts: r.receipts?.map((x: any) => ({ ...x, amount: Number(x.amount) })),
      history: r.history,
      canManage: isStaff(user) && can(user, 'RECOVERY_UPDATE'),
      canWhatsApp: can(user, 'WHATSAPP_SEND'),
    };
  }

  private include(withDetail: boolean) {
    return {
      payout: { include: { loanCase: { select: { id: true, caseNo: true, dsaId: true, teamPartnerId: true, customer: { select: { name: true } }, bank: { select: { name: true } } } } } },
      ...(withDetail ? { receipts: { orderBy: { receivedOn: 'desc' as const } }, history: { orderBy: { changedAt: 'desc' as const } } } : {}),
    } satisfies Prisma.RecoveryInclude;
  }

  async list(user: AuthUser, q: { status?: string; caseId?: string; beneficiaryId?: string; from?: string; to?: string; page?: string }) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = 20;
    const date = (v?: string) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : undefined);
    const base: Prisma.RecoveryWhereInput[] = [
      this.where(user),
      { payout: { loanCase: { deletedAt: null } } },
      q.caseId ? { caseId: q.caseId } : {},
      q.beneficiaryId ? { beneficiaryId: q.beneficiaryId } : {},
      q.from || q.to ? { recoveryDate: { gte: date(q.from), lte: date(q.to) } } : {},
    ];
    const where: Prisma.RecoveryWhereInput = { AND: [...base, q.status ? { status: { in: q.status.split(',') as RecoveryStatus[] } } : {}] };
    const [items, total, agg] = await Promise.all([
      this.prisma.recovery.findMany({ where, include: this.include(!!q.caseId), orderBy: [{ updatedAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.recovery.count({ where }),
      this.prisma.recovery.groupBy({ by: ['status'], where: { AND: base }, _sum: { recoveryAmount: true, amountDemanded: true, amountReceived: true }, _count: true }),
    ]);
    const people = await this.people(items.flatMap((r) => [r.beneficiaryId, r.payout.loanCase.dsaId]));
    const paged = new Paged(
      items.map((r) => this.shape(r, people, user)),
      { page, pageSize, total },
    );
    const open = agg.filter((a) => !['WAIVED', 'CLOSED', 'FULLY_RECOVERED'].includes(a.status));
    (paged.meta as any).summary = {
      byStatus: agg.map((a) => ({ status: a.status, count: a._count })),
      bankRecovered: round2(agg.reduce((s, a) => s + Number(a._sum.recoveryAmount ?? 0), 0)),
      demanded: round2(agg.reduce((s, a) => s + Number(a._sum.amountDemanded ?? 0), 0)),
      received: round2(agg.reduce((s, a) => s + Number(a._sum.amountReceived ?? 0), 0)),
      outstanding: round2(open.reduce((s, a) => s + Number(a._sum.amountDemanded ?? 0) - Number(a._sum.amountReceived ?? 0), 0)),
    };
    return paged;
  }

  async detail(user: AuthUser, id: string) {
    const r = await this.prisma.recovery.findFirst({ where: { AND: [this.where(user), { id }] }, include: this.include(true) });
    if (!r) throw notFound('Recovery');
    const people = await this.people([r.beneficiaryId, r.payout.loanCase.dsaId]);
    return this.shape(r, people, user);
  }

  async create(user: AuthUser, b: z.infer<typeof recoveryCreateSchema>, meta: RequestMeta) {
    this.assertManage(user);
    const p = await this.prisma.payout.findUnique({ where: { id: b.payoutId }, include: { loanCase: true } });
    if (!p || p.loanCase.deletedAt) throw notFound('Payout');
    if (b.recoveryAmount > Number(p.amount) && Number(p.amount) > 0) {
      throw new AppError('VALIDATION_ERROR', `Recovery cannot be more than the payout of ${formatINR(Number(p.amount))}`, { fields: { recoveryAmount: 'More than the payout' } });
    }
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.recovery.create({
        data: { payoutId: p.id, caseId: p.caseId, beneficiaryId: p.beneficiaryId, recoveryAmount: b.recoveryAmount, recoveryDate: b.recoveryDate, bankRemarks: b.bankRemarks, reason: b.reason, createdById: user.id },
      });
      await this.history(tx, r.id, user, 'CREATED', null, 'RECOVERY_PENDING', { recoveryAmount: b.recoveryAmount, bankRemarks: b.bankRemarks }, b.reason);
      await this.audit.log(tx, user, { action: 'RECOVERY_RECORDED', entity: 'case', entityId: p.caseId, after: r }, meta);
      return r;
    });
  }

  async act(user: AuthUser, id: string, b: z.infer<typeof recoveryActionSchema>, meta: RequestMeta) {
    this.assertManage(user);
    const def = RECOVERY_ACTIONS[b.action];
    if (def.adminOnly && user.role !== 'ADMIN') throw forbidden('Only Admin can waive a recovery');
    return this.prisma.$transaction(async (tx) => {
      const r = await this.lock(tx, id);
      if (r.version !== b.version) throw conflict();
      if (!(def.from as readonly string[]).includes(r.status)) {
        throw new AppError('INVALID_TRANSITION', `A recovery in "${RECOVERY_STATUS_LABELS[r.status as RecoveryStatus]}" cannot be moved with "${def.label}"`);
      }
      const data: Prisma.RecoveryUpdateInput = { status: def.to, version: { increment: 1 } };
      if (b.action === 'RAISE_DEMAND') {
        const demanded = b.amountDemanded ?? Number(r.recoveryAmount);
        if (!b.dueDate) throw new AppError('VALIDATION_ERROR', 'Choose the due date for the partner', { fields: { dueDate: 'Required' } });
        data.amountDemanded = demanded;
        data.dueDate = b.dueDate;
      }
      const updated = await tx.recovery.update({ where: { id }, data });
      await this.history(tx, id, user, b.action, r.status as RecoveryStatus, def.to, { amountDemanded: b.amountDemanded, dueDate: b.dueDate }, b.reason);
      await this.audit.log(tx, user, { action: `RECOVERY_${b.action}`, entity: 'case', entityId: r.caseId, before: { status: r.status }, after: { status: def.to, amountDemanded: updated.amountDemanded, dueDate: updated.dueDate, reason: b.reason } }, meta);
      if (b.action === 'RAISE_DEMAND' || b.action === 'WAIVE' || b.action === 'REJECT_DISPUTE') {
        const c = await tx.loanCase.findUniqueOrThrow({ where: { id: r.caseId }, select: { caseNo: true, dsaId: true } });
        await this.notify.toUsers(tx, [r.beneficiaryId, c.dsaId], {
          title: b.action === 'WAIVE' ? `Recovery waived on ${c.caseNo}` : `Payout recovery due on ${c.caseNo}`,
          body:
            b.action === 'WAIVE'
              ? `Rupeemap has waived the recovery on ${c.caseNo}. ${b.reason}`
              : `The bank recovered the payout on ${c.caseNo}. Please pay ${formatINR(Number(updated.amountDemanded ?? 0))} by ${updated.dueDate?.toISOString().slice(0, 10)}. ${b.reason}`,
          caseId: r.caseId,
          priority: 'HIGH',
          sentById: user.id,
        });
      }
      return { id, status: updated.status, version: updated.version };
    });
  }

  /** Money received from the partner. Status follows the outstanding amount automatically. */
  async receipt(user: AuthUser, id: string, b: z.infer<typeof recoveryReceiptSchema>, meta: RequestMeta) {
    this.assertManage(user);
    return this.prisma.$transaction(async (tx) => {
      const r = await this.lock(tx, id);
      if (r.version !== b.version) throw conflict();
      if (!['DEMAND_RAISED', 'PARTIALLY_RECOVERED'].includes(r.status)) throw new AppError('INVALID_TRANSITION', 'Raise a demand before entering amounts received');
      const demanded = Number(r.amountDemanded ?? 0);
      const outstanding = round2(demanded - Number(r.amountReceived));
      if (b.amount > outstanding) throw new AppError('VALIDATION_ERROR', `Only ${formatINR(outstanding)} is outstanding`, { fields: { amount: `Maximum ${outstanding}` } });
      await tx.recoveryReceipt.create({ data: { recoveryId: id, amount: b.amount, receivedOn: b.receivedOn, reference: b.reference, enteredById: user.id, enteredByName: user.name } });
      const received = round2(Number(r.amountReceived) + b.amount);
      const next: RecoveryStatus = received >= demanded ? 'FULLY_RECOVERED' : 'PARTIALLY_RECOVERED';
      const updated = await tx.recovery.update({ where: { id }, data: { amountReceived: received, status: next, version: { increment: 1 } } });
      await this.history(tx, id, user, 'RECEIPT', r.status as RecoveryStatus, next, { amount: b.amount, reference: b.reference, outstanding: round2(demanded - received) }, `Received ${formatINR(b.amount)}${b.reference ? ` (${b.reference})` : ''}`);
      await this.audit.log(tx, user, { action: 'RECOVERY_RECEIPT', entity: 'case', entityId: r.caseId, before: { amountReceived: r.amountReceived, status: r.status }, after: { amountReceived: received, status: next, amount: b.amount, reference: b.reference } }, meta);
      return { id, status: next, version: updated.version, outstanding: round2(demanded - received) };
    });
  }

  /** Prefilled WhatsApp message to the partner. Built on the server so only permitted fields are ever used. */
  async whatsapp(user: AuthUser, id: string, meta: RequestMeta) {
    if (!can(user, 'WHATSAPP_SEND') || !isStaff(user)) throw forbidden('You are not allowed to send WhatsApp messages');
    const r = await this.prisma.recovery.findUnique({ where: { id }, include: this.include(false) });
    if (!r) throw notFound('Recovery');
    if (r.amountDemanded === null) throw new AppError('INVALID_TRANSITION', 'Raise a demand before messaging the partner');
    const c = r.payout.loanCase;
    const people = await this.people([c.dsaId, ...(c.teamPartnerId ? [c.teamPartnerId] : [])]);
    const to = people.get(r.beneficiaryId) ?? people.get(c.dsaId)!;
    const outstanding = round2(Number(r.amountDemanded) - Number(r.amountReceived));
    const values: Record<string, string> = {
      dsa_name: r.beneficiaryId === c.dsaId ? people.get(c.dsaId)?.name ?? '' : '',
      team_partner_name: r.beneficiaryId !== c.dsaId ? people.get(r.beneficiaryId)?.name ?? '' : '',
      case_id: c.caseNo,
      customer_name: c.customer.name,
      recovery_amount: formatINR(outstanding),
      due_date: r.dueDate ? r.dueDate.toISOString().slice(0, 10).split('-').reverse().join('/') : '',
    };
    const text = RECOVERY_WHATSAPP_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? '');
    await this.prisma.$transaction((tx) => this.audit.log(tx, user, { action: 'RECOVERY_WHATSAPP_PREPARED', entity: 'case', entityId: r.caseId, after: { recoveryId: id, to: to.id } }, meta));
    return { mobile: to.mobile, name: to.name, text, url: `https://wa.me/91${to.mobile}?text=${encodeURIComponent(text)}` };
  }

  /** Outstanding recovery in the caller's scope, for dashboards. */
  async outstanding(user: AuthUser) {
    const rows = await this.prisma.recovery.aggregate({
      where: { AND: [this.where(user), { status: { in: ['DEMAND_RAISED', 'PARTIALLY_RECOVERED', 'DISPUTED'] } }, { payout: { loanCase: { deletedAt: null } } }] },
      _sum: { amountDemanded: true, amountReceived: true },
      _count: true,
    });
    return { count: rows._count, amount: round2(Number(rows._sum.amountDemanded ?? 0) - Number(rows._sum.amountReceived ?? 0)) };
  }

  private async lock(tx: Tx, id: string) {
    const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM recoveries WHERE id = ${id}::uuid FOR UPDATE`;
    if (!row) throw notFound('Recovery');
    return tx.recovery.findUniqueOrThrow({ where: { id } });
  }

  private history(tx: Tx, recoveryId: string, user: AuthUser, action: string, prev: RecoveryStatus | null, next: RecoveryStatus, data: Record<string, unknown>, reason: string) {
    return tx.recoveryHistory.create({
      data: { recoveryId, action, prevStatus: prev, newStatus: next, data: JSON.parse(JSON.stringify(data)), reason, changedById: user.id, changedByName: user.name },
    });
  }
}
