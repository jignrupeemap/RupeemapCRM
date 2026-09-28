import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, Role } from '@rupeemap/shared';

/** The signed-in user, always built from the server-side session. */
export interface AuthUser {
  id: string;
  name: string;
  mobile: string;
  role: Role;
  permissions: Permission[];
  sessionId: string;
  /** For Team Partners: the DSA user id of their current team. */
  teamDsaUserId: string | null;
}

export interface RequestMeta {
  ip?: string;
  requestId?: string;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSIONS = 'requiredPermissions';
/** Require ALL listed permissions. */
export const RequirePermission = (...perms: Permission[]) => SetMetadata(REQUIRED_PERMISSIONS, perms);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta => {
  const req = ctx.switchToHttp().getRequest();
  return { ip: req.ip, requestId: req.id };
});

export function can(user: AuthUser, p: Permission) {
  return user.permissions.includes(p);
}
