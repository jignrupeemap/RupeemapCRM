import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from './auth-context';
import { can } from './auth-context';

/**
 * Data scope. Every list, detail, report and export query goes through these
 * so a user can never read rows outside their scope, whatever the URL says.
 */
@Injectable()
export class ScopeService {
  caseWhere(user: AuthUser): Prisma.LoanCaseWhereInput {
    const base: Prisma.LoanCaseWhereInput = { deletedAt: null };
    if (can(user, 'CASE_VIEW_ALL')) return base;
    if (user.role === 'DSA' && can(user, 'CASE_VIEW_TEAM')) return { ...base, dsaId: user.id };
    if (user.role === 'TEAM_PARTNER' && can(user, 'CASE_VIEW_OWN')) return { ...base, teamPartnerId: user.id };
    return { ...base, id: '00000000-0000-0000-0000-000000000000' };
  }

  payoutWhere(user: AuthUser): Prisma.PayoutWhereInput {
    if (!can(user, 'PAYOUT_VIEW')) return { id: '00000000-0000-0000-0000-000000000000' };
    if (user.role === 'TEAM_PARTNER') return { beneficiaryId: user.id };
    if (user.role === 'DSA') return { loanCase: { dsaId: user.id } };
    return {};
  }

  /** Users this person may see in lists (DSA: own team only). */
  userWhere(user: AuthUser): Prisma.UserWhereInput {
    const base: Prisma.UserWhereInput = { deletedAt: null };
    if (user.role === 'ADMIN' || (user.role === 'EXECUTIVE' && can(user, 'USER_VIEW'))) return base;
    if (user.role === 'DSA')
      return { ...base, role: 'TEAM_PARTNER', memberships: { some: { endedOn: null, dsa: { userId: user.id } } } };
    return { ...base, id: user.id };
  }
}
