import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { INACTIVITY, ROLE_LABELS, type Role } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { NotifyService } from '../common/notify.service';
import { SmsService } from '../common/sms.service';
import { AppError, forbidden, notFound } from '../common/errors';
import { logger } from '../common/logger';
import type { AuthUser, RequestMeta } from '../common/auth-context';
import { AuthService } from '../auth/auth.service';

const JOB = 'partner-inactivity';
const CHECK_EVERY_MS = 60 * 60 * 1000;

export interface InactivePartnerRow {
  id: string;
  name: string;
  mobile: string;
  role: Role;
  status: string;
  dsaCode: string | null;
  dsaName: string | null;
  lastCaseAt: Date | null;
  lastPayoutAt: Date | null;
  lastLoginAt: Date | null;
  lastActivityAt: Date;
  daysInactive: number;
  totalCases: number;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  inactivityAlertedAt: Date | null;
}

/** Today's date in India, used as the once-a-day key for the job. */
function istDate(d = new Date()) {
  return new Date(new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10));
}

/**
 * Partner inactivity (requested by Rupeemap): DSA and Team Partners with no case
 * login and no payout for ALERT_DAYS are reported to Admin and Executives; at
 * DEACTIVATE_DAYS their code is deactivated automatically, and only Admin can
 * reactivate it.
 */
@Injectable()
export class InactivityService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly sms: SmsService,
    private readonly auth: AuthService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.INACTIVITY_JOB === 'off') return;
    const tick = () => this.runDaily().catch((err) => logger.error({ err }, 'inactivity job failed'));
    this.timer = setInterval(tick, CHECK_EVERY_MS);
    setTimeout(tick, 20_000).unref();
    this.timer.unref();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Days since each partner's last business. DSA activity includes their Team
   * Partners' cases, since those cases are logged under the DSA's code too.
   */
  private async rows(where: Prisma.Sql = Prisma.empty): Promise<InactivePartnerRow[]> {
    const rows = await this.prisma.$queryRaw<any[]>`
      WITH p AS (
        SELECT u.id, u.name, u.mobile, u.role::text AS role, u.status::text AS status, u.last_login_at, u.deactivated_at,
               u.deactivation_reason, u.inactivity_alerted_at,
               GREATEST(u.created_at, COALESCE(u.activated_at, u.created_at), COALESCE(u.reactivated_at, u.created_at)) AS since
        FROM users u
        WHERE u.role IN ('DSA', 'TEAM_PARTNER') AND u.deleted_at IS NULL AND u.status IN ('ACTIVE', 'DEACTIVATED')
      ),
      lc AS (
        SELECT x.uid, max(c.created_at) AS last_case, count(*) AS total_cases
        FROM loan_cases c
        JOIN LATERAL (VALUES (c.dsa_id), (c.team_partner_id)) AS x(uid) ON x.uid IS NOT NULL
        WHERE c.deleted_at IS NULL AND x.uid IN (SELECT id FROM p)
        GROUP BY x.uid
      ),
      lp AS (
        SELECT beneficiary_user_id AS uid, max(created_at) AS last_payout
        FROM payouts WHERE beneficiary_user_id IN (SELECT id FROM p)
        GROUP BY beneficiary_user_id
      ),
      r AS (
        SELECT p.*, lc.last_case, COALESCE(lc.total_cases, 0) AS total_cases, lp.last_payout,
               GREATEST(p.since, COALESCE(lc.last_case, p.since), COALESCE(lp.last_payout, p.since)) AS last_activity
        FROM p LEFT JOIN lc ON lc.uid = p.id LEFT JOIN lp ON lp.uid = p.id
      )
      SELECT r.*, FLOOR(EXTRACT(EPOCH FROM (now() - r.last_activity)) / 86400)::int AS days_inactive,
             d.code AS dsa_code, du.name AS dsa_name
      FROM r
      LEFT JOIN team_memberships m ON m.team_partner_user_id = r.id AND m.ended_on IS NULL
      LEFT JOIN dsa_partners d ON d.id = m.dsa_id OR (r.role = 'DSA' AND d.user_id = r.id)
      LEFT JOIN users du ON du.id = d.user_id AND r.role = 'TEAM_PARTNER'
      ${where}
      ORDER BY days_inactive DESC, r.name ASC`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      mobile: r.mobile,
      role: r.role,
      status: r.status,
      dsaCode: r.dsa_code,
      dsaName: r.dsa_name,
      lastCaseAt: r.last_case,
      lastPayoutAt: r.last_payout,
      lastLoginAt: r.last_login_at,
      lastActivityAt: r.last_activity,
      daysInactive: Number(r.days_inactive),
      totalCases: Number(r.total_cases),
      deactivatedAt: r.deactivated_at,
      deactivationReason: r.deactivation_reason,
      inactivityAlertedAt: r.inactivity_alerted_at,
    }));
  }

  /** Inactive Partners screen: filter by minimum days, role and name/mobile. */
  async report(q: { minDays?: string; maxDays?: string; role?: string; q?: string; status?: string }) {
    const min = Math.max(0, Number(q.minDays ?? INACTIVITY.WATCH_DAYS) || 0);
    const max = q.maxDays ? Number(q.maxDays) : null;
    const conds: Prisma.Sql[] = [];
    if (q.status === 'DEACTIVATED') conds.push(Prisma.sql`r.status = 'DEACTIVATED'`);
    else {
      conds.push(Prisma.sql`r.status = 'ACTIVE'`);
      conds.push(Prisma.sql`FLOOR(EXTRACT(EPOCH FROM (now() - r.last_activity)) / 86400) >= ${min}`);
      if (max !== null && Number.isFinite(max)) conds.push(Prisma.sql`FLOOR(EXTRACT(EPOCH FROM (now() - r.last_activity)) / 86400) < ${max}`);
    }
    if (q.role === 'DSA' || q.role === 'TEAM_PARTNER') conds.push(Prisma.sql`r.role = ${q.role}`);
    if (q.q?.trim()) {
      const like = `%${q.q.trim()}%`;
      conds.push(Prisma.sql`(r.name ILIKE ${like} OR r.mobile LIKE ${like})`);
    }
    const items = await this.rows(Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}`);
    return { items: items.slice(0, 500), summary: await this.summary(), rule: INACTIVITY };
  }

  /** Counts for the dashboard tile and the screen's tabs. */
  async summary() {
    const [r] = await this.prisma.$queryRaw<any[]>`
      WITH p AS (
        SELECT u.id, u.status,
               GREATEST(u.created_at, COALESCE(u.activated_at, u.created_at), COALESCE(u.reactivated_at, u.created_at)) AS since
        FROM users u WHERE u.role IN ('DSA', 'TEAM_PARTNER') AND u.deleted_at IS NULL AND u.status IN ('ACTIVE', 'DEACTIVATED')
      ),
      a AS (
        SELECT p.id, p.status, GREATEST(p.since,
          COALESCE((SELECT max(c.created_at) FROM loan_cases c WHERE c.deleted_at IS NULL AND (c.dsa_id = p.id OR c.team_partner_id = p.id)), p.since),
          COALESCE((SELECT max(y.created_at) FROM payouts y WHERE y.beneficiary_user_id = p.id), p.since)) AS last_activity
        FROM p
      )
      SELECT
        count(*) FILTER (WHERE status = 'ACTIVE' AND now() - last_activity >= make_interval(days => ${INACTIVITY.WATCH_DAYS}::int) AND now() - last_activity < make_interval(days => ${INACTIVITY.ALERT_DAYS}::int))::int AS watch,
        count(*) FILTER (WHERE status = 'ACTIVE' AND now() - last_activity >= make_interval(days => ${INACTIVITY.ALERT_DAYS}::int) AND now() - last_activity < make_interval(days => ${INACTIVITY.DEACTIVATE_DAYS}::int))::int AS alert,
        count(*) FILTER (WHERE status = 'ACTIVE' AND now() - last_activity >= make_interval(days => ${INACTIVITY.DEACTIVATE_DAYS}::int))::int AS due,
        count(*) FILTER (WHERE status = 'DEACTIVATED')::int AS deactivated
      FROM a`;
    return { watch: r.watch as number, alert: r.alert as number, due: r.due as number, deactivated: r.deactivated as number };
  }

  /** Runs the check at most once per day (IST), whichever API instance gets there first. */
  async runDaily() {
    const runDate = istDate();
    try {
      await this.prisma.jobRun.create({ data: { name: JOB, runDate } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // already ran today
      throw e;
    }
    const result = await this.check(null);
    await this.prisma.jobRun.update({ where: { name_runDate: { name: JOB, runDate } }, data: { finishedAt: new Date(), result } });
    logger.info({ result }, 'partner inactivity check finished');
    return result;
  }

  /** The actual check. `actor` is null for the scheduled run, or the Admin who pressed "Run check now". */
  async check(actor: AuthUser | null, meta: RequestMeta = {}) {
    const all = await this.rows(Prisma.sql`WHERE r.status = 'ACTIVE' AND FLOOR(EXTRACT(EPOCH FROM (now() - r.last_activity)) / 86400) >= ${INACTIVITY.ALERT_DAYS}`);
    const toDeactivate = all.filter((r) => r.daysInactive >= INACTIVITY.DEACTIVATE_DAYS);
    // Alert once per inactive spell: skip anyone already alerted after their last business.
    const toAlert = all.filter((r) => r.daysInactive < INACTIVITY.DEACTIVATE_DAYS && (!r.inactivityAlertedAt || r.inactivityAlertedAt < r.lastActivityAt));

    const staff = await this.prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'EXECUTIVE'] }, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    const staffIds = staff.map((s) => s.id);
    const systemActor = actor ? { id: actor.id, role: actor.role } : null;

    if (toAlert.length) {
      await this.prisma.$transaction(async (tx) => {
        await tx.user.updateMany({ where: { id: { in: toAlert.map((r) => r.id) } }, data: { inactivityAlertedAt: new Date() } });
        await this.notify.toUsers(tx, staffIds, {
          title: `${toAlert.length} partner${toAlert.length > 1 ? 's' : ''} inactive for ${INACTIVITY.ALERT_DAYS}+ days`,
          body: `${listNames(toAlert)} have had no case login or payout for ${INACTIVITY.ALERT_DAYS} days. Please contact them to restart business. Codes are deactivated automatically at ${INACTIVITY.DEACTIVATE_DAYS} days.`,
          priority: 'HIGH',
        });
        await this.audit.log(tx, systemActor, { action: 'INACTIVITY_ALERT_SENT', entity: 'user', after: { userIds: toAlert.map((r) => r.id), days: INACTIVITY.ALERT_DAYS } }, meta);
      });
    }

    const reason = `No case login or payout for ${INACTIVITY.DEACTIVATE_DAYS} days`;
    for (const r of toDeactivate) {
      await this.prisma.$transaction(async (tx) => {
        // Re-check inside the transaction so a case logged a moment ago is respected.
        const u = await tx.user.findUnique({ where: { id: r.id }, select: { status: true } });
        if (u?.status !== 'ACTIVE') return;
        await tx.user.update({ where: { id: r.id }, data: { status: 'DEACTIVATED', deactivatedAt: new Date(), deactivationReason: reason } });
        await this.auth.revokeAll(r.id, tx);
        await this.audit.log(
          tx,
          systemActor,
          { action: 'USER_AUTO_DEACTIVATED', entity: 'user', entityId: r.id, before: { status: 'ACTIVE' }, after: { status: 'DEACTIVATED', reason, lastActivityAt: r.lastActivityAt, daysInactive: r.daysInactive } },
          meta,
        );
      });
      await this.sms
        .send(r.mobile, `Your Rupeemap partner code has been deactivated after ${INACTIVITY.DEACTIVATE_DAYS} days without a case login or payout. Please contact Rupeemap to reactivate it.`)
        .catch(() => undefined);
    }
    if (toDeactivate.length) {
      await this.prisma.$transaction((tx) =>
        this.notify.toUsers(tx, staffIds, {
          title: `${toDeactivate.length} partner code${toDeactivate.length > 1 ? 's' : ''} deactivated for inactivity`,
          body: `${listNames(toDeactivate)} reached ${INACTIVITY.DEACTIVATE_DAYS} days without business and were deactivated. Only Admin can reactivate them from Inactive Partners.`,
          priority: 'HIGH',
        }),
      );
    }
    return { alerted: toAlert.length, deactivated: toDeactivate.length };
  }

  /** Admin only: bring a deactivated code back. The 90-day clock restarts today. */
  async reactivate(actor: AuthUser, id: string, reason: string, meta: RequestMeta) {
    if (actor.role !== 'ADMIN') throw forbidden('Only Admin can reactivate a partner code');
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u || u.deletedAt) throw notFound('User');
    if (u.status !== 'DEACTIVATED') throw new AppError('VALIDATION_ERROR', 'This code is not deactivated');
    const next = u.passwordHash ? 'ACTIVE' : 'PENDING_ACTIVATION';
    const updated = await this.prisma.$transaction(async (tx) => {
      const x = await tx.user.update({
        where: { id },
        data: { status: next, reactivatedAt: new Date(), inactivityAlertedAt: null, deactivatedAt: null, deactivationReason: null },
        select: { id: true, name: true, status: true },
      });
      await this.audit.log(
        tx,
        actor,
        { action: 'USER_REACTIVATED', entity: 'user', entityId: id, before: { status: u.status, deactivatedAt: u.deactivatedAt, reason: u.deactivationReason }, after: { status: next, reason } },
        meta,
      );
      await this.notify.toUsers(tx, [id], {
        title: 'Your partner code is active again',
        body: `Welcome back. Log a case within ${INACTIVITY.DEACTIVATE_DAYS} days to keep your code active.`,
        sentById: actor.id,
      });
      return x;
    });
    await this.sms
      .send(u.mobile, `Your Rupeemap ${ROLE_LABELS[u.role as Role]} code is active again. You can sign in and log cases.`)
      .catch(() => undefined);
    return updated;
  }
}

function listNames(rows: InactivePartnerRow[]) {
  const names = rows.slice(0, 5).map((r) => `${r.name} (${r.role === 'DSA' ? 'DSA' : 'Team Partner'}, ${r.daysInactive} days)`);
  return rows.length > 5 ? `${names.join(', ')} and ${rows.length - 5} more` : names.join(', ');
}

