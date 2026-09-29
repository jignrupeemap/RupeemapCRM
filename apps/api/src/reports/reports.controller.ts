import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { ScopeService } from '../common/scope.service';
import { parse } from '../common/validate';
import { can, CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';
import { AuditService } from '../common/audit.service';
import { RedisService } from '../common/redis.service';
import { REPORTS, ReportEngine, canRun, reportFilterSchema } from './report-engine.service';
import { toCsv, toXlsx } from './export';
import { forbidden, notFound } from '../common/errors';

const SCREEN_ROWS = 500;

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

const topSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  by: z.enum(['logins', 'handover', 'disbursed']).default('logins'),
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
    private readonly engine: ReportEngine,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  /** Reports this person may open. */
  @Get()
  @RequirePermission('REPORT_VIEW')
  available(@CurrentUser() user: AuthUser) {
    return REPORTS.filter((r) => canRun(user, r.key)).map((r) => ({ key: r.key, label: r.label, canExport: can(user, 'REPORT_EXPORT') }));
  }

  @Get('run/:key')
  @RequirePermission('REPORT_VIEW')
  async run(@CurrentUser() user: AuthUser, @Param('key') key: string, @Query() q: unknown) {
    const r = await this.engine.run(user, key, parse(reportFilterSchema, q), SCREEN_ROWS);
    // The screen shows the first 500 rows; exports carry them all. Totals always cover every row.
    return { ...r, rowCount: r.rowCount ?? r.rows.length, rows: r.rows.slice(0, SCREEN_ROWS) };
  }

  /** CSV or Excel of exactly what the report shows, limited to the caller's scope. Every export is audited. */
  @Get('run/:key/export')
  @RequirePermission('REPORT_EXPORT')
  async export(@CurrentUser() user: AuthUser, @Param('key') key: string, @Query() q: Record<string, string>, @Meta() meta: RequestMeta, @Res() res: Response) {
    await this.redis.limit(`export:${user.id}`, 30, 3600, 'Too many exports in a short time. Please try again later.');
    const format = q.format === 'csv' ? 'csv' : 'xlsx';
    const filters = parse(reportFilterSchema, q);
    const r = await this.engine.run(user, key, filters);
    const body = format === 'csv' ? toCsv(r) : toXlsx(r);
    await this.prisma.$transaction((tx) => this.audit.log(tx, user, { action: 'REPORT_EXPORTED', entity: 'report', entityId: key, after: { format, rows: r.rows.length, filters } }, meta));
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="rupeemap-${key}-${stamp}.${format}"`,
      'Cache-Control': 'private, no-store',
    });
    res.end(body);
  }

  /**
   * Admin only (Rupeemap's request): the top 5 partners who sourced cases in one
   * project, and the top 5 DSA teams, for any period. Ranked by logins, then handover.
   */
  @Get('projects/:id/top-performers')
  async topPerformers(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown) {
    if (user.role !== 'ADMIN') throw forbidden('Only Admin can see top performers by project');
    const f = parse(topSchema, query);
    const project = await this.prisma.project.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true, city: true } });
    if (!project) throw notFound('Project');
    const conds: Prisma.Sql[] = [Prisma.sql`c.deleted_at IS NULL`, Prisma.sql`c.project_id = ${id}::uuid`];
    if (f.from) conds.push(Prisma.sql`c.created_at >= ${f.from}`);
    if (f.to) conds.push(Prisma.sql`c.created_at <= ${f.to}`);
    const where = Prisma.join(conds, ' AND ');
    const order = f.by === 'handover' ? Prisma.sql`handover_amount DESC, logins DESC` : f.by === 'disbursed' ? Prisma.sql`disbursed_amount DESC, logins DESC` : Prisma.sql`logins DESC, handover_amount DESC`;
    const metrics = Prisma.sql`
      count(*)::int AS logins,
      count(*) FILTER (WHERE c.status IN ('SANCTION', 'DISBURSED', 'HANDOVER'))::int AS sanctioned,
      count(*) FILTER (WHERE c.status = 'HANDOVER')::int AS handovers,
      COALESCE(sum(c.applied_amount), 0) AS applied_amount,
      COALESCE(sum(c.disbursed_total), 0) AS disbursed_amount,
      COALESCE(sum(c.handover_amount), 0) AS handover_amount`;
    // The person who sourced each case: the Team Partner if any, otherwise the DSA.
    const partners = await this.prisma.$queryRaw<any[]>`
      SELECT u.id, u.name, u.role::text AS role, d.code AS dsa_code, du.name AS dsa_name, ${metrics}
      FROM loan_cases c
      JOIN users u ON u.id = COALESCE(c.team_partner_id, c.dsa_id)
      JOIN users du ON du.id = c.dsa_id
      LEFT JOIN dsa_partners d ON d.user_id = c.dsa_id
      WHERE ${where}
      GROUP BY u.id, u.name, u.role, d.code, du.name
      ORDER BY ${order}
      LIMIT 5`;
    const teams = await this.prisma.$queryRaw<any[]>`
      SELECT du.id, du.name, d.code AS dsa_code, count(DISTINCT c.team_partner_id)::int AS team_partners, ${metrics}
      FROM loan_cases c
      JOIN users du ON du.id = c.dsa_id
      LEFT JOIN dsa_partners d ON d.user_id = c.dsa_id
      WHERE ${where}
      GROUP BY du.id, du.name, d.code
      ORDER BY ${order}
      LIMIT 5`;
    const shape = (r: any) => ({
      id: r.id as string,
      name: r.name as string,
      role: (r.role ?? 'DSA') as string,
      dsaCode: r.dsa_code as string | null,
      dsaName: (r.dsa_name ?? null) as string | null,
      teamPartners: r.team_partners as number | undefined,
      logins: r.logins as number,
      sanctioned: r.sanctioned as number,
      handovers: r.handovers as number,
      appliedAmount: Number(r.applied_amount),
      disbursedAmount: Number(r.disbursed_amount),
      handoverAmount: Number(r.handover_amount),
    });
    return { project, by: f.by, partners: partners.map(shape), teams: teams.map(shape) };
  }

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
