import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CASE_ACTIONS,
  CASE_STATUS_LABELS,
  allowedCaseActions,
  caseListQuerySchema,
  computePayoutAmount,
  formatCaseNo,
  formatINR,
  type CaseAction,
  type CaseStatus,
  type CreateCaseInput,
} from '@rupeemap/shared';
import { z } from 'zod';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { ScopeService } from '../common/scope.service';
import { NotifyService } from '../common/notify.service';
import { RedisService } from '../common/redis.service';
import { canAdjustPayout } from '../payouts/payouts.controller';
import { AppError, conflict, forbidden, notFound } from '../common/errors';
import { can, type AuthUser, type RequestMeta } from '../common/auth-context';
import { parse } from '../common/validate';
import { Paged } from '../common/http';

export const correctionSchema = z.object({
  field: z.enum(['sanctionAmount', 'disbursedTotal', 'handoverAmount', 'appliedAmount']),
  value: z.coerce.number().positive('Enter an amount more than zero'),
  reason: z.string().trim().min(3, 'Enter a reason').max(500),
  version: z.number().int().nonnegative(),
});

const LIST_SELECT = {
  id: true,
  caseNo: true,
  loanType: true,
  loanAccountNo: true,
  status: true,
  statusChangedAt: true,
  appliedAmount: true,
  sanctionAmount: true,
  disbursedTotal: true,
  handoverAmount: true,
  createdAt: true,
  dsaId: true,
  teamPartnerId: true,
  customer: { select: { name: true, mobile: true } },
  bank: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.LoanCaseSelect;

@Injectable()
export class CasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly notify: NotifyService,
    private readonly redis: RedisService,
  ) {}

  /** Who owns a new case, derived from the signed-in user — never trusted from the form. */
  private async resolveOwnership(actor: AuthUser, input: CreateCaseInput) {
    if (actor.role === 'TEAM_PARTNER') {
      if (!actor.teamDsaUserId) throw forbidden('You are not linked to a DSA. Contact Rupeemap support.');
      return { dsaId: actor.teamDsaUserId, teamPartnerId: actor.id };
    }
    const dsaId = actor.role === 'DSA' ? actor.id : input.dsaId;
    if (!dsaId) throw new AppError('VALIDATION_ERROR', 'Choose the DSA for this case', { fields: { dsaId: 'Choose a DSA' } });
    if (actor.role === 'DSA' && input.dsaId && input.dsaId !== actor.id) throw forbidden();
    const dsa = await this.prisma.user.findFirst({ where: { id: dsaId, role: 'DSA', status: 'ACTIVE', deletedAt: null } });
    if (!dsa) throw new AppError('VALIDATION_ERROR', 'Selected DSA is not active', { fields: { dsaId: 'Not active' } });
    let teamPartnerId: string | null = null;
    if (input.teamPartnerId) {
      const m = await this.prisma.teamMembership.findFirst({ where: { userId: input.teamPartnerId, endedOn: null, dsa: { userId: dsaId } } });
      if (!m) throw new AppError('VALIDATION_ERROR', 'Selected Team Partner is not in this DSA team', { fields: { teamPartnerId: 'Not in this team' } });
      teamPartnerId = input.teamPartnerId;
    }
    return { dsaId, teamPartnerId };
  }

  /**
   * Possible duplicates: same customer mobile or PAN on a case that is still open.
   * Out-of-scope matches are reported without details.
   */
  async findDuplicates(actor: AuthUser, input: { customerMobile?: string; customerPan?: string; customerName?: string }) {
    const or: Prisma.LoanCaseWhereInput[] = [];
    if (input.customerMobile) or.push({ customer: { mobile: input.customerMobile } });
    if (input.customerPan) or.push({ customer: { pan: input.customerPan } });
    if (!or.length) return [];
    const matches = await this.prisma.loanCase.findMany({
      where: { deletedAt: null, status: { notIn: ['REJECT', 'WITHDRAW'] }, OR: or },
      select: { ...LIST_SELECT },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    const visibleIds = new Set(
      (await this.prisma.loanCase.findMany({ where: { AND: [this.scope.caseWhere(actor), { id: { in: matches.map((m) => m.id) } }] }, select: { id: true } })).map((c) => c.id),
    );
    return matches.map((m) =>
      visibleIds.has(m.id)
        ? { visible: true, id: m.id, caseNo: m.caseNo, customerName: m.customer.name, bank: m.bank.name, status: m.status, createdAt: m.createdAt }
        : { visible: false, status: m.status, createdAt: m.createdAt, bank: m.bank.name },
    );
  }

  async create(actor: AuthUser, input: CreateCaseInput, meta: RequestMeta) {
    await this.redis.limit(`case:create:${actor.id}`, 60, 3600, 'Too many cases created in a short time. Please try again later.');
    const own = await this.resolveOwnership(actor, input);

    const [bank, project, lt] = await Promise.all([
      this.prisma.bank.findFirst({ where: { id: input.bankId, active: true } }),
      input.projectId ? this.prisma.project.findFirst({ where: { id: input.projectId, active: true, deletedAt: null } }) : null,
      this.prisma.loanType.findFirst({ where: { code: input.loanType, active: true } }),
    ]);
    if (!bank) throw new AppError('VALIDATION_ERROR', 'Choose a bank from the list', { fields: { bankId: 'Choose a bank' } });
    if (input.projectId && !project) throw new AppError('VALIDATION_ERROR', 'Choose a project from Project Master', { fields: { projectId: 'Choose from Project Master' } });
    if (!lt) throw new AppError('VALIDATION_ERROR', 'Choose a loan type', { fields: { loanType: 'Choose a loan type' } });

    if (!input.acknowledgeDuplicate) {
      const dups = await this.findDuplicates(actor, input);
      if (dups.length) throw new AppError('DUPLICATE_SUSPECTED', 'A case for this customer may already exist', { duplicates: dups });
    }

    let salesManagerName = input.salesManagerName ?? null;
    if (input.salesManagerId) {
      const sm = await this.prisma.bankerContact.findFirst({ where: { id: input.salesManagerId, bankId: bank.id, deletedAt: null } });
      if (!sm) throw new AppError('VALIDATION_ERROR', 'Selected sales manager is not from this bank');
      salesManagerName = sm.name;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const year = new Date().getFullYear();
      const [{ last_seq }] = await tx.$queryRaw<{ last_seq: number }[]>`
        INSERT INTO case_counters (year, last_seq) VALUES (${year}, 1)
        ON CONFLICT (year) DO UPDATE SET last_seq = case_counters.last_seq + 1
        RETURNING last_seq`;
      const customer = await tx.customer.create({
        data: { name: input.customerName, mobile: input.customerMobile ?? null, pan: input.customerPan ?? null },
      });
      const c = await tx.loanCase.create({
        data: {
          caseNo: formatCaseNo(year, last_seq),
          customerId: customer.id,
          coApplicantName: input.coApplicantName || null,
          loanType: lt.code,
          appliedAmount: input.appliedAmount,
          bankId: bank.id,
          projectId: project?.id ?? null,
          salesManagerId: input.salesManagerId ?? null,
          salesManagerName,
          status: 'LOGIN',
          dsaId: own.dsaId,
          teamPartnerId: own.teamPartnerId,
          createdById: actor.id,
          createdRole: actor.role,
        },
      });
      await tx.caseStageHistory.create({
        data: {
          caseId: c.id,
          action: 'CREATE',
          fromStatus: null,
          toStatus: 'LOGIN',
          data: { appliedAmount: input.appliedAmount, bank: bank.name, project: project?.name ?? null },
          remarks: input.remarks || null,
          changedById: actor.id,
          changedByName: actor.name,
          changedRole: actor.role,
        },
      });
      if (input.remarks) {
        await tx.caseRemark.create({ data: { caseId: c.id, kind: 'NOTE', body: input.remarks, createdById: actor.id, createdByName: actor.name, createdRole: actor.role } });
      }
      await this.audit.log(tx, actor, { action: 'CASE_CREATED', entity: 'case', entityId: c.id, after: c }, meta);
      await this.notify.toUsers(tx, [own.dsaId, own.teamPartnerId].filter((u) => u !== actor.id), {
        title: `New case ${c.caseNo}`,
        body: `${input.customerName} · ${lt.name} · ${bank.name} logged by ${actor.name}`,
        caseId: c.id,
      });
      return c;
    });
    return { id: created.id, caseNo: created.caseNo, status: created.status };
  }

  async list(actor: AuthUser, query: unknown) {
    const q = parse(caseListQuerySchema, query);
    const and: Prisma.LoanCaseWhereInput[] = [this.scope.caseWhere(actor)];
    if (q.status) and.push({ status: { in: q.status.split(',') as CaseStatus[] } });
    if (q.loanType) and.push({ loanType: q.loanType });
    if (q.bankId) and.push({ bankId: q.bankId });
    if (q.projectId) and.push({ projectId: q.projectId });
    if (q.dsaId) and.push({ dsaId: q.dsaId });
    if (q.teamPartnerId) and.push({ teamPartnerId: q.teamPartnerId });
    if (q.from || q.to) and.push({ createdAt: { gte: q.from, lte: q.to ? endOfDay(q.to) : undefined } });
    if (q.q) {
      const digits = q.q.replace(/\D/g, '');
      and.push({
        OR: [
          { caseNo: { contains: q.q, mode: 'insensitive' } },
          { loanAccountNo: { contains: q.q, mode: 'insensitive' } },
          { customer: { name: { contains: q.q, mode: 'insensitive' } } },
          ...(digits.length >= 4 ? [{ customer: { mobile: { contains: digits } } }] : []),
        ],
      });
    }
    const where = { AND: and };
    const [items, total] = await Promise.all([
      this.prisma.loanCase.findMany({ where, select: LIST_SELECT, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.loanCase.count({ where }),
    ]);
    const people = await this.names(items.flatMap((i) => [i.dsaId, i.teamPartnerId]));
    return new Paged(
      items.map((i) => ({
        ...i,
        customer: { name: i.customer.name, mobile: i.customer.mobile },
        dsa: people.get(i.dsaId) ?? null,
        teamPartner: i.teamPartnerId ? people.get(i.teamPartnerId) ?? null : null,
        daysInStage: Math.floor((Date.now() - i.statusChangedAt.getTime()) / 86_400_000),
      })),
      { page: q.page, pageSize: q.pageSize, total },
    );
  }

  private async names(ids: (string | null)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    const users = uniq.length ? await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } }) : [];
    return new Map(users.map((u) => [u.id, u]));
  }

  private async getScoped(actor: AuthUser, id: string) {
    const c = await this.prisma.loanCase.findFirst({ where: { AND: [this.scope.caseWhere(actor), { id }] } });
    if (!c) throw notFound('Case');
    return c;
  }

  async detail(actor: AuthUser, id: string) {
    await this.getScoped(actor, id);
    const c = await this.prisma.loanCase.findUniqueOrThrow({
      where: { id },
      include: {
        customer: true,
        bank: { select: { id: true, name: true } },
        project: true,
        salesManager: { include: { designation: true } },
        stageHistory: { orderBy: { changedAt: 'asc' } },
        disbursements: { orderBy: { disbursedOn: 'asc' } },
        remarks: { orderBy: { createdAt: 'desc' } },
        payouts: { where: this.scope.payoutWhere(actor), include: { history: { orderBy: { changedAt: 'desc' } } } },
      },
    });
    const people = await this.names([c.dsaId, c.teamPartnerId, c.createdById, c.assignedExecutiveId, ...c.payouts.map((p) => p.beneficiaryId)]);
    const kyc = await this.prisma.kycProfile.findMany({ where: { userId: { in: c.payouts.map((p) => p.beneficiaryId) } } });
    const audit = can(actor, 'AUDIT_VIEW')
      ? await this.prisma.auditLog.findMany({ where: { entity: 'case', entityId: id }, orderBy: { id: 'desc' }, take: 100 })
      : [];
    const auditActors = await this.names(audit.map((a) => a.actorId));
    return {
      ...c,
      customer: { ...c.customer, pan: c.customer.pan ? c.customer.pan.slice(0, 2) + 'XXXXX' + c.customer.pan.slice(-3) : null },
      dsa: people.get(c.dsaId) ?? null,
      teamPartner: c.teamPartnerId ? people.get(c.teamPartnerId) ?? null : null,
      createdBy: people.get(c.createdById) ?? null,
      payouts: c.payouts.map((p) => ({
        ...p,
        beneficiary: people.get(p.beneficiaryId) ?? null,
        kycStatus: kyc.find((k) => k.userId === p.beneficiaryId)?.status ?? null,
        canAdjust: p.status !== 'PAID' && canAdjustPayout(actor, { beneficiaryRole: p.beneficiaryRole, loanCase: { dsaId: c.dsaId } }),
      })),
      allowedActions: allowedCaseActions(c.status as CaseStatus, {
        role: actor.role,
        canChangeStatus: can(actor, 'CASE_STATUS_CHANGE'),
        canReopen: can(actor, 'CASE_REOPEN'),
      }),
      canCorrect: can(actor, 'CASE_FINANCIAL_CORRECTION'),
      audit: audit.map((a) => ({ ...a, id: a.id.toString(), actor: a.actorId ? auditActors.get(a.actorId)?.name ?? null : null })),
      daysInStage: Math.floor((Date.now() - c.statusChangedAt.getTime()) / 86_400_000),
    };
  }

  /**
   * Status change. Runs in one transaction with a row lock and a version check,
   * so two people acting at once cannot both succeed.
   */
  async transition(actor: AuthUser, id: string, action: string, version: number, rawData: unknown, meta: RequestMeta, idemKey?: string) {
    if (!(action in CASE_ACTIONS)) throw new AppError('INVALID_TRANSITION', 'Unknown action');
    const a = action as CaseAction;
    if (!can(actor, 'CASE_STATUS_CHANGE')) throw forbidden();
    if (a === 'REOPEN' && !can(actor, 'CASE_REOPEN')) throw forbidden('Only Admin can reopen a case');
    const def = CASE_ACTIONS[a];
    const data = parse(def.schema, rawData) as Record<string, any>;
    await this.getScoped(actor, id);

    if (idemKey) {
      const prev = await this.prisma.idempotencyKey.findUnique({ where: { key: `${actor.id}:${idemKey}` } });
      if (prev) return prev.response;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM loan_cases WHERE id = ${id}::uuid FOR UPDATE`;
      if (!locked) throw notFound('Case');
      const c = await tx.loanCase.findUniqueOrThrow({ where: { id }, include: { customer: true, bank: true } });
      if (c.version !== version) throw conflict();
      if (!def.from.includes(c.status as CaseStatus)) {
        throw new AppError('INVALID_TRANSITION', `A case in ${CASE_STATUS_LABELS[c.status as CaseStatus]} cannot be moved with "${def.label}"`);
      }

      const now = new Date();
      let to: CaseStatus = (def.to ?? c.statusBeforeQuery ?? 'LOGIN') as CaseStatus;
      const update: Prisma.LoanCaseUpdateInput = { version: { increment: 1 } };
      let remarks: string | null = data.remarks ?? null;

      switch (a) {
        case 'SANCTION':
          update.sanctionAmount = data.sanctionAmount;
          update.sanctionDate = now;
          break;
        case 'DISBURSE': {
          const total = Number(c.disbursedTotal ?? 0) + data.disbursedAmount;
          if (c.sanctionAmount && total > Number(c.sanctionAmount) && !can(actor, 'CASE_FINANCIAL_CORRECTION')) {
            throw new AppError('VALIDATION_ERROR', `Total disbursed (${formatINR(total)}) cannot exceed the sanction amount (${formatINR(c.sanctionAmount.toString())})`, {
              fields: { disbursedAmount: 'More than sanction amount' },
            });
          }
          if (c.disbursementType === 'FULL') throw new AppError('INVALID_TRANSITION', 'This case is already fully disbursed');
          await tx.caseDisbursement.create({ data: { caseId: id, amount: data.disbursedAmount, type: data.disbursementType, enteredById: actor.id } });
          update.disbursedTotal = total;
          update.disbursementType = data.disbursementType;
          update.disbursedDate = now;
          break;
        }
        case 'HANDOVER':
          update.handoverAmount = data.handoverAmount;
          update.otcPddCleared = data.otcPddCleared;
          update.loanAccountNo = data.loanAccountNo;
          update.salesManagerName = data.salesManagerName;
          update.salesManagerEmail = data.salesManagerEmail;
          update.handoverDate = now;
          break;
        case 'RAISE_QUERY':
          update.statusBeforeQuery = c.status;
          await tx.caseRemark.create({ data: { caseId: id, kind: 'QUERY', body: data.remarks, createdById: actor.id, createdByName: actor.name, createdRole: actor.role } });
          break;
        case 'RESOLVE_QUERY':
          to = (c.statusBeforeQuery ?? 'LOGIN') as CaseStatus;
          update.statusBeforeQuery = null;
          await tx.caseRemark.create({ data: { caseId: id, kind: 'QUERY_RESOLUTION', body: data.remarks, createdById: actor.id, createdByName: actor.name, createdRole: actor.role } });
          break;
        case 'REJECT':
        case 'WITHDRAW':
          remarks = `${data.reason}: ${data.remarks}`;
          break;
        case 'REOPEN':
          remarks = data.reason;
          break;
      }
      update.status = to;
      if (to !== c.status) update.statusChangedAt = now;

      const updated = await tx.loanCase.update({ where: { id }, data: update });
      await tx.caseStageHistory.create({
        data: {
          caseId: id,
          action: a,
          fromStatus: c.status,
          toStatus: to,
          data: data as Prisma.InputJsonValue,
          remarks,
          changedById: actor.id,
          changedByName: actor.name,
          changedRole: actor.role,
        },
      });

      const payouts = a === 'HANDOVER' ? await this.createPayouts(tx, updated, actor) : [];

      await this.audit.log(
        tx,
        actor,
        { action: `CASE_${a}`, entity: 'case', entityId: id, before: pickFinancial(c), after: { ...pickFinancial(updated), payouts: payouts.map((p) => ({ id: p.id, amount: p.amount, percent: p.percentSnapshot })) } },
        meta,
      );
      await this.notify.toUsers(tx, [c.dsaId, c.teamPartnerId].filter((u) => u !== actor.id), {
        title: `${c.caseNo} moved to ${CASE_STATUS_LABELS[to]}`,
        body: `${c.customer.name} · ${c.bank.name}${remarks ? ` · ${remarks.slice(0, 140)}` : ''}`,
        caseId: id,
        priority: to === 'QUERY' || to === 'REJECT' ? 'HIGH' : 'NORMAL',
      });

      const response = { id, status: to, version: updated.version, payoutsCreated: payouts.length };
      if (idemKey) {
        await tx.idempotencyKey.create({ data: { key: `${actor.id}:${idemKey}`, userId: actor.id, route: `case-transition:${id}`, response } });
      }
      return response;
    });
    return result;
  }

  /**
   * Handover → payout PENDING, rates snapshotted. The DSA's slab is the total
   * payout for the case: a Team Partner's share is carved out of it and the
   * DSA keeps the rest (slab 0.90%, Team Partner 0.50% → DSA 0.40%).
   */
  private async createPayouts(tx: Tx, c: { id: string; caseNo: string; dsaId: string; teamPartnerId: string | null; handoverAmount: Prisma.Decimal | null; bankId: string; loanType: string }, actor: AuthUser) {
    const base = Number(c.handoverAmount ?? 0);
    const out = [];
    const dsaRate = await this.findRate(tx, c.dsaId, c.bankId, c.loanType);
    const slab = dsaRate ? Number(dsaRate.percent) : 0;
    const tpRate = c.teamPartnerId ? await this.findRate(tx, c.teamPartnerId, c.bankId, c.loanType) : null;
    const tpShare = c.teamPartnerId ? Math.min(tpRate ? Number(tpRate.percent) : 0, slab) : 0;
    const lines: { id: string; role: 'DSA' | 'TEAM_PARTNER'; percent: number; rate: typeof dsaRate | typeof tpRate; note: string | null }[] = [
      {
        id: c.dsaId,
        role: 'DSA',
        percent: roundPct(slab - tpShare),
        rate: dsaRate,
        note: !dsaRate ? 'DSA payout slab not set; Admin to confirm the rate' : c.teamPartnerId ? `Slab ${slab}% less Team Partner share ${tpShare}%` : null,
      },
    ];
    if (c.teamPartnerId) {
      lines.push({
        id: c.teamPartnerId,
        role: 'TEAM_PARTNER',
        percent: roundPct(tpShare),
        rate: tpRate,
        note: !tpRate ? 'Team Partner payout % not set; DSA to set it' : tpRate && Number(tpRate.percent) > slab ? `Capped at the DSA slab of ${slab}%` : null,
      });
    }
    for (const b of lines) {
      const { rate, percent } = b;
      const p = await tx.payout.create({
        data: {
          caseId: c.id,
          beneficiaryId: b.id,
          beneficiaryRole: b.role,
          baseAmount: base,
          percentSnapshot: percent,
          rateId: rate?.id ?? null,
          amount: computePayoutAmount(base, percent),
          status: 'PENDING',
          remarks: b.note,
        },
      });
      await tx.payoutHistory.create({
        data: {
          payoutId: p.id,
          newAmount: p.amount,
          newStatus: 'PENDING',
          newPercent: p.percentSnapshot,
          reason: `Created automatically on Handover of ${c.caseNo}`,
          changedById: actor.id,
          changedByName: actor.name,
        },
      });
      out.push(p);
    }
    return out;
  }

  /** Most specific rate effective today: bank+loan type, then bank, then loan type, then default. */
  private async findRate(tx: Tx, userId: string, bankId: string, loanType: string) {
    const rates = await tx.payoutRate.findMany({
      where: {
        userId,
        effectiveFrom: { lte: new Date() },
        OR: [
          { bankId, loanType },
          { bankId, loanType: null },
          { bankId: null, loanType },
          { bankId: null, loanType: null },
        ],
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const rank = (r: { bankId: string | null; loanType: string | null }) => (r.bankId ? 2 : 0) + (r.loanType ? 1 : 0);
    return rates.sort((x, y) => rank(y) - rank(x))[0] ?? null;
  }

  /** Admin/Executive correction of an amount after it was entered. Reason required, fully audited. */
  async correct(actor: AuthUser, id: string, input: z.infer<typeof correctionSchema>, meta: RequestMeta) {
    if (!can(actor, 'CASE_FINANCIAL_CORRECTION')) throw forbidden();
    await this.getScoped(actor, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM loan_cases WHERE id = ${id}::uuid FOR UPDATE`;
      const c = await tx.loanCase.findUniqueOrThrow({ where: { id }, include: { payouts: true } });
      if (c.version !== input.version) throw conflict();
      const prev = c[input.field];
      if (prev === null && input.field !== 'appliedAmount') throw new AppError('VALIDATION_ERROR', 'This amount has not been entered yet');
      const updated = await tx.loanCase.update({ where: { id }, data: { [input.field]: input.value, version: { increment: 1 } } });
      await tx.caseRemark.create({
        data: {
          caseId: id,
          kind: 'CORRECTION',
          body: `${label(input.field)} corrected from ${formatINR(prev?.toString())} to ${formatINR(input.value)}. Reason: ${input.reason}`,
          createdById: actor.id,
          createdByName: actor.name,
          createdRole: actor.role,
        },
      });
      // A corrected handover amount flows into unpaid payouts at their snapshotted percentage.
      if (input.field === 'handoverAmount') {
        for (const p of c.payouts.filter((p) => p.status !== 'PAID')) {
          const amount = computePayoutAmount(input.value, Number(p.percentSnapshot));
          await tx.payout.update({ where: { id: p.id }, data: { baseAmount: input.value, amount, version: { increment: 1 } } });
          await tx.payoutHistory.create({
            data: { payoutId: p.id, prevAmount: p.amount, newAmount: amount, prevPercent: p.percentSnapshot, newPercent: p.percentSnapshot, reason: `Handover amount corrected: ${input.reason}`, changedById: actor.id, changedByName: actor.name },
          });
        }
      }
      await this.audit.log(tx, actor, { action: 'CASE_FINANCIAL_CORRECTION', entity: 'case', entityId: id, before: { [input.field]: prev }, after: { [input.field]: input.value, reason: input.reason } }, meta);
      return { id, version: updated.version };
    });
  }

  async addRemark(actor: AuthUser, id: string, body: string, meta: RequestMeta) {
    await this.getScoped(actor, id);
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.caseRemark.create({ data: { caseId: id, kind: actor.role === 'ADMIN' || actor.role === 'EXECUTIVE' ? 'BANK' : 'NOTE', body, createdById: actor.id, createdByName: actor.name, createdRole: actor.role } });
      await this.audit.log(tx, actor, { action: 'CASE_REMARK_ADDED', entity: 'case', entityId: id, after: { body } }, meta);
      return r;
    });
  }
}

function pickFinancial(c: any) {
  return {
    status: c.status,
    sanctionAmount: c.sanctionAmount,
    disbursedTotal: c.disbursedTotal,
    disbursementType: c.disbursementType,
    handoverAmount: c.handoverAmount,
    loanAccountNo: c.loanAccountNo,
    version: c.version,
  };
}

function label(f: string) {
  return { sanctionAmount: 'Sanction amount', disbursedTotal: 'Disbursed amount', handoverAmount: 'Handover amount', appliedAmount: 'Applied amount' }[f] ?? f;
}

function endOfDay(d: Date) {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

function roundPct(n: number) {
  return Math.max(0, Math.round(n * 1000) / 1000);
}
