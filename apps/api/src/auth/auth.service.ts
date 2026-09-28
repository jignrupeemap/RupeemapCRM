import { Injectable } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { effectivePermissions, type OtpPurpose, type Role } from '@rupeemap/shared';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';
import { AuditService } from '../common/audit.service';
import { SmsService } from '../common/sms.service';
import { AppError } from '../common/errors';
import { hashToken, sessionKey } from '../common/auth.guard';
import type { AuthUser, RequestMeta } from '../common/auth-context';

const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 3;
const OTP_RESEND_COOLDOWN_S = 30;
const SESSION_HOURS: Record<Role, number> = { ADMIN: 2, EXECUTIVE: 2, DSA: 12, TEAM_PARTNER: 12 };
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const PASSWORD_HISTORY = 5;

export const hashPassword = (p: string) => argonHash(p, ARGON);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
  ) {}

  private otpHash(mobile: string, purpose: string, code: string) {
    return createHmac('sha256', process.env.OTP_PEPPER ?? 'dev').update(`${mobile}:${purpose}:${code}`).digest('hex');
  }

  async login(login: string, password: string, meta: RequestMeta & { userAgent?: string }) {
    await this.redis.limit(`login:ip:${meta.ip}`, 30, 900);
    await this.redis.limit(`login:id:${login.toLowerCase()}`, 10, 900);

    const user = await this.prisma.user.findFirst({
      where: { OR: [{ mobile: login.replace(/\D/g, '').slice(-10) }, { username: login.toLowerCase() }], deletedAt: null },
    });
    const invalid = new AppError('UNAUTHENTICATED', 'Mobile/username or password is incorrect');
    if (!user) {
      await argonHash('timing-equaliser', ARGON); // keep response time similar
      throw invalid;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('UNAUTHENTICATED', 'Too many failed attempts. Try again in a few minutes or reset your password.');
    }
    if (user.status === 'PENDING_ACTIVATION' || !user.passwordHash) {
      throw new AppError('FORBIDDEN', 'Your account is not activated yet. Use "Activate account" with the OTP sent to your mobile.');
    }
    const ok = await argonVerify(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: {
            failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
            lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60000) : undefined,
          },
        });
        await this.audit.log(tx, { id: user.id, role: user.role }, { action: 'LOGIN_FAILED', entity: 'user', entityId: user.id }, meta);
      });
      throw invalid;
    }
    if (user.status === 'BLOCKED') throw new AppError('FORBIDDEN', 'Your account is blocked. Please contact Rupeemap support.');
    if (user.status === 'SUSPENDED') throw new AppError('FORBIDDEN', 'Your account is suspended. Please contact Rupeemap support.');
    if (user.status === 'DEACTIVATED')
      throw new AppError('FORBIDDEN', 'Your partner code was deactivated after 90 days without a case login or payout. Please contact Rupeemap to reactivate it.');

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
      const token = await this.createSession(tx, user.id, user.role as Role, meta);
      await this.audit.log(tx, { id: user.id, role: user.role }, { action: 'LOGIN', entity: 'user', entityId: user.id }, meta);
      return { token, maxAgeMs: SESSION_HOURS[user.role as Role] * 3600_000 };
    });
  }

  private async createSession(tx: any, userId: string, role: Role, meta: RequestMeta & { userAgent?: string }) {
    const token = randomBytes(32).toString('base64url');
    await tx.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 250),
        expiresAt: new Date(Date.now() + SESSION_HOURS[role] * 3600_000),
      },
    });
    return token;
  }

  async logout(user: AuthUser, token: string | undefined, meta: RequestMeta) {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: user.sessionId }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, user, { action: 'LOGOUT', entity: 'user', entityId: user.id }, meta);
    });
    if (token) await this.redis.client.del(sessionKey(hashToken(token)));
  }

  /** Revoke every session of a user (block, suspend, password change, role change). */
  async revokeAll(userId: string, tx: any = this.prisma) {
    const sessions = await tx.session.findMany({ where: { userId, revokedAt: null }, select: { id: true, tokenHash: true } });
    if (!sessions.length) return;
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.redis.client.del(...sessions.map((s: { tokenHash: string }) => sessionKey(s.tokenHash)));
  }

  /** Always answers the same way so mobile numbers cannot be discovered. */
  async requestOtp(mobile: string, purpose: OtpPurpose, meta: RequestMeta) {
    await this.redis.limit(`otp:ip:${meta.ip}`, 20, 3600);
    await this.redis.limit(`otp:mobile:${mobile}`, 5, 3600, 'Too many OTP requests for this number. Try again after an hour.');
    const cooldown = await this.redis.client.set(`otp:cd:${mobile}:${purpose}`, '1', 'EX', OTP_RESEND_COOLDOWN_S, 'NX');
    if (cooldown !== 'OK') throw new AppError('RATE_LIMITED', `Please wait ${OTP_RESEND_COOLDOWN_S} seconds before requesting another OTP`);

    const user = await this.prisma.user.findUnique({ where: { mobile } });
    const eligible =
      user &&
      !user.deletedAt &&
      (purpose === 'ACTIVATE'
        ? user.status === 'PENDING_ACTIVATION' || (user.status === 'ACTIVE' && !user.passwordHash)
        : user.status === 'ACTIVE');
    if (eligible) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.prisma.otpVerification.create({
        data: { mobile, purpose, codeHash: this.otpHash(mobile, purpose, code), expiresAt: new Date(Date.now() + OTP_TTL_MS), ip: meta.ip },
      });
      await this.sms.send(mobile, `${code} is your Rupeemap CRM OTP. Valid for 5 minutes. Do not share it with anyone.`, { otp: code });
    }
    return { sent: true, cooldownSeconds: OTP_RESEND_COOLDOWN_S };
  }

  async verifyOtp(mobile: string, purpose: OtpPurpose, code: string, meta: RequestMeta) {
    await this.redis.limit(`otpv:ip:${meta.ip}`, 30, 3600);
    const otp = await this.prisma.otpVerification.findFirst({
      where: { mobile, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const bad = new AppError('VALIDATION_ERROR', 'The OTP is incorrect or has expired', { fields: { otp: 'Incorrect or expired OTP' } });
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw bad;
    const expected = Buffer.from(otp.codeHash, 'hex');
    const given = Buffer.from(this.otpHash(mobile, purpose, code), 'hex');
    if (!timingSafeEqual(expected, given)) {
      await this.prisma.otpVerification.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw bad;
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { mobile } });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.otpVerification.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      await tx.user.update({ where: { id: user.id }, data: { mobileVerified: true } });
      await this.audit.log(tx, { id: user.id, role: user.role }, { action: 'OTP_VERIFIED', entity: 'user', entityId: user.id, after: { purpose } }, meta);
    });
    await this.redis.setJson(`pwtoken:${hashToken(token)}`, { userId: user.id, purpose }, 600);
    return { token, name: user.name };
  }

  /** Activation and reset both end here: set password, activate, sign in. */
  async setPassword(token: string, password: string, meta: RequestMeta & { userAgent?: string }) {
    const key = `pwtoken:${hashToken(token)}`;
    const t = await this.redis.getJson<{ userId: string; purpose: OtpPurpose }>(key);
    if (!t) throw new AppError('VALIDATION_ERROR', 'This link has expired. Request a new OTP.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: t.userId }, include: { passwordHistory: { orderBy: { createdAt: 'desc' }, take: PASSWORD_HISTORY } } });
    if (user.status === 'BLOCKED' || user.status === 'SUSPENDED' || user.status === 'DEACTIVATED')
      throw new AppError('FORBIDDEN', 'Your account is not active. Please contact Rupeemap support.');
    await this.assertNotReused(password, user.passwordHistory.map((h) => h.passwordHash));
    const passwordHash = await hashPassword(password);
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          status: 'ACTIVE',
          mobileVerified: true,
          failedLogins: 0,
          lockedUntil: null,
          ...(user.activatedAt ? {} : { activatedAt: new Date() }),
        },
      });
      await tx.passwordHistory.create({ data: { userId: user.id, passwordHash } });
      await this.revokeAll(user.id, tx);
      const sessionToken = await this.createSession(tx, user.id, user.role as Role, meta);
      await this.audit.log(
        tx,
        { id: user.id, role: user.role },
        { action: t.purpose === 'ACTIVATE' ? 'ACCOUNT_ACTIVATED' : 'PASSWORD_RESET', entity: 'user', entityId: user.id },
        meta,
      );
      return { token: sessionToken, maxAgeMs: SESSION_HOURS[user.role as Role] * 3600_000 };
    });
    await this.redis.client.del(key);
    return result;
  }

  async changePassword(user: AuthUser, current: string, next: string, meta: RequestMeta) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { passwordHistory: { orderBy: { createdAt: 'desc' }, take: PASSWORD_HISTORY } } });
    if (!u.passwordHash || !(await argonVerify(u.passwordHash, current))) {
      throw new AppError('VALIDATION_ERROR', 'Current password is incorrect', { fields: { currentPassword: 'Current password is incorrect' } });
    }
    await this.assertNotReused(next, u.passwordHistory.map((h) => h.passwordHash));
    const passwordHash = await hashPassword(next);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: { passwordHash } });
      await tx.passwordHistory.create({ data: { userId: u.id, passwordHash } });
      // Sign out other devices, keep this one.
      const others = await tx.session.findMany({ where: { userId: u.id, revokedAt: null, NOT: { id: user.sessionId } } });
      await tx.session.updateMany({ where: { id: { in: others.map((s) => s.id) } }, data: { revokedAt: new Date() } });
      if (others.length) await this.redis.client.del(...others.map((s) => sessionKey(s.tokenHash)));
      await this.audit.log(tx, user, { action: 'PASSWORD_CHANGED', entity: 'user', entityId: u.id }, meta);
    });
  }

  private async assertNotReused(password: string, previous: string[]) {
    for (const h of previous) {
      if (await argonVerify(h, password)) {
        throw new AppError('VALIDATION_ERROR', 'Choose a password you have not used recently', { fields: { password: 'Used recently' } });
      }
    }
  }

  async me(user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        dsaProfile: true,
        kyc: true,
        memberships: { where: { endedOn: null }, include: { dsa: { include: { user: { select: { id: true, name: true, mobile: true } } } } } },
      },
    });
    return {
      id: u.id,
      name: u.name,
      mobile: u.mobile,
      email: u.email,
      role: u.role,
      status: u.status,
      permissions: effectivePermissions(u.role as Role, await this.prisma.userPermission.findMany({ where: { userId: u.id } })),
      dsaCode: u.dsaProfile?.code ?? null,
      dsa: u.memberships[0]?.dsa.user ?? null,
      kycStatus: u.kyc?.status ?? null,
      lastLoginAt: u.lastLoginAt,
    };
  }
}
