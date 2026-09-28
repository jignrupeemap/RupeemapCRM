import { Controller, Get, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { ScopeService } from '../common/scope.service';
import { parse } from '../common/validate';
import { CurrentUser, RequirePermission, type AuthUser } from '../common/auth-context';

const SORTS = {
  logins: Prisma.sql`logins`,
  applied: Prisma.sql`applied_amount`,
  sanctioned: Prisma.sql`sanctioned_amount`,
  disbursed: Prisma.sql`disbursed_amount`,
  handover: Prisma.sql`handover_amount`,
  payout: Prisma.sql`payout_amount`,
} as const;

const projectReportSchema = z.object({
  sort: z.enum(Object.keys(SORTS) as [keyof typeof SORTS, ...(keyof typeof SORTS)[]]).default('logins'),
  dir: z.enum(['desc', 'asc']).default('desc'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  bankId: z.string().uuid().optional(),
  loanType: z.string().max(40).optional(),
  dsaId: z.string().uuid().optional(),
  teamPartnerId: z.string().uuid().optional(),
  city: z.string().trim().max(80).optional(),
  projectType: z.enum(['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL']).optional(),
});

/**
 * Server-side analytics. Every query is limited to the caller's data scope,
 * so a DSA's ranking only counts their team's cases.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  /** Project-wise logins, amounts and payout, sortable highest or lowest (PART 28, 98). */
  @Get('projects')
  @RequirePermission('REPORT_VIEW')
  async projects(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const f = parse(projectReportSchema, query);
    const caseConds: Prisma.Sql[] = [Prisma.sql`c.deleted_at IS NULL`, this.scope.caseSql(user)];
    if (f.from) caseConds.push(Prisma.sql`c.created_at >= ${f.from}`);
    if (f.to) caseConds.push(Prisma.sql`c.created_at <= ${f.to}`);
    if (f.bankId) caseConds.push(Prisma.sql`c.bank_id = ${f.bankId}::uuid`);
    if (f.loanType) caseConds.push(Prisma.sql`c.loan_type = ${f.loanType}`);
    if (f.dsaId) caseConds.push(Prisma.sql`c.dsa_id = ${f.dsaId}::uuid`);
    if (f.teamPartnerId) caseConds.push(Prisma.sql`c.team_partner_id = ${f.teamPartnerId}::uuid`);
    const caseWhere = Prisma.join(caseConds, ' AND ');

    const projConds: Prisma.Sql[] = [Prisma.sql`pr.deleted_at IS NULL`];
    if (f.city) projConds.push(Prisma.sql`pr.city ILIKE ${f.city}`);
    if (f.projectType) projConds.push(Prisma.sql`pr.project_type = ${f.projectType}::"ProjectType"`);

    const dir = f.dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const rows = await this.prisma.$queryRaw<any[]>`
      WITH c AS (
        SELECT c.id, c.project_id, c.dsa_id, c.status, c.applied_amount, c.sanction_amount, c.disbursed_total, c.handover_amount
        FROM loan_cases c WHERE ${caseWhere}
      ),
      pay AS (
        SELECT c.project_id, sum(p.amount) AS amount, count(*) AS n
        FROM payouts p JOIN c ON c.id = p.case_id
        WHERE ${this.scope.payoutSql(user)}
        GROUP BY c.project_id
      )
      SELECT pr.id, pr.name, pr.city, pr.locality, pr.project_type::text AS project_type, pr.active,
             count(c.id)::int AS logins,
             count(c.id) FILTER (WHERE c.status IN ('SANCTION', 'DISBURSED', 'HANDOVER'))::int AS sanctioned,
             count(c.id) FILTER (WHERE c.status IN ('DISBURSED', 'HANDOVER'))::int AS disbursed,
             count(c.id) FILTER (WHERE c.status = 'HANDOVER')::int AS handovers,
             count(c.id) FILTER (WHERE c.status IN ('REJECT', 'WITHDRAW'))::int AS dropped,
             COALESCE(sum(c.applied_amount), 0) AS applied_amount,
             COALESCE(sum(c.sanction_amount), 0) AS sanctioned_amount,
             COALESCE(sum(c.disbursed_total), 0) AS disbursed_amount,
             COALESCE(sum(c.handover_amount), 0) AS handover_amount,
             COALESCE(max(pay.amount), 0) AS payout_amount
      FROM projects pr
      LEFT JOIN c ON c.project_id = pr.id
      LEFT JOIN pay ON pay.project_id = pr.id
      WHERE ${Prisma.join(projConds, ' AND ')}
      GROUP BY pr.id
      HAVING pr.active OR count(c.id) > 0
      ORDER BY ${SORTS[f.sort]} ${dir}, pr.name ASC
      LIMIT 200`;

    const [unlinked] = await this.prisma.$queryRaw<{ n: number; amount: Prisma.Decimal | null }[]>`
      SELECT count(*)::int AS n, sum(c.applied_amount) AS amount FROM loan_cases c WHERE ${caseWhere} AND c.project_id IS NULL`;

    const items = rows.map((r) => ({
      projectId: r.id as string,
      name: r.name as string,
      city: r.city as string,
      locality: r.locality as string,
      projectType: r.project_type as string,
      active: r.active as boolean,
      logins: r.logins as number,
      sanctioned: r.sanctioned as number,
      disbursed: r.disbursed as number,
      handovers: r.handovers as number,
      dropped: r.dropped as number,
      appliedAmount: Number(r.applied_amount),
      sanctionedAmount: Number(r.sanctioned_amount),
      disbursedAmount: Number(r.disbursed_amount),
      handoverAmount: Number(r.handover_amount),
      payoutAmount: Number(r.payout_amount),
    }));
    const totals = items.reduce(
      (t, r) => ({
        projects: t.projects + (r.logins > 0 ? 1 : 0),
        logins: t.logins + r.logins,
        appliedAmount: t.appliedAmount + r.appliedAmount,
        disbursedAmount: t.disbursedAmount + r.disbursedAmount,
        handoverAmount: t.handoverAmount + r.handoverAmount,
        payoutAmount: t.payoutAmount + r.payoutAmount,
      }),
      { projects: 0, logins: 0, appliedAmount: 0, disbursedAmount: 0, handoverAmount: 0, payoutAmount: 0 },
    );
    return { items, totals, unlinked: { cases: unlinked?.n ?? 0, appliedAmount: Number(unlinked?.amount ?? 0) }, sort: f.sort, dir: f.dir };
  }
}
