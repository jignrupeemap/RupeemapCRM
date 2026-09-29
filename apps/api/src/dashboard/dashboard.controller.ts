import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { STUCK_CASE_DAYS, STUCK_CASE_STATUSES } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { ScopeService } from '../common/scope.service';
import { InsuranceService } from '../insurance/insurance.service';
import { RecoveryService } from '../recovery/recovery.service';
import { parse } from '../common/validate';
import { can, CurrentUser, RequirePermission, type AuthUser } from '../common/auth-context';
import { forbidden } from '../common/errors';

const filterSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  bankId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  dsaId: z.string().uuid().optional(),
  loanType: z.string().max(40).optional(),
});

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly insurance: InsuranceService,
    private readonly recovery: RecoveryService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const f = parse(filterSchema, query);
    // Always computed live (no cache), so a case or payout saved a moment ago shows at once.
    // Same rules as the rest of the CRM: cases are dated by when they were logged,
    // payouts by when they were created (as on the Payout page and the Users list).
    const caseFilters: Prisma.LoanCaseWhereInput[] = [
      this.scope.caseWhere(user),
      f.bankId ? { bankId: f.bankId } : {},
      f.projectId ? { projectId: f.projectId } : {},
      f.dsaId ? { dsaId: f.dsaId } : {},
      f.loanType ? { loanType: f.loanType } : {},
    ];
    const period = f.from || f.to ? { createdAt: { gte: f.from, lte: f.to } } : {};
    const caseWhere: Prisma.LoanCaseWhereInput = { AND: [...caseFilters, period] };
    const payoutWhere: Prisma.PayoutWhereInput = { AND: [this.scope.payoutWhere(user), { loanCase: { AND: caseFilters } }, period] };

    const [byStatus, amounts, payouts, bankReceived, stuck, byProject, recent, users] = await Promise.all([
      this.prisma.loanCase.groupBy({ by: ['status'], where: caseWhere, _count: true, _sum: { appliedAmount: true } }),
      this.prisma.loanCase.aggregate({ where: caseWhere, _sum: { sanctionAmount: true, disbursedTotal: true, handoverAmount: true } }),
      this.prisma.payout.groupBy({ by: ['status'], where: payoutWhere, _count: true, _sum: { amount: true } }),
      this.prisma.payout.aggregate({ where: { AND: [payoutWhere, { receivedFromBank: true }] }, _sum: { bankReceivedAmount: true }, _count: true }),
      this.prisma.loanCase.count({
        where: { AND: [caseWhere, { status: { in: [...STUCK_CASE_STATUSES] } }, { statusChangedAt: { lt: new Date(Date.now() - STUCK_CASE_DAYS * 86_400_000) } }] },
      }),
      this.prisma.loanCase.groupBy({
        by: ['projectId'],
        where: { AND: [caseWhere, { projectId: { not: null } }] },
        _count: true,
        _sum: { appliedAmount: true, disbursedTotal: true, handoverAmount: true },
        orderBy: { _count: { projectId: 'desc' } },
        take: 50,
      }),
      this.prisma.loanCase.findMany({
        where: caseWhere,
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, caseNo: true, status: true, loanType: true, appliedAmount: true, createdAt: true, customer: { select: { name: true } }, bank: { select: { name: true } } },
      }),
      can(user, 'USER_VIEW') && (user.role === 'ADMIN' || user.role === 'EXECUTIVE')
        ? this.prisma.user.groupBy({ by: ['role', 'status'], where: { deletedAt: null }, _count: true })
        : Promise.resolve([]),
    ]);

    const projectNames = await this.prisma.project.findMany({ where: { id: { in: byProject.map((p) => p.projectId!) } }, select: { id: true, name: true, city: true } });
    const projectRows = byProject.map((p) => ({
      projectId: p.projectId,
      name: projectNames.find((x) => x.id === p.projectId)?.name ?? '—',
      city: projectNames.find((x) => x.id === p.projectId)?.city ?? '',
      cases: p._count,
      appliedAmount: Number(p._sum.appliedAmount ?? 0),
      disbursedAmount: Number(p._sum.disbursedTotal ?? 0),
      handoverAmount: Number(p._sum.handoverAmount ?? 0),
    }));

    const trend = await this.trend(caseWhere);
    // Insurance commission is Rupeemap's alone: staff dashboards only, never in partner payout totals.
    const insurance = await this.insurance.summary(user, { from: f.from, to: f.to });
    const recovery = can(user, 'RECOVERY_VIEW') ? await this.recovery.outstanding(user) : null;

    const counts: Record<string, number> = { LOGIN: 0, SANCTION: 0, DISBURSED: 0, HANDOVER: 0, QUERY: 0, REJECT: 0, WITHDRAW: 0 };
    for (const s of byStatus) counts[s.status] = s._count;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const payoutByStatus: Record<string, { count: number; amount: number }> = {
      PENDING: { count: 0, amount: 0 },
      CONFIRMED: { count: 0, amount: 0 },
      PAID: { count: 0, amount: 0 },
      HOLD: { count: 0, amount: 0 },
    };
    for (const p of payouts) payoutByStatus[p.status] = { count: p._count, amount: Number(p._sum.amount ?? 0) };

    const result = {
      cases: { total, ...counts },
      // Cases that reached each stage (whatever stage they are in now), the same way the reports count.
      reached: {
        sanction: counts.SANCTION + counts.DISBURSED + counts.HANDOVER,
        disbursed: counts.DISBURSED + counts.HANDOVER,
        handover: counts.HANDOVER,
      },
      amounts: {
        applied: byStatus.reduce((a, s) => a + Number(s._sum.appliedAmount ?? 0), 0),
        sanctioned: Number(amounts._sum.sanctionAmount ?? 0),
        disbursed: Number(amounts._sum.disbursedTotal ?? 0),
        handover: Number(amounts._sum.handoverAmount ?? 0),
      },
      // Everything that ever reached a stage counts toward that stage's conversion.
      conversion: {
        sanction: pct(counts.SANCTION + counts.DISBURSED + counts.HANDOVER, total),
        disbursed: pct(counts.DISBURSED + counts.HANDOVER, total),
        handover: pct(counts.HANDOVER, total),
      },
      payouts: payoutByStatus,
      bankReceived: { count: bankReceived._count, amount: Number(bankReceived._sum.bankReceivedAmount ?? 0) },
      stuckCases: stuck,
      projects: projectRows,
      recent,
      trend,
      users: (users as any[]).map((u) => ({ role: u.role, status: u.status, count: u._count })),
      insurance,
      recovery,
    };
    return result;
  }

  /**
   * Admin / Admin Executive: every DSA Partner with their whole team (their own cases and
   * their Team Partners' cases) and all payouts on those cases, split DSA vs Team Partner.
   * Uses exactly the same rules as the summary, so the Total row always equals the dashboard.
   */
  @Get('partners')
  @RequirePermission('CASE_VIEW_ALL')
  async partners(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    if (user.role !== 'ADMIN' && user.role !== 'EXECUTIVE') throw forbidden();
    const f = parse(filterSchema, query);
    const caseCond = [
      Prisma.sql`c.deleted_at IS NULL`,
      f.bankId ? Prisma.sql`c.bank_id = ${f.bankId}::uuid` : Prisma.sql`TRUE`,
      f.projectId ? Prisma.sql`c.project_id = ${f.projectId}::uuid` : Prisma.sql`TRUE`,
      f.dsaId ? Prisma.sql`c.dsa_id = ${f.dsaId}::uuid` : Prisma.sql`TRUE`,
      f.loanType ? Prisma.sql`c.loan_type = ${f.loanType}` : Prisma.sql`TRUE`,
    ];
    const period = (col: Prisma.Sql) =>
      Prisma.join([f.from ? Prisma.sql`${col} >= ${f.from}` : Prisma.sql`TRUE`, f.to ? Prisma.sql`${col} <= ${f.to}` : Prisma.sql`TRUE`], ' AND ');
    const cw = Prisma.join(caseCond, ' AND ');

    type CaseRow = { dsa_id: string; total: number; own: number; team: number; login: number; sanction: number; disbursed: number; handover: number; query: number; reject: number; withdraw: number; applied: number; disbursed_amt: number; handover_amt: number };
    type PayRow = { dsa_id: string; dsa_amt: number; tp_amt: number; pending: number; confirmed: number; paid: number; hold: number; lines: number };
    const [caseRows, payRows, dsas, teams] = await Promise.all([
      this.prisma.$queryRaw<CaseRow[]>`
        SELECT c.dsa_id::text AS dsa_id, COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE c.team_partner_id IS NULL)::int AS own,
          COUNT(*) FILTER (WHERE c.team_partner_id IS NOT NULL)::int AS team,
          COUNT(*) FILTER (WHERE c.status = 'LOGIN')::int AS login, COUNT(*) FILTER (WHERE c.status = 'SANCTION')::int AS sanction,
          COUNT(*) FILTER (WHERE c.status = 'DISBURSED')::int AS disbursed, COUNT(*) FILTER (WHERE c.status = 'HANDOVER')::int AS handover,
          COUNT(*) FILTER (WHERE c.status = 'QUERY')::int AS query, COUNT(*) FILTER (WHERE c.status = 'REJECT')::int AS reject,
          COUNT(*) FILTER (WHERE c.status = 'WITHDRAW')::int AS withdraw,
          COALESCE(SUM(c.applied_amount), 0)::float AS applied, COALESCE(SUM(c.disbursed_total), 0)::float AS disbursed_amt,
          COALESCE(SUM(c.handover_amount), 0)::float AS handover_amt
        FROM loan_cases c WHERE ${cw} AND ${period(Prisma.sql`c.created_at`)} GROUP BY c.dsa_id`,
      this.prisma.$queryRaw<PayRow[]>`
        SELECT c.dsa_id::text AS dsa_id,
          COALESCE(SUM(p.amount) FILTER (WHERE p.beneficiary_role = 'DSA'), 0)::float AS dsa_amt,
          COALESCE(SUM(p.amount) FILTER (WHERE p.beneficiary_role = 'TEAM_PARTNER'), 0)::float AS tp_amt,
          COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'PENDING'), 0)::float AS pending,
          COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'CONFIRMED'), 0)::float AS confirmed,
          COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'PAID'), 0)::float AS paid,
          COALESCE(SUM(p.amount) FILTER (WHERE p.status = 'HOLD'), 0)::float AS hold,
          COUNT(*)::int AS lines
        FROM payouts p JOIN loan_cases c ON c.id = p.case_id
        WHERE ${cw} AND ${period(Prisma.sql`p.created_at`)} GROUP BY c.dsa_id`,
      this.prisma.user.findMany({ where: { role: 'DSA' }, select: { id: true, name: true, mobile: true, status: true, deletedAt: true, dsaProfile: { select: { code: true, id: true } } } }),
      this.prisma.teamMembership.groupBy({ by: ['dsaId'], where: { endedOn: null, user: { deletedAt: null } }, _count: true }),
    ]);
    const cases = new Map(caseRows.map((r) => [r.dsa_id, r]));
    const pays = new Map(payRows.map((r) => [r.dsa_id, r]));
    const teamSize = new Map(teams.map((t) => [t.dsaId, t._count]));
    const ids = new Set<string>([...dsas.filter((d) => !d.deletedAt).map((d) => d.id), ...cases.keys(), ...pays.keys()]);
    const zero = { total: 0, own: 0, team: 0, login: 0, sanction: 0, disbursed: 0, handover: 0, query: 0, reject: 0, withdraw: 0, applied: 0, disbursed_amt: 0, handover_amt: 0 };
    const zeroPay = { dsa_amt: 0, tp_amt: 0, pending: 0, confirmed: 0, paid: 0, hold: 0, lines: 0 };
    const rows = [...ids].map((id) => {
      const d = dsas.find((x) => x.id === id);
      const c = cases.get(id) ?? { ...zero, dsa_id: id };
      const pr = pays.get(id) ?? { ...zeroPay, dsa_id: id };
      return {
        dsaId: id,
        name: d?.name ?? 'Unknown partner',
        code: d?.dsaProfile?.code ?? null,
        mobile: d?.mobile ?? null,
        status: d?.deletedAt ? 'DELETED' : (d?.status ?? null),
        teamSize: d?.dsaProfile ? (teamSize.get(d.dsaProfile.id) ?? 0) : 0,
        cases: { total: c.total, own: c.own, team: c.team, LOGIN: c.login, SANCTION: c.sanction, DISBURSED: c.disbursed, HANDOVER: c.handover, QUERY: c.query, REJECT: c.reject, WITHDRAW: c.withdraw },
        reached: { sanction: c.sanction + c.disbursed + c.handover, disbursed: c.disbursed + c.handover, handover: c.handover },
        amounts: { applied: c.applied, disbursed: c.disbursed_amt, handover: c.handover_amt },
        payouts: { dsa: pr.dsa_amt, teamPartners: pr.tp_amt, total: pr.dsa_amt + pr.tp_amt, pending: pr.pending, confirmed: pr.confirmed, paid: pr.paid, hold: pr.hold, lines: pr.lines },
      };
    });
    rows.sort((a, b) => b.cases.total - a.cases.total || b.payouts.total - a.payouts.total || a.name.localeCompare(b.name));
    const sum = <T extends Record<string, number>>(pick: (r: (typeof rows)[number]) => T) =>
      rows.reduce((acc, r) => {
        const v = pick(r);
        for (const k of Object.keys(v)) (acc as any)[k] = ((acc as any)[k] ?? 0) + v[k];
        return acc;
      }, {} as T);
    return {
      rows,
      totals: {
        partners: rows.length,
        teamSize: rows.reduce((a, r) => a + r.teamSize, 0),
        cases: sum((r) => r.cases),
        reached: sum((r) => r.reached),
        amounts: sum((r) => r.amounts),
        payouts: sum((r) => r.payouts),
      },
    };
  }

  /** Logins and handover amount per month for the last 6 months. */
  private async trend(where: Prisma.LoanCaseWhereInput) {
    // Months follow Indian time: a case logged at 1 am IST on the 1st belongs to the new month.
    const IST = 330 * 60_000;
    const nowIst = new Date(Date.now() + IST);
    const since = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth() - 5, 1) - IST);
    const rows = await this.prisma.loanCase.findMany({
      where: { AND: [where, { createdAt: { gte: since } }] },
      select: { createdAt: true, status: true, handoverAmount: true },
    });
    const months: { month: string; logins: number; handovers: number; handoverAmount: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth() - 5 + i, 1));
      months.push({ month: d.toISOString().slice(0, 7), logins: 0, handovers: 0, handoverAmount: 0 });
    }
    for (const r of rows) {
      const m = months.find((x) => x.month === new Date(r.createdAt.getTime() + IST).toISOString().slice(0, 7));
      if (!m) continue;
      m.logins++;
      if (r.status === 'HANDOVER') {
        m.handovers++;
        m.handoverAmount += Number(r.handoverAmount ?? 0);
      }
    }
    return months;
  }
}

function pct(n: number, d: number) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}
