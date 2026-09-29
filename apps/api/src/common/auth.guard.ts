import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { effectivePermissions, type Permission, type Role } from '@rupeemap/shared';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { AppError, forbidden } from './errors';
import { IS_PUBLIC, REQUIRED_PERMISSIONS, type AuthUser } from './auth-context';

export const SESSION_COOKIE = 'rm_session';
export const sessionKey = (tokenHash: string) => `sess:${tokenHash}`;
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
/** Sign out after this long with no activity (staff see the most data, so they time out sooner). */
export const IDLE_MINUTES: Record<Role, number> = { ADMIN: 30, EXECUTIVE: 30, DSA: 120, TEAM_PARTNER: 120 };

/**
 * Global guard: authenticate from the session (cookie or bearer), confirm the
 * account is still ACTIVE, then check the route's required permissions.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();

    const bearer = (req.headers.authorization as string | undefined)?.match(/^Bearer (.+)$/)?.[1];
    const token: string | undefined = bearer ?? req.cookies?.[SESSION_COOKIE];
    if (!token) throw new AppError('UNAUTHENTICATED', 'Please sign in to continue');

    // Cookie-authenticated writes must carry our custom header (blocks cross-site form posts).
    if (!bearer && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-requested-with'] !== 'rupeemap') {
      throw forbidden('Request blocked. Reload the page and try again.');
    }

    const user = await this.loadUser(hashToken(token));
    if (!user) throw new AppError('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
    req.user = user;

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [ctx.getHandler(), ctx.getClass()]);
    if (required?.length && !required.every((p) => user.permissions.includes(p))) throw forbidden();
    return true;
  }

  private async loadUser(tokenHash: string): Promise<AuthUser | null> {
    const cached = await this.redis.getJson<AuthUser>(sessionKey(tokenHash));
    if (cached) return cached;
    const s = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            permissions: true,
            memberships: { where: { endedOn: null }, include: { dsa: { select: { userId: true } } }, take: 1 },
          },
        },
      },
    });
    if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
    const u = s.user;
    if (Date.now() - s.lastSeenAt.getTime() > IDLE_MINUTES[u.role as Role] * 60_000) {
      await this.prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } }).catch(() => undefined);
      return null;
    }
    if (u.status !== 'ACTIVE' || u.deletedAt) return null;
    const user: AuthUser = {
      id: u.id,
      name: u.name,
      mobile: u.mobile,
      role: u.role as Role,
      permissions: effectivePermissions(u.role as Role, u.permissions),
      sessionId: s.id,
      teamDsaUserId: u.memberships[0]?.dsa.userId ?? null,
    };
    await this.redis.setJson(sessionKey(tokenHash), user, 60);
    this.prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    return user;
  }
}
