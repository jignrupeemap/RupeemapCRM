import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { ScopeService } from '../common/scope.service';
import { RedisService } from '../common/redis.service';
import { InsuranceService } from '../insurance/insurance.service';
import { parse } from '../common/validate';
import { can, CurrentUser, type AuthUser } from '../common/auth-context';

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
    private readonly redis: RedisService,
    private readonly insurance: InsuranceService,
  ) {}

  @Get('summary')
  async summary(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const f = parse(filterSchema, query);
    // Cache key includes the user's scope so nobody sees another scope's numbers.
    const key = `kpi:${user.role}:${user.role === 'ADMIN' || user.role === 'EXECUTIVE' ? 'all' : user.id}:${JSON.stringify(f)}`;
    const hit = await this.redis.getJson(key);
    if (hit) return hit;

    const caseWhere: Prisma.LoanCaseWhereInput = {
      AND: [
        this.scope.caseWhere(user),
        f.from || f.to ? { createdAt: { gte: f.from, lte: f.to } } : {},
        f.bankId ? { bankId: f.bankId } : {},
        f.projectId ? { projectId: f.projectId } : {},
        f.dsaId ? { dsaId: f.dsaId } : {},
        f.loanType ? { loanType: f.loanType } : {},
      ],
    };
    const payoutWhere: Prisma.PayoutWhereInput = { AND: [this.scope.payoutWhere(user), { loanCase: caseWhere }] };

    const [byStatus, amounts, payouts, bankReceived, stuck, byProject, recent, users] = await Promise.all([
      this.prisma.loanCase.groupBy({ by: ['status'], where: caseWhere, _count: true, _sum: { appliedAmount: true } }),
      this.prisma.loanCase.aggregate({ where: caseWhere, _sum: { sanctionAmount: true, disbursedTotal: true, handoverAmount: true } }),
      this.prisma.payout.groupBy({ by: ['status'], where: payoutWhere, _count: true, _sum: { amount: true } }),
      this.prisma.payout.aggregate({ where: { AND: [payoutWhere, { receivedFromBank: true }] }, _sum: { bankReceivedAmount: true }, _count: true }),
      this.prisma.loanCase.count({
        where: { AND: [caseWhere, { status: { in: ['LOGIN', 'SANCTION', 'DISBURSED', 'QUERY'] } }, { statusChangedAt: { lt: new Date(Date.now() - 15 * 86_400_000) } }] },
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
    };
    await this.redis.setJson(key, result, 60);
    return result;
  }

  /** Logins and handover amount per month for the last 6 months. */
  private async trend(where: Prisma.LoanCaseWhereInput) {
    const since = new Date();
    since.setMonth(since.getMonth() - 5, 1);
    since.setHours(0, 0, 0, 0);
    const rows = await this.prisma.loanCase.findMany({
      where: { AND: [where, { createdAt: { gte: since } }] },
      select: { createdAt: true, status: true, handoverAmount: true },
    });
    const months: { month: string; logins: number; handovers: number; handoverAmount: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const d = new Date(since);
      d.setMonth(since.getMonth() + i);
      months.push({ month: d.toISOString().slice(0, 7), logins: 0, handovers: 0, handoverAmount: 0 });
    }
    for (const r of rows) {
      const m = months.find((x) => x.month === r.createdAt.toISOString().slice(0, 7));
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
