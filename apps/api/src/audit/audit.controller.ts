import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService, auditHash } from '../common/audit.service';
import { RedisService } from '../common/redis.service';
import { parse } from '../common/validate';
import { Paged } from '../common/http';
import { notFound } from '../common/errors';
import { CurrentUser, Meta, RequirePermission, type AuthUser, type RequestMeta } from '../common/auth-context';
import { toCsv, toXlsx } from '../reports/export';

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
const filterSchema = z.object({
  from: z.preprocess(blank, z.coerce.date().optional()),
  to: z.preprocess(blank, z.coerce.date().optional()),
  actorId: z.preprocess(blank, z.string().uuid().optional()),
  action: z.preprocess(blank, z.string().max(60).regex(/^[A-Z_]+$/).optional()),
  entity: z.preprocess(blank, z.string().max(40).regex(/^[a-z_]+$/).optional()),
  entityId: z.preprocess(blank, z.string().max(80).optional()),
  ip: z.preprocess(blank, z.string().max(60).optional()),
  page: z.preprocess(blank, z.coerce.number().int().min(1).max(100000).default(1)),
  pageSize: z.preprocess(blank, z.coerce.number().int().min(1).max(100).default(50)),
});
type Filters = z.infer<typeof filterSchema>;

const EXPORT_MAX = 20000;
const istTime = (d: Date) =>
  d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

/**
 * Audit Log (PART 55): who did what, when, from where. Read-only: the table is
 * append-only in the database and every row is hash-chained to the one before it.
 */
@Controller('audit')
@RequirePermission('AUDIT_VIEW')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  private where(f: Filters): Prisma.AuditLogWhereInput {
    const to = f.to ? new Date(f.to.getTime() + (f.to.getUTCHours() === 0 && f.to.getUTCMinutes() === 0 ? 86_400_000 : 0)) : undefined;
    return {
      ...(f.from || to ? { at: { ...(f.from ? { gte: f.from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(f.actorId ? { actorId: f.actorId } : {}),
      ...(f.action ? { action: f.action } : {}),
      ...(f.entity ? { entity: f.entity } : {}),
      ...(f.entityId ? { entityId: f.entityId } : {}),
      ...(f.ip ? { ip: { startsWith: f.ip } } : {}),
    };
  }

  /** Names for actors and readable labels (case number, person) for the rows on screen. */
  private async decorate(rows: Awaited<ReturnType<PrismaService['auditLog']['findMany']>>) {
    const userIds = new Set<string>();
    const caseIds = new Set<string>();
    const uuid = /^[0-9a-f-]{36}$/i;
    for (const r of rows) {
      if (r.actorId) userIds.add(r.actorId);
      if (r.entity === 'user' && r.entityId && uuid.test(r.entityId)) userIds.add(r.entityId);
      if (r.entity === 'case' && r.entityId && uuid.test(r.entityId)) caseIds.add(r.entityId);
    }
    const [users, cases] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true, mobile: true } }),
      this.prisma.loanCase.findMany({ where: { id: { in: [...caseIds] } }, select: { id: true, caseNo: true, customer: { select: { name: true } } } }),
    ]);
    const u = new Map(users.map((x) => [x.id, x]));
    const c = new Map(cases.map((x) => [x.id, x]));
    return rows.map((r) => {
      const actor = r.actorId ? u.get(r.actorId) : undefined;
      let entityLabel: string | null = null;
      let link: string | null = null;
      if (r.entity === 'case' && r.entityId && c.has(r.entityId)) {
        const k = c.get(r.entityId)!;
        entityLabel = `${k.caseNo} · ${k.customer.name}`;
        link = `/cases/${r.entityId}`;
      } else if (r.entity === 'user' && r.entityId && u.has(r.entityId)) {
        entityLabel = u.get(r.entityId)!.name;
        link = `/users/${r.entityId}`;
      }
      return {
        id: r.id.toString(),
        at: r.at,
        actorId: r.actorId,
        actorName: actor?.name ?? (r.actorId ? 'Unknown user' : 'System'),
        actorMobile: actor?.mobile ?? null,
        actorRole: r.actorRole,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        entityLabel,
        link,
        before: r.before,
        after: r.after,
        ip: r.ip,
        requestId: r.requestId,
        hash: r.hash,
      };
    });
  }

  @Get()
  async list(@Query() q: Record<string, string>) {
    const f = parse(filterSchema, q);
    const where = this.where(f);
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
      this.prisma.auditLog.count({ where }),
    ]);
    return new Paged(await this.decorate(rows), { page: f.page, pageSize: f.pageSize, total });
  }

  /** Values for the filter menus. */
  @Get('facets')
  async facets() {
    const [actions, entities, actors] = await Promise.all([
      this.prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true }, orderBy: { action: 'asc' } }),
      this.prisma.auditLog.groupBy({ by: ['entity'], _count: { _all: true }, orderBy: { entity: 'asc' } }),
      this.prisma.$queryRaw<{ id: string; name: string; role: string; n: bigint }[]>`
        SELECT u.id, u.name, u.role::text AS role, COUNT(*) AS n
        FROM audit_logs a JOIN users u ON u.id = a.actor_id
        GROUP BY u.id, u.name, u.role ORDER BY u.name LIMIT 500`,
    ]);
    return {
      actions: actions.map((a) => ({ value: a.action, count: a._count._all })),
      entities: entities.map((e) => ({ value: e.entity, count: e._count._all })),
      actors: actors.map((a) => ({ id: a.id, name: a.name, role: a.role, count: Number(a.n) })),
    };
  }

  /**
   * Walks the whole chain: every row must point at the hash of the row before it,
   * and its own hash must match its contents. Rows written before hashes were
   * key-order independent can only be checked for their link.
   */
  @Get('verify')
  async verify() {
    await this.redis.limit('audit-verify', 20, 3600, 'The chain was checked many times recently. Please try again later.');
    const started = Date.now();
    let checked = 0;
    let contentVerified = 0;
    let linkOnly = 0;
    const broken: { id: string; at: Date; reason: string }[] = [];
    let prev: string | null = null;
    let first = true;
    let cursor: bigint | undefined;
    for (;;) {
      const batch = await this.prisma.auditLog.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: 2000 });
      if (!batch.length) break;
      for (const r of batch) {
        checked++;
        if (!first && r.prevHash !== prev) broken.push({ id: r.id.toString(), at: r.at, reason: 'Does not link to the entry before it (a row is missing or out of order)' });
        first = false;
        if (auditHash({ ...r, before: r.before, after: r.after }) === r.hash) contentVerified++;
        else linkOnly++;
        prev = r.hash;
      }
      cursor = batch[batch.length - 1].id;
    }
    return { ok: broken.length === 0, checked, contentVerified, linkOnly, broken: broken.slice(0, 50), ms: Date.now() - started, checkedAt: new Date() };
  }

  @Get('export')
  async export(@CurrentUser() user: AuthUser, @Query() q: Record<string, string>, @Meta() meta: RequestMeta, @Res() res: Response) {
    await this.redis.limit(`export:${user.id}`, 30, 3600, 'Too many exports in a short time. Please try again later.');
    const format = q.format === 'csv' ? 'csv' : 'xlsx';
    const f = parse(filterSchema, q);
    const rows = await this.decorate(await this.prisma.auditLog.findMany({ where: this.where(f), orderBy: { id: 'desc' }, take: EXPORT_MAX }));
    const result = {
      title: 'Audit log',
      columns: [
        { key: 'id', label: 'Entry' },
        { key: 'time', label: 'Time (IST)' },
        { key: 'actorName', label: 'By' },
        { key: 'actorRole', label: 'Role' },
        { key: 'action', label: 'Action' },
        { key: 'entity', label: 'Record type' },
        { key: 'record', label: 'Record' },
        { key: 'ip', label: 'IP address' },
        { key: 'changes', label: 'Changes' },
      ],
      rows: rows.map((r) => ({
        ...r,
        time: istTime(r.at),
        record: r.entityLabel ?? r.entityId ?? '',
        changes: [r.before && `before ${JSON.stringify(r.before)}`, r.after && `after ${JSON.stringify(r.after)}`].filter(Boolean).join(' | ').slice(0, 30000),
      })),
    };
    const body = format === 'csv' ? toCsv(result) : toXlsx(result);
    await this.prisma.$transaction((tx) =>
      this.audit.log(tx, user, { action: 'AUDIT_EXPORTED', entity: 'report', entityId: 'audit', after: { format, rows: rows.length, filters: { ...f, page: undefined, pageSize: undefined } } }, meta),
    );
    res.set({
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="rupeemap-audit-${new Date().toISOString().slice(0, 10)}.${format}"`,
      'Cache-Control': 'private, no-store',
    });
    res.end(body);
  }

  /** Full history of one record, oldest first (for a case or person timeline). */
  @Get('record/:entity/:entityId')
  async record(@Param('entity') entity: string, @Param('entityId') entityId: string) {
    if (!/^[a-z_]{1,40}$/.test(entity) || entityId.length > 80) throw notFound('Record');
    const rows = await this.prisma.auditLog.findMany({ where: { entity, entityId }, orderBy: { id: 'asc' }, take: 500 });
    return this.decorate(rows);
  }
}
