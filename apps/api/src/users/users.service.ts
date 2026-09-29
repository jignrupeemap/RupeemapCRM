import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EXECUTIVE_CONFIGURABLE,
  PAYOUT_LIMITS,
  effectivePermissions,
  type Permission,
  type Role,
  createUserSchema,
  payoutRateSchema,
  userStatusActionSchema,
} from '@rupeemap/shared';
import type { z } from 'zod';
import { PrismaService, type Tx } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { ScopeService } from '../common/scope.service';
import { SmsService } from '../common/sms.service';
import { AppError, forbidden, notFound } from '../common/errors';
import { can, type AuthUser, type RequestMeta } from '../common/auth-context';
import { AuthService } from '../auth/auth.service';
import { Paged } from '../common/http';

type CreateUser = z.infer<typeof createUserSchema>;

const publicUser = {
  id: true,
  name: true,
  mobile: true,
  email: true,
  role: true,
  status: true,
  mobileVerified: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly sms: SmsService,
    private readonly auth: AuthService,
  ) {}

  /** The DSA (user id) a Team Partner will be placed under, enforcing who may do it. */
  private async resolveTeamDsa(actor: AuthUser, dsaUserId?: string) {
    if (actor.role === 'DSA') {
      if (dsaUserId && dsaUserId !== actor.id) throw forbidden('You can only add Team Partners to your own team');
      dsaUserId = actor.id;
    }
    if (!dsaUserId) throw new AppError('VALIDATION_ERROR', 'Choose the DSA this Team Partner belongs to', { fields: { dsaId: 'Choose a DSA' } });
    const dsa = await this.prisma.dsaPartner.findUnique({ where: { userId: dsaUserId }, include: { user: true } });
    if (!dsa || dsa.user.deletedAt || dsa.user.role !== 'DSA') throw new AppError('VALIDATION_ERROR', 'Selected DSA does not exist');
    if (dsa.user.status === 'BLOCKED' || dsa.user.status === 'SUSPENDED' || dsa.user.status === 'DEACTIVATED')
      throw new AppError('VALIDATION_ERROR', 'Selected DSA is not active');
    return dsa;
  }

  async create(actor: AuthUser, input: CreateUser, meta: RequestMeta) {
    const need: Record<CreateUser['role'], Permission> = {
      DSA: 'USER_CREATE_DSA',
      TEAM_PARTNER: 'USER_CREATE_TEAM_PARTNER',
      EXECUTIVE: 'USER_CREATE_EXECUTIVE',
    };
    if (!can(actor, need[input.role])) throw forbidden();

    const exists = await this.prisma.user.findUnique({ where: { mobile: input.mobile } });
    if (exists) throw new AppError('CONFLICT', 'A user with this mobile number already exists', { fields: { mobile: 'Already registered' } });

    const dsa = input.role === 'TEAM_PARTNER' ? await this.resolveTeamDsa(actor, input.dsaId) : null;

    if (input.payoutPercent !== undefined) {
      if (input.role === 'DSA') this.assertDsaRateAllowed(actor, input.payoutPercent);
      if (input.role === 'TEAM_PARTNER') await this.assertTeamRateAllowed(actor, dsa!.userId, input.payoutPercent);
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          name: input.name,
          mobile: input.mobile,
          email: input.email || null,
          role: input.role,
          status: 'PENDING_ACTIVATION',
          createdById: actor.id,
        },
        select: publicUser,
      });
      if (input.role === 'DSA') {
        const count = await tx.dsaPartner.count();
        await tx.dsaPartner.create({ data: { userId: u.id, code: `DSA-${String(count + 1).padStart(4, '0')}` } });
      }
      if (dsa) await tx.teamMembership.create({ data: { userId: u.id, dsaId: dsa.id } });
      if (input.role === 'DSA' || input.role === 'TEAM_PARTNER') await tx.kycProfile.create({ data: { userId: u.id } });
      if (input.payoutPercent !== undefined && input.role !== 'EXECUTIVE') {
        await tx.payoutRate.create({
          data: { userId: u.id, percent: input.payoutPercent, effectiveFrom: startOfToday(), setById: actor.id, reason: 'Initial rate' },
        });
      }
      await this.audit.log(tx, actor, { action: 'USER_CREATED', entity: 'user', entityId: u.id, after: { ...u, dsaUserId: dsa?.userId, payoutPercent: input.payoutPercent } }, meta);
      return u;
    });

    await this.sms
      .send(user.mobile, `Welcome to Rupeemap CRM, ${user.name}. Your ${roleName(user.role as Role)} login is ready. Open the app and choose "Activate account" to verify your mobile and set a password.`)
      .catch(() => undefined); // a failed SMS never fails account creation
    return user;
  }

  async list(actor: AuthUser, q: { role?: string; status?: string; q?: string; dsaId?: string; page?: number; pageSize?: number; from?: string; to?: string }) {
    const period = { from: validDate(q.from), to: validDate(q.to) };
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 20));
    const where: Prisma.UserWhereInput = { AND: [this.scope.userWhere(actor)] };
    const and = where.AND as Prisma.UserWhereInput[];
    if (q.role) and.push({ role: q.role as Role });
    if (q.status) and.push({ status: q.status as any });
    if (q.dsaId) and.push({ memberships: { some: { endedOn: null, dsa: { userId: q.dsaId } } } });
    if (q.q) and.push({ OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { mobile: { contains: q.q } }] });
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          ...publicUser,
          dsaProfile: { select: { code: true } },
          memberships: { where: { endedOn: null }, select: { dsa: { select: { user: { select: { id: true, name: true } } } } } },
          kyc: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    const ids = items.map((i) => i.id);
    const stats = await this.caseStatsByUser(ids, period);
    const rates = await this.currentRates(ids);
    const payouts = await this.payoutTotals(ids, period);
    return new Paged(
      items.map((u) => ({
        ...u,
        dsaCode: u.dsaProfile?.code ?? null,
        dsa: u.memberships[0]?.dsa.user ?? null,
        kycStatus: u.kyc?.status ?? null,
        payoutPercent: rates.get(u.id) ?? null,
        stats: stats.get(u.id) ?? emptyStats(),
        payout: payouts.get(u.id) ?? { amount: 0, paid: 0, count: 0 },
        dsaProfile: undefined,
        memberships: undefined,
        kyc: undefined,
      })),
      { page, pageSize, total },
    );
  }

  async detail(actor: AuthUser, id: string) {
    const visible = await this.prisma.user.findFirst({ where: { AND: [this.scope.userWhere(actor), { id }] }, select: { id: true } });
    if (!visible && id !== actor.id) throw notFound('User');
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        ...publicUser,
        dsaProfile: { select: { code: true, firmName: true, gstApplicable: true } },
        memberships: { orderBy: { startedOn: 'desc' }, select: { startedOn: true, endedOn: true, endReason: true, dsa: { select: { code: true, user: { select: { id: true, name: true } } } } } },
        kyc: true,
        payoutRates: { orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], take: 20 },
        permissions: true,
      },
    });
    const stats = (await this.caseStatsByUser([id])).get(id) ?? emptyStats();
    return {
      ...u,
      effectivePermissions: effectivePermissions(u.role as Role, u.permissions),
      configurablePermissions: u.role === 'EXECUTIVE' ? EXECUTIVE_CONFIGURABLE : [],
      stats,
    };
  }

  private async caseStatsByUser(ids: string[], period: { from?: Date; to?: Date } = {}) {
    const map = new Map<string, ReturnType<typeof emptyStats>>();
    if (!ids.length) return map;
    const from = period.from ? Prisma.sql`AND c.created_at >= ${period.from}` : Prisma.empty;
    const to = period.to ? Prisma.sql`AND c.created_at <= ${period.to}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ uid: string; status: string; n: bigint; amt: Prisma.Decimal | null }[]>`
      SELECT u.uid, c.status::text AS status, count(*) AS n, sum(c.handover_amount) AS amt
      FROM loan_cases c
      JOIN LATERAL (VALUES (c.dsa_id), (c.team_partner_id)) AS u(uid) ON u.uid IS NOT NULL
      WHERE c.deleted_at IS NULL AND u.uid = ANY(${ids}::uuid[]) ${from} ${to}
      GROUP BY u.uid, c.status`;
    for (const r of rows) {
      const s = map.get(r.uid) ?? emptyStats();
      s.total += Number(r.n);
      (s as any)[r.status.toLowerCase()] = Number(r.n);
      if (r.status === 'HANDOVER') s.handoverAmount = Number(r.amt ?? 0);
      map.set(r.uid, s);
    }
    return map;
  }

  /** Each person's own payout lines (created in the period): total and paid. */
  private async payoutTotals(ids: string[], period: { from?: Date; to?: Date }) {
    const map = new Map<string, { amount: number; paid: number; count: number }>();
    if (!ids.length) return map;
    const rows = await this.prisma.payout.groupBy({
      by: ['beneficiaryId', 'status'],
      where: { beneficiaryId: { in: ids }, createdAt: { gte: period.from, lte: period.to }, loanCase: { deletedAt: null } },
      _sum: { amount: true },
      _count: true,
    });
    for (const r of rows) {
      const t = map.get(r.beneficiaryId) ?? { amount: 0, paid: 0, count: 0 };
      t.amount += Number(r._sum.amount ?? 0);
      t.count += r._count;
      if (r.status === 'PAID') t.paid += Number(r._sum.amount ?? 0);
      map.set(r.beneficiaryId, t);
    }
    return map;
  }

  private async currentRates(ids: string[]) {
    const map = new Map<string, number>();
    if (!ids.length) return map;
    const rows = await this.prisma.$queryRaw<{ user_id: string; percent: Prisma.Decimal }[]>`
      SELECT DISTINCT ON (user_id) user_id, percent FROM payout_rates
      WHERE user_id = ANY(${ids}::uuid[]) AND bank_id IS NULL AND loan_type IS NULL AND effective_from <= CURRENT_DATE
      ORDER BY user_id, effective_from DESC, created_at DESC`;
    for (const r of rows) map.set(r.user_id, Number(r.percent));
    return map;
  }

  async changeStatus(actor: AuthUser, id: string, body: z.infer<typeof userStatusActionSchema>, meta: RequestMeta) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target || target.deletedAt) throw notFound('User');
    if (target.id === actor.id) throw forbidden('You cannot change your own account status');
    if (target.role === 'ADMIN' || (target.role === 'EXECUTIVE' && actor.role !== 'ADMIN')) throw forbidden();
    if (target.status === 'DEACTIVATED') {
      throw forbidden(
        actor.role === 'ADMIN'
          ? 'This code was deactivated for inactivity. Use Reactivate in Inactive Partners.'
          : 'This code was deactivated for inactivity. Only Admin can reactivate it.',
      );
    }
    const next ={ BLOCK: 'BLOCKED', UNBLOCK: 'ACTIVE', SUSPEND: 'SUSPENDED', ACTIVATE: 'ACTIVE' }[body.action] as 'ACTIVE' | 'BLOCKED' | 'SUSPENDED';
    if ((body.action === 'UNBLOCK' || body.action === 'ACTIVATE') && !target.passwordHash) {
      throw new AppError('VALIDATION_ERROR', 'This user has not activated their account yet');
    }
    return this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { id }, data: { status: next }, select: publicUser });
      if (next !== 'ACTIVE') await this.auth.revokeAll(id, tx);
      await this.audit.log(tx, actor, { action: `USER_${body.action}`, entity: 'user', entityId: id, before: { status: target.status }, after: { status: next, reason: body.reason } }, meta);
      return u;
    });
  }

  /** Clears the password and signs the user out; they set a new one with OTP. */
  async resetPassword(actor: AuthUser, id: string, meta: RequestMeta) {
    const target = await this.prisma.user.findFirst({ where: { AND: [this.scope.userWhere(actor), { id }] } });
    if (!target) throw notFound('User');
    if (target.role === 'ADMIN' || (target.role === 'EXECUTIVE' && actor.role !== 'ADMIN')) throw forbidden();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash: null, failedLogins: 0, lockedUntil: null } });
      await this.auth.revokeAll(id, tx);
      await this.audit.log(tx, actor, { action: 'USER_PASSWORD_RESET_BY_ADMIN', entity: 'user', entityId: id }, meta);
    });
    await this.sms
      .send(target.mobile, `Your Rupeemap CRM password was reset. Open the app and choose "Activate account" to set a new password with OTP.`)
      .catch(() => undefined);
    return null;
  }

  /** Team Partner → DSA. Same user id, so every historical record stays linked. */
  async promote(actor: AuthUser, id: string, reason: string, meta: RequestMeta) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { memberships: { where: { endedOn: null } } } });
    if (!target || target.deletedAt) throw notFound('User');
    if (target.role !== 'TEAM_PARTNER') throw new AppError('VALIDATION_ERROR', 'Only Team Partners can be promoted to DSA');
    return this.prisma.$transaction(async (tx) => {
      await tx.teamMembership.updateMany({ where: { userId: id, endedOn: null }, data: { endedOn: new Date(), endReason: 'Promoted to DSA' } });
      const count = await tx.dsaPartner.count();
      const profile = await tx.dsaPartner.create({ data: { userId: id, code: `DSA-${String(count + 1).padStart(4, '0')}` } });
      const u = await tx.user.update({ where: { id }, data: { role: 'DSA' }, select: publicUser });
      await this.auth.revokeAll(id, tx); // new role takes effect on next sign-in
      await this.audit.log(
        tx,
        actor,
        { action: 'USER_PROMOTED', entity: 'user', entityId: id, before: { role: 'TEAM_PARTNER', dsaId: target.memberships[0]?.dsaId }, after: { role: 'DSA', dsaCode: profile.code, reason } },
        meta,
      );
      return u;
    });
  }

  async setPermissions(actor: AuthUser, id: string, grants: Record<string, boolean>, meta: RequestMeta) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { permissions: true } });
    if (!target || target.role !== 'EXECUTIVE') throw new AppError('VALIDATION_ERROR', 'Permissions can be configured for Admin Executives only');
    const entries = Object.entries(grants).filter(([p]) => EXECUTIVE_CONFIGURABLE.includes(p as Permission));
    return this.prisma.$transaction(async (tx) => {
      for (const [permission, granted] of entries) {
        await tx.userPermission.upsert({
          where: { userId_permission: { userId: id, permission } },
          create: { userId: id, permission, granted, setById: actor.id },
          update: { granted, setById: actor.id, setAt: new Date() },
        });
      }
      await this.auth.revokeAll(id, tx);
      const after = await tx.userPermission.findMany({ where: { userId: id } });
      await this.audit.log(tx, actor, { action: 'PERMISSIONS_CHANGED', entity: 'user', entityId: id, before: target.permissions, after }, meta);
      return effectivePermissions('EXECUTIVE', after);
    });
  }

  /**
   * A Team Partner's share comes out of their DSA's slab, so it can never be
   * more than that slab, nor more than the 0.90% standard maximum. A DSA can
   * change it any time for their own team, without Rupeemap's approval.
   */
  private async assertTeamRateAllowed(actor: AuthUser, dsaUserId: string, percent: number) {
    if (!can(actor, 'PAYOUT_PERCENTAGE_UPDATE_TEAM')) throw forbidden('You cannot set Team Partner payout percentage');
    if (actor.role === 'DSA' && dsaUserId !== actor.id) throw forbidden('You can set payout only for your own Team Partners');
    const slab = (await this.currentRates([dsaUserId])).get(dsaUserId);
    if (slab === undefined && actor.role === 'DSA') throw new AppError('VALIDATION_ERROR', 'Your own payout slab is not set yet. Ask Rupeemap to set it first.');
    const max = Math.min(slab ?? PAYOUT_LIMITS.STANDARD_MAX, PAYOUT_LIMITS.STANDARD_MAX);
    if (percent > max) {
      throw new AppError(
        'VALIDATION_ERROR',
        slab !== undefined && slab <= PAYOUT_LIMITS.STANDARD_MAX
          ? `Team Partner payout cannot be more than the DSA slab of ${slab}%`
          : `Team Partner payout cannot be more than ${PAYOUT_LIMITS.STANDARD_MAX}%`,
        { fields: { percent: `Maximum ${max}%` } },
      );
    }
  }

  /** DSA slab: up to 0.90% by anyone allowed to set it; only Admin can go up to 0.98%. */
  private assertDsaRateAllowed(actor: AuthUser, percent: number) {
    if (!can(actor, 'PAYOUT_PERCENTAGE_UPDATE_DSA')) throw forbidden('You cannot set DSA payout percentage');
    const max = actor.role === 'ADMIN' ? PAYOUT_LIMITS.ADMIN_MAX : PAYOUT_LIMITS.STANDARD_MAX;
    if (percent > max) {
      throw new AppError(
        'VALIDATION_ERROR',
        actor.role === 'ADMIN' ? `DSA payout slab cannot be more than ${PAYOUT_LIMITS.ADMIN_MAX}%` : `Only Admin can set a DSA slab above ${PAYOUT_LIMITS.STANDARD_MAX}%`,
        { fields: { percent: `Maximum ${max}%` } },
      );
    }
  }

  async setPayoutRate(actor: AuthUser, id: string, body: z.infer<typeof payoutRateSchema>, meta: RequestMeta) {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { memberships: { where: { endedOn: null }, include: { dsa: true } } } });
    if (!target || target.deletedAt) throw notFound('User');
    if (target.role === 'DSA') {
      this.assertDsaRateAllowed(actor, body.percent);
    } else if (target.role === 'TEAM_PARTNER') {
      await this.assertTeamRateAllowed(actor, target.memberships[0]?.dsa.userId ?? '', body.percent);
    } else throw new AppError('VALIDATION_ERROR', 'Payout percentage applies to DSA and Team Partners only');

    const previous = (await this.currentRates([id])).get(id) ?? null;
    return this.prisma.$transaction(async (tx: Tx) => {
      const rate = await tx.payoutRate.create({
        data: { userId: id, percent: body.percent, effectiveFrom: body.effectiveFrom, setById: actor.id, reason: body.reason },
      });
      await this.audit.log(tx, actor, { action: 'PAYOUT_PERCENTAGE_CHANGED', entity: 'user', entityId: id, before: { percent: previous }, after: rate }, meta);
      return rate;
    });
  }

  async setKycStatus(actor: AuthUser, id: string, decision: 'APPROVE' | 'REJECT', reason: string | undefined, meta: RequestMeta) {
    const kyc = await this.prisma.kycProfile.findUnique({ where: { userId: id } });
    if (!kyc) throw notFound('KYC profile');
    if (decision === 'REJECT' && !reason) throw new AppError('VALIDATION_ERROR', 'Enter the rejection reason');
    // Admin decides only on a complete set the Executive has submitted.
    if (kyc.status !== 'UNDER_ADMIN_VERIFICATION') {
      throw new AppError('INVALID_TRANSITION', 'KYC documents have not been submitted for verification yet');
    }
    return this.prisma.$transaction(async (tx) => {
      const k = await tx.kycProfile.update({
        where: { userId: id },
        data:
          decision === 'APPROVE'
            ? { status: 'APPROVED', verifiedById: actor.id, verifiedAt: new Date(), rejectionReason: null }
            : { status: 'RESUBMISSION_REQUIRED', rejectionReason: reason, verifiedById: actor.id, verifiedAt: new Date() },
      });
      await this.audit.log(tx, actor, { action: `KYC_${decision}D`, entity: 'kyc', entityId: kyc.id, before: { status: kyc.status }, after: { status: k.status, reason } }, meta);
      return k;
    });
  }
}

function validDate(v?: string) {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function emptyStats() {
  return { total: 0, login: 0, sanction: 0, disbursed: 0, handover: 0, query: 0, reject: 0, withdraw: 0, handoverAmount: 0 };
}

function roleName(r: Role) {
  return { ADMIN: 'Admin', EXECUTIVE: 'Admin Executive', DSA: 'DSA Partner', TEAM_PARTNER: 'Team Partner' }[r];
}
