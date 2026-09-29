import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { CASE_STATUS_LABELS, INSURANCE_PAYOUT_LABELS, PAYOUT_STATUS_LABELS, RECOVERY_STATUS_LABELS, ROLE_LABELS, TICKET_STATUS_LABELS, type CaseStatus, type Role } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { ScopeService } from '../common/scope.service';
import { forbidden } from '../common/errors';
import { can, type AuthUser } from '../common/auth-context';

export type Col = { key: string; label: string; type?: 'text' | 'number' | 'money' | 'percent' | 'date' };
export interface ReportResult {
  title: string;
  columns: Col[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  truncated?: boolean;
}

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
export const reportFilterSchema = z.object({
  from: z.preprocess(blank, z.coerce.date().optional()),
  to: z.preprocess(blank, z.coerce.date().optional()),
  bankId: z.preprocess(blank, z.string().uuid().optional()),
  projectId: z.preprocess(blank, z.string().uuid().optional()),
  dsaId: z.preprocess(blank, z.string().uuid().optional()),
  teamPartnerId: z.preprocess(blank, z.string().uuid().optional()),
  loanType: z.preprocess(blank, z.string().max(40).optional()),
  status: z.preprocess(blank, z.string().max(200).optional()),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;

const isStaff = (u: AuthUser) => u.role === 'ADMIN' || u.role === 'EXECUTIVE';
const MAX_ROWS = 50_000;
const n = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export const REPORTS: { key: string; label: string; who: 'all' | 'dsa+staff' | 'staff' | 'admin' }[] = [
  { key: 'cases', label: 'Case report', who: 'all' },
  { key: 'dsa-performance', label: 'DSA performance', who: 'staff' },
  { key: 'team-performance', label: 'Team Partner performance', who: 'dsa+staff' },
  { key: 'banks', label: 'Bank report', who: 'all' },
  { key: 'payouts', label: 'Payout report', who: 'all' },
  { key: 'recovery', label: 'Recovery report', who: 'all' },
  { key: 'insurance', label: 'Insurance report', who: 'staff' },
  { key: 'queries', label: 'Query and assistance report', who: 'all' },
  { key: 'executive-activity', label: 'Executive activity', who: 'admin' },
];

export function canRun(user: AuthUser, key: string) {
  const r = REPORTS.find((x) => x.key === key);
  if (!r || !can(user, 'REPORT_VIEW')) return false;
  if (r.who === 'all') return true;
  if (r.who === 'staff') return isStaff(user);
  if (r.who === 'admin') return user.role === 'ADMIN' || (user.role === 'EXECUTIVE' && can(user, 'AUDIT_VIEW'));
  return isStaff(user) || user.role === 'DSA';
}

/**
 * Server-side reports (PART 49–50). Every query is limited to the caller's
 * data scope; exports reuse exactly the same rows.
 */
@Injectable()
export class ReportEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async run(user: AuthUser, key: string, f: ReportFilter): Promise<ReportResult> {
    if (!canRun(user, key)) throw forbidden('You cannot open this report');
    switch (key) {
      case 'cases':
        return this.cases(user, f);
      case 'dsa-performance':
        return this.performance(user, f, 'DSA');
      case 'team-performance':
        return this.performance(user, f, 'TEAM_PARTNER');
      case 'banks':
        return this.banks(user, f);
      case 'payouts':
        return this.payouts(user, f);
      case 'recovery':
        return this.recovery(user, f);
      case 'insurance':
        return this.insurance(user, f);
      case 'queries':
        return this.queries(user, f);
      default:
        return this.executiveActivity(f);
    }
  }

  private caseWhere(user: AuthUser, f: ReportFilter): Prisma.LoanCaseWhereInput {
    return {
      AND: [
        this.scope.caseWhere(user),
        f.from || f.to ? { createdAt: { gte: f.from, lte: f.to } } : {},
        f.bankId ? { bankId: f.bankId } : {},
        f.projectId ? { projectId: f.projectId } : {},
        f.dsaId ? { dsaId: f.dsaId } : {},
        f.teamPartnerId ? { teamPartnerId: f.teamPartnerId } : {},
        f.loanType ? { loanType: f.loanType } : {},
        f.status ? { status: { in: f.status.split(',') as CaseStatus[] } } : {},
      ],
    };
  }

  private caseSql(user: AuthUser, f: ReportFilter) {
    const c: Prisma.Sql[] = [Prisma.sql`c.deleted_at IS NULL`, this.scope.caseSql(user)];
    if (f.from) c.push(Prisma.sql`c.created_at >= ${f.from}`);
    if (f.to) c.push(Prisma.sql`c.created_at <= ${f.to}`);
    if (f.bankId) c.push(Prisma.sql`c.bank_id = ${f.bankId}::uuid`);
    if (f.projectId) c.push(Prisma.sql`c.project_id = ${f.projectId}::uuid`);
    if (f.dsaId) c.push(Prisma.sql`c.dsa_id = ${f.dsaId}::uuid`);
    if (f.teamPartnerId) c.push(Prisma.sql`c.team_partner_id = ${f.teamPartnerId}::uuid`);
    if (f.loanType) c.push(Prisma.sql`c.loan_type = ${f.loanType}`);
    if (f.status) c.push(Prisma.sql`c.status::text = ANY(${f.status.split(',')})`);
    return Prisma.join(c, ' AND ');
  }

  private async names(ids: (string | null | undefined)[]) {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    const users = uniq.length ? await this.prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true, dsaProfile: { select: { code: true } } } }) : [];
    return new Map(users.map((u) => [u.id, u]));
  }

  private async cases(user: AuthUser, f: ReportFilter): Promise<ReportResult> {
    const rows = await this.prisma.loanCase.findMany({
      where: this.caseWhere(user, f),
      select: {
        caseNo: true, loanType: true, status: true, appliedAmount: true, sanctionAmount: true, disbursedTotal: true, handoverAmount: true, loanAccountNo: true, createdAt: true, statusChangedAt: true, dsaId: true, teamPartnerId: true,
        customer: { select: { name: true } }, bank: { select: { name: true } }, project: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS + 1,
    });
    const people = await this.names(rows.flatMap((r) => [r.dsaId, r.teamPartnerId]));
    const out = rows.slice(0, MAX_ROWS).map((r) => ({
      caseNo: r.caseNo,
      customer: r.customer.name,
      loanType: r.loanType.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (x) => x.toUpperCase()),
      bank: r.bank.name,
      project: r.project?.name ?? '',
      dsa: people.get(r.dsaId)?.name ?? '',
      sourcedBy: r.teamPartnerId ? people.get(r.teamPartnerId)?.name ?? '' : 'Self (DSA)',
      status: CASE_STATUS_LABELS[r.status as CaseStatus],
      applied: n(r.appliedAmount),
      sanctioned: n(r.sanctionAmount),
      disbursed: n(r.disbursedTotal),
      handover: n(r.handoverAmount),
      loanAccount: r.loanAccountNo ?? '',
      loggedIn: r.createdAt,
      daysInStage: Math.floor((Date.now() - r.statusChangedAt.getTime()) / 86_400_000),
    }));
    return {
      title: 'Case report',
      columns: [
        { key: 'caseNo', label: 'Case ID' }, { key: 'customer', label: 'Customer' }, { key: 'loanType', label: 'Loan type' }, { key: 'bank', label: 'Bank' },
        { key: 'project', label: 'Project' }, { key: 'dsa', label: 'DSA' }, { key: 'sourcedBy', label: 'Sourced by' }, { key: 'status', label: 'Status' },
        { key: 'applied', label: 'Applied', type: 'money' }, { key: 'sanctioned', label: 'Sanctioned', type: 'money' }, { key: 'disbursed', label: 'Disbursed', type: 'money' },
        { key: 'handover', label: 'Handover', type: 'money' }, { key: 'loanAccount', label: 'Loan account' }, { key: 'loggedIn', label: 'Login date', type: 'date' }, { key: 'daysInStage', label: 'Days in stage', type: 'number' },
      ],
      rows: out,
      totals: { applied: sum(out, 'applied'), sanctioned: sum(out, 'sanctioned'), disbursed: sum(out, 'disbursed'), handover: sum(out, 'handover') },
      truncated: rows.length > MAX_ROWS,
    };
  }

  /** Per DSA team (DSA report) or per Team Partner (team report). */
  private async performance(user: AuthUser, f: ReportFilter, by: 'DSA' | 'TEAM_PARTNER'): Promise<ReportResult> {
    const who = by === 'DSA' ? Prisma.sql`c.dsa_id` : Prisma.sql`c.team_partner_id`;
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT ${who} AS uid,
             count(*)::int AS logins,
             count(*) FILTER (WHERE c.status IN ('SANCTION','DISBURSED','HANDOVER'))::int AS sanctioned,
             count(*) FILTER (WHERE c.status IN ('DISBURSED','HANDOVER'))::int AS disbursed,
             count(*) FILTER (WHERE c.status = 'HANDOVER')::int AS handovers,
             count(*) FILTER (WHERE c.status IN ('REJECT','WITHDRAW'))::int AS dropped,
             COALESCE(sum(c.applied_amount),0) AS applied, COALESCE(sum(c.disbursed_total),0) AS disbursed_amt, COALESCE(sum(c.handover_amount),0) AS handover_amt
      FROM loan_cases c
      WHERE ${this.caseSql(user, f)} AND ${who} IS NOT NULL
      GROUP BY ${who}
      ORDER BY logins DESC`;
    const payouts = await this.prisma.payout.groupBy({
      by: ['beneficiaryId'],
      where: { AND: [this.scope.payoutWhere(user), { beneficiaryId: { in: rows.map((r) => r.uid) } }, { loanCase: this.caseWhere(user, f) }] },
      _sum: { amount: true },
    });
    const people = await this.names(rows.map((r) => r.uid));
    const out = rows.map((r) => ({
      name: people.get(r.uid)?.name ?? '',
      code: people.get(r.uid)?.dsaProfile?.code ?? '',
      logins: r.logins,
      sanctioned: r.sanctioned,
      disbursed: r.disbursed,
      handovers: r.handovers,
      dropped: r.dropped,
      conversion: pct(r.handovers, r.logins),
      applied: n(r.applied),
      disbursedAmount: n(r.disbursed_amt),
      handoverAmount: n(r.handover_amt),
      payout: n(payouts.find((p) => p.beneficiaryId === r.uid)?._sum.amount),
    }));
    return {
      title: by === 'DSA' ? 'DSA performance (whole team)' : 'Team Partner performance',
      columns: [
        { key: 'name', label: by === 'DSA' ? 'DSA' : 'Team Partner' }, ...(by === 'DSA' ? [{ key: 'code', label: 'Code' }] : []),
        { key: 'logins', label: 'Logins', type: 'number' as const }, { key: 'sanctioned', label: 'Sanctioned', type: 'number' as const }, { key: 'disbursed', label: 'Disbursed', type: 'number' as const },
        { key: 'handovers', label: 'Handovers', type: 'number' as const }, { key: 'dropped', label: 'Rejected / withdrawn', type: 'number' as const }, { key: 'conversion', label: 'Login to handover', type: 'percent' as const },
        { key: 'applied', label: 'Loan amount', type: 'money' as const }, { key: 'disbursedAmount', label: 'Disbursed amount', type: 'money' as const }, { key: 'handoverAmount', label: 'Handover amount', type: 'money' as const },
        { key: 'payout', label: by === 'DSA' ? 'DSA own payout' : 'Payout', type: 'money' as const },
      ],
      rows: out,
      totals: { logins: sum(out, 'logins'), handovers: sum(out, 'handovers'), applied: sum(out, 'applied'), handoverAmount: sum(out, 'handoverAmount'), payout: sum(out, 'payout') },
    };
  }

  /** Per bank, with average days from login to sanction and to handover (turnaround). */
  private async banks(user: AuthUser, f: ReportFilter): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<any[]>`
      WITH c AS (SELECT c.* FROM loan_cases c WHERE ${this.caseSql(user, f)})
      SELECT b.name,
             count(c.id)::int AS logins,
             count(c.id) FILTER (WHERE c.status IN ('SANCTION','DISBURSED','HANDOVER'))::int AS sanctioned,
             count(c.id) FILTER (WHERE c.status = 'HANDOVER')::int AS handovers,
             count(c.id) FILTER (WHERE c.status = 'REJECT')::int AS rejected,
             COALESCE(sum(c.applied_amount),0) AS applied, COALESCE(sum(c.sanction_amount),0) AS sanctioned_amt,
             COALESCE(sum(c.disbursed_total),0) AS disbursed_amt, COALESCE(sum(c.handover_amount),0) AS handover_amt,
             round(avg(EXTRACT(EPOCH FROM (c.sanction_date - c.created_at)) / 86400)::numeric, 1) AS days_to_sanction,
             round(avg(EXTRACT(EPOCH FROM (c.handover_date - c.created_at)) / 86400)::numeric, 1) AS days_to_handover
      FROM c JOIN banks b ON b.id = c.bank_id
      GROUP BY b.name
      ORDER BY logins DESC`;
    const out = rows.map((r) => ({
      bank: r.name, logins: r.logins, sanctioned: r.sanctioned, handovers: r.handovers, rejected: r.rejected, conversion: pct(r.handovers, r.logins),
      applied: n(r.applied), sanctionedAmount: n(r.sanctioned_amt), disbursedAmount: n(r.disbursed_amt), handoverAmount: n(r.handover_amt),
      daysToSanction: r.days_to_sanction === null ? '' : Number(r.days_to_sanction), daysToHandover: r.days_to_handover === null ? '' : Number(r.days_to_handover),
    }));
    return {
      title: 'Bank report',
      columns: [
        { key: 'bank', label: 'Bank' }, { key: 'logins', label: 'Logins', type: 'number' }, { key: 'sanctioned', label: 'Sanctioned', type: 'number' }, { key: 'handovers', label: 'Handovers', type: 'number' },
        { key: 'rejected', label: 'Rejected', type: 'number' }, { key: 'conversion', label: 'Login to handover', type: 'percent' }, { key: 'applied', label: 'Loan amount', type: 'money' },
        { key: 'sanctionedAmount', label: 'Sanctioned amount', type: 'money' }, { key: 'disbursedAmount', label: 'Disbursed amount', type: 'money' }, { key: 'handoverAmount', label: 'Handover amount', type: 'money' },
        { key: 'daysToSanction', label: 'Avg days to sanction', type: 'number' }, { key: 'daysToHandover', label: 'Avg days to handover', type: 'number' },
      ],
      rows: out,
      totals: { logins: sum(out, 'logins'), handovers: sum(out, 'handovers'), applied: sum(out, 'applied'), handoverAmount: sum(out, 'handoverAmount') },
    };
  }

  private async payouts(user: AuthUser, f: ReportFilter): Promise<ReportResult> {
    const { from, to, status, ...caseF } = f;
    const rows = await this.prisma.payout.findMany({
      where: {
        AND: [
          this.scope.payoutWhere(user),
          { loanCase: this.caseWhere(user, { ...caseF }) },
          from || to ? { createdAt: { gte: from, lte: to } } : {},
          status ? { status: { in: status.split(',') as any } } : {},
        ],
      },
      include: { loanCase: { select: { caseNo: true, loanAccountNo: true, customer: { select: { name: true } }, bank: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });
    const people = await this.names(rows.map((r) => r.beneficiaryId));
    const out = rows.map((r) => ({
      caseNo: r.loanCase.caseNo, customer: r.loanCase.customer.name, bank: r.loanCase.bank.name, loanAccount: r.loanCase.loanAccountNo ?? '',
      partner: people.get(r.beneficiaryId)?.name ?? '', role: ROLE_LABELS[r.beneficiaryRole as Role], handover: n(r.baseAmount), percent: n(r.percentSnapshot), amount: n(r.amount),
      status: PAYOUT_STATUS_LABELS[r.status as keyof typeof PAYOUT_STATUS_LABELS], receivedFromBank: r.receivedFromBank ? 'Yes' : 'No', paidOn: r.paidOn, reference: r.paymentRef ?? '', createdAt: r.createdAt,
    }));
    return {
      title: 'Payout report',
      columns: [
        { key: 'caseNo', label: 'Case ID' }, { key: 'customer', label: 'Customer' }, { key: 'bank', label: 'Bank' }, { key: 'loanAccount', label: 'Loan account' },
        { key: 'partner', label: 'Partner' }, { key: 'role', label: 'Role' }, { key: 'handover', label: 'Handover amount', type: 'money' }, { key: 'percent', label: 'Payout %', type: 'percent' },
        { key: 'amount', label: 'Payout', type: 'money' }, { key: 'status', label: 'Status' }, { key: 'receivedFromBank', label: 'Received from bank' },
        { key: 'paidOn', label: 'Paid on', type: 'date' }, { key: 'reference', label: 'UTR' }, { key: 'createdAt', label: 'Created', type: 'date' },
      ],
      rows: out,
      totals: { amount: sum(out, 'amount'), handover: sum(out, 'handover') },
    };
  }

  private async recovery(user: AuthUser, f: ReportFilter): Promise<ReportResult> {
    const scope: Prisma.RecoveryWhereInput = isStaff(user) ? {} : user.role === 'DSA' ? { payout: { loanCase: { dsaId: user.id } } } : { beneficiaryId: user.id };
    const rows = await this.prisma.recovery.findMany({
      where: { AND: [scope, { payout: { loanCase: { deletedAt: null } } }, f.from || f.to ? { recoveryDate: { gte: f.from, lte: f.to } } : {}, f.bankId ? { payout: { loanCase: { bankId: f.bankId } } } : {}, f.dsaId ? { payout: { loanCase: { dsaId: f.dsaId } } } : {}] },
      include: { payout: { include: { loanCase: { select: { caseNo: true, customer: { select: { name: true } }, bank: { select: { name: true } } } } } } },
      orderBy: { recoveryDate: 'desc' },
      take: MAX_ROWS,
    });
    const people = await this.names(rows.map((r) => r.beneficiaryId));
    const out = rows.map((r) => {
      const demanded = r.amountDemanded === null ? null : n(r.amountDemanded);
      return {
        caseNo: r.payout.loanCase.caseNo, customer: r.payout.loanCase.customer.name, bank: r.payout.loanCase.bank.name, partner: people.get(r.beneficiaryId)?.name ?? '',
        originalPayout: n(r.payout.amount), recovered: n(r.recoveryAmount), demanded: demanded ?? 0, received: n(r.amountReceived), outstanding: demanded === null ? 0 : Math.round((demanded - n(r.amountReceived)) * 100) / 100,
        status: RECOVERY_STATUS_LABELS[r.status as keyof typeof RECOVERY_STATUS_LABELS], recoveryDate: r.recoveryDate, dueDate: r.dueDate, reason: r.reason,
      };
    });
    return {
      title: 'Recovery report',
      columns: [
        { key: 'caseNo', label: 'Case ID' }, { key: 'customer', label: 'Customer' }, { key: 'bank', label: 'Bank' }, { key: 'partner', label: 'Partner' },
        { key: 'originalPayout', label: 'Original payout', type: 'money' }, { key: 'recovered', label: 'Bank recovered', type: 'money' }, { key: 'demanded', label: 'Demanded', type: 'money' },
        { key: 'received', label: 'Received', type: 'money' }, { key: 'outstanding', label: 'Outstanding', type: 'money' }, { key: 'status', label: 'Status' },
        { key: 'recoveryDate', label: 'Recovery date', type: 'date' }, { key: 'dueDate', label: 'Due date', type: 'date' }, { key: 'reason', label: 'Reason' },
      ],
      rows: out,
      totals: { recovered: sum(out, 'recovered'), demanded: sum(out, 'demanded'), received: sum(out, 'received'), outstanding: sum(out, 'outstanding') },
    };
  }

  private async insurance(user: AuthUser, f: ReportFilter): Promise<ReportResult> {
    const rows = await this.prisma.insurancePolicy.findMany({
      where: { deletedAt: null, loanCase: { AND: [{ deletedAt: null }, f.bankId ? { bankId: f.bankId } : {}, f.dsaId ? { dsaId: f.dsaId } : {}] }, ...(f.from || f.to ? { createdAt: { gte: f.from, lte: f.to } } : {}) },
      include: { payout: true, loanCase: { select: { caseNo: true, dsaId: true, customer: { select: { name: true } }, bank: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });
    const people = await this.names(rows.map((r) => r.loanCase.dsaId));
    const out = rows.map((r) => ({
      caseNo: r.loanCase.caseNo, customer: r.loanCase.customer.name, bank: r.loanCase.bank.name, dsa: people.get(r.loanCase.dsaId)?.name ?? '', company: r.companyName, product: r.productName ?? '',
      policyNo: r.policyNumber ?? '', cover: n(r.insuranceAmount), premium: n(r.premiumAmount), commission: n(r.payout?.amount), status: r.payout ? INSURANCE_PAYOUT_LABELS[r.payout.status as keyof typeof INSURANCE_PAYOUT_LABELS] : '', receivedOn: r.payout?.receivedOn ?? null, createdAt: r.createdAt,
    }));
    return {
      title: 'Insurance report (Rupeemap commission)',
      columns: [
        { key: 'caseNo', label: 'Case ID' }, { key: 'customer', label: 'Customer' }, { key: 'bank', label: 'Bank' }, { key: 'dsa', label: 'DSA' }, { key: 'company', label: 'Insurer' },
        { key: 'product', label: 'Product' }, { key: 'policyNo', label: 'Policy no.' }, { key: 'cover', label: 'Cover', type: 'money' }, { key: 'premium', label: 'Premium', type: 'money' },
        { key: 'commission', label: 'Rupeemap payout', type: 'money' }, { key: 'status', label: 'Status' }, { key: 'receivedOn', label: 'Received on', type: 'date' }, { key: 'createdAt', label: 'Added', type: 'date' },
      ],
      rows: out,
      totals: { cover: sum(out, 'cover'), premium: sum(out, 'premium'), commission: sum(out, 'commission') },
    };
  }

  private async queries(user: AuthUser, f: ReportFilter): Promise<ReportResult> {
    const staff = isStaff(user) && (can(user, 'QUERY_ANSWER') || can(user, 'SUPPORT_HANDLE'));
    const scope: Prisma.TicketWhereInput = staff ? {} : user.role === 'DSA' ? { OR: [{ createdById: user.id }, { dsaId: user.id }] } : { createdById: user.id };
    const rows = await this.prisma.ticket.findMany({
      where: { AND: [scope, f.from || f.to ? { createdAt: { gte: f.from, lte: f.to } } : {}, f.status ? { status: { in: f.status.split(',') as any } } : {}] },
      include: { loanCase: { select: { caseNo: true } } },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });
    const people = await this.names(rows.flatMap((r) => [r.createdById, r.assignedToId]));
    const out = rows.map((r) => ({
      ticketNo: r.ticketNo, type: r.kind === 'QUERY' ? 'Query' : 'Assistance', category: r.category, subject: r.subject, caseNo: r.loanCase?.caseNo ?? '', raisedBy: people.get(r.createdById)?.name ?? '',
      assignedTo: r.assignedToId ? people.get(r.assignedToId)?.name ?? '' : '', priority: r.priority, status: TICKET_STATUS_LABELS[r.status as keyof typeof TICKET_STATUS_LABELS], createdAt: r.createdAt,
      hoursToResolve: r.resolvedAt ? Math.round(((r.resolvedAt.getTime() - r.createdAt.getTime()) / 3_600_000) * 10) / 10 : '',
    }));
    return {
      title: 'Query and assistance report',
      columns: [
        { key: 'ticketNo', label: 'ID' }, { key: 'type', label: 'Type' }, { key: 'category', label: 'Category' }, { key: 'subject', label: 'Subject' }, { key: 'caseNo', label: 'Case' },
        { key: 'raisedBy', label: 'Raised by' }, { key: 'assignedTo', label: 'Assigned to' }, { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' },
        { key: 'createdAt', label: 'Raised on', type: 'date' }, { key: 'hoursToResolve', label: 'Hours to resolve', type: 'number' },
      ],
      rows: out,
    };
  }

  /** What each Admin/Executive did in the period, from the audit log. */
  private async executiveActivity(f: ReportFilter): Promise<ReportResult> {
    const since = f.from ?? new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT u.name, u.role::text AS role,
             count(a.id) FILTER (WHERE a.action LIKE 'CASE_%')::int AS cases,
             count(a.id) FILTER (WHERE a.action LIKE 'PAYOUT_%')::int AS payouts,
             count(a.id) FILTER (WHERE a.action LIKE 'KYC_%')::int AS kyc,
             count(a.id) FILTER (WHERE a.action LIKE 'RECOVERY_%')::int AS recovery,
             count(a.id) FILTER (WHERE a.action LIKE 'TICKET_%' OR a.action LIKE 'QUERY_%' OR a.action LIKE 'ASSISTANCE_%')::int AS tickets,
             count(a.id) FILTER (WHERE a.action LIKE 'USER_%' OR a.action LIKE 'PERMISSIONS_%')::int AS users,
             count(a.id)::int AS total,
             max(a.at) FILTER (WHERE a.action = 'LOGIN') AS last_login
      FROM users u
      LEFT JOIN audit_logs a ON a.actor_id = u.id AND a.at >= ${since} ${f.to ? Prisma.sql`AND a.at <= ${f.to}` : Prisma.empty}
      WHERE u.role IN ('ADMIN','EXECUTIVE') AND u.deleted_at IS NULL
      GROUP BY u.id, u.name, u.role
      ORDER BY total DESC`;
    return {
      title: 'Executive activity',
      columns: [
        { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'cases', label: 'Case actions', type: 'number' }, { key: 'payouts', label: 'Payout actions', type: 'number' },
        { key: 'kyc', label: 'KYC actions', type: 'number' }, { key: 'recovery', label: 'Recovery actions', type: 'number' }, { key: 'tickets', label: 'Query / assistance', type: 'number' },
        { key: 'users', label: 'User actions', type: 'number' }, { key: 'total', label: 'All actions', type: 'number' }, { key: 'lastLogin', label: 'Last sign-in', type: 'date' },
      ],
      rows: rows.map((r) => ({ ...r, role: ROLE_LABELS[r.role as Role], lastLogin: r.last_login, last_login: undefined })),
    };
  }
}

function sum(rows: Record<string, unknown>[], key: string) {
  return Math.round(rows.reduce((a, r) => a + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0) * 100) / 100;
}
