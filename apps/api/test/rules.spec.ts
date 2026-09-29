/** Business rules shared by the website and the server: case stages, payouts, money, permissions and validation. */
import { describe, expect, it } from 'vitest';
import {
  CASE_ACTIONS,
  PARTNER_FORBIDDEN,
  PAYOUT_LIMITS,
  allowedCaseActions,
  canMovePayout,
  computePayoutAmount,
  createCaseSchema,
  effectivePermissions,
  formatCaseNo,
  formatINR,
  formatINRCompact,
  maskMobile,
  passwordSchema,
} from '@rupeemap/shared';

const staff = { role: 'EXECUTIVE' as const, canChangeStatus: true, canReopen: true };

describe('Case stages', () => {
  it('moves only forward, one stage at a time', () => {
    expect(allowedCaseActions('LOGIN', staff)).toEqual(expect.arrayContaining(['SANCTION', 'RAISE_QUERY', 'REJECT']));
    expect(allowedCaseActions('LOGIN', staff)).not.toContain('HANDOVER');
    expect(allowedCaseActions('LOGIN', staff)).not.toContain('DISBURSE');
    expect(allowedCaseActions('SANCTION', staff)).toContain('DISBURSE');
    expect(allowedCaseActions('DISBURSED', staff)).toEqual(expect.arrayContaining(['DISBURSE', 'HANDOVER']));
    expect(allowedCaseActions('QUERY', staff)).toContain('RESOLVE_QUERY');
  });

  it('a handed-over case is final, and nobody without status rights can act', () => {
    expect(allowedCaseActions('HANDOVER', staff).filter((a) => a !== 'REOPEN')).toEqual([]);
    expect(allowedCaseActions('LOGIN', { ...staff, canChangeStatus: false })).toEqual([]);
  });

  it('reopening a rejected case needs the reopen right', () => {
    expect(allowedCaseActions('REJECT', staff)).toContain('REOPEN');
    expect(allowedCaseActions('REJECT', { ...staff, canReopen: false })).not.toContain('REOPEN');
  });

  it('handover needs amount, OTC/PDD answer, loan account and sales manager', () => {
    const s = CASE_ACTIONS.HANDOVER.schema;
    expect(s.safeParse({}).success).toBe(false);
    expect(s.safeParse({ handoverAmount: 0, otcPddCleared: true, loanAccountNo: 'A1', salesManagerName: 'K', salesManagerEmail: 'k@bank.in' }).success).toBe(false);
    expect(s.safeParse({ handoverAmount: 2500000, otcPddCleared: true, loanAccountNo: 'A1', salesManagerName: 'K', salesManagerEmail: 'not-an-email' }).success).toBe(false);
    expect(s.safeParse({ handoverAmount: 2500000, otcPddCleared: false, loanAccountNo: 'A1', salesManagerName: 'K', salesManagerEmail: 'k@bank.in' }).success).toBe(true);
  });

  it('case numbers are fixed-width and ordered', () => {
    expect(formatCaseNo(2026, 12)).toBe('LDSA-2026-000012');
    expect(formatCaseNo(2026, 12) < formatCaseNo(2026, 100)).toBe(true);
  });
});

describe('Payouts', () => {
  it('a paid payout can never move again; hold is always reversible', () => {
    for (const to of ['PENDING', 'CONFIRMED', 'HOLD'] as const) expect(canMovePayout('PAID', to)).toBe(false);
    expect(canMovePayout('PENDING', 'PAID')).toBe(false); // must be confirmed first
    expect(canMovePayout('CONFIRMED', 'PAID')).toBe(true);
    expect(canMovePayout('HOLD', 'PENDING')).toBe(true);
  });

  it('amounts are rounded to the paisa', () => {
    expect(computePayoutAmount(2_500_000, 0.3)).toBe(7500);
    expect(computePayoutAmount(1_234_567, 0.55)).toBe(6790.12);
    expect(computePayoutAmount(3_333_333, 0.9)).toBe(30000);
  });

  it('slab caps: 0.90% standard, 0.98% only by Admin', () => {
    expect(PAYOUT_LIMITS.STANDARD_MAX).toBe(0.9);
    expect(PAYOUT_LIMITS.ADMIN_MAX).toBe(0.98);
  });
});

describe('Indian money and privacy formats', () => {
  it('uses lakh and crore grouping', () => {
    expect(formatINR(1234567.5)).toBe('₹12,34,567.50');
    expect(formatINR(4100000, { whole: true })).toBe('₹41,00,000');
    expect(formatINR(null)).toBe('—');
    expect(formatINRCompact(14_100_000)).toBe('₹1.41 Cr');
    expect(formatINRCompact(4_550_000)).toBe('₹45.5 L');
    expect(formatINRCompact(75_000)).toBe('₹75,000');
  });

  it('masks mobile numbers in shared messages', () => {
    expect(maskMobile('9876543221')).toBe('98XXXXXX21');
  });
});

describe('Permissions', () => {
  it('partners never get money, KYC or admin powers, whatever is configured', () => {
    for (const role of ['DSA', 'TEAM_PARTNER'] as const) {
      const perms = effectivePermissions(role, PARTNER_FORBIDDEN.map((p) => ({ permission: p, granted: true })));
      for (const p of PARTNER_FORBIDDEN) expect(perms, `${role} ${p}`).not.toContain(p);
    }
  });

  it('Admin can switch executive permissions on and off, but not Admin-only ones', () => {
    const on = effectivePermissions('EXECUTIVE', [{ permission: 'AUDIT_VIEW', granted: true }]);
    expect(on).toContain('AUDIT_VIEW');
    const off = effectivePermissions('EXECUTIVE', [{ permission: 'PAYOUT_UPDATE', granted: false }]);
    expect(off).not.toContain('PAYOUT_UPDATE');
    expect(effectivePermissions('EXECUTIVE', [{ permission: 'PERMISSION_MANAGE', granted: true }])).not.toContain('PERMISSION_MANAGE');
    expect(effectivePermissions('EXECUTIVE', [{ permission: 'PAYOUT_PERCENTAGE_UPDATE_DSA', granted: true }])).not.toContain('PAYOUT_PERCENTAGE_UPDATE_DSA');
  });

  it('a Team Partner cannot see the team or create users; a DSA only their team', () => {
    const tp = effectivePermissions('TEAM_PARTNER');
    expect(tp).not.toContain('CASE_VIEW_TEAM');
    expect(tp).not.toContain('USER_CREATE_TEAM_PARTNER');
    const dsa = effectivePermissions('DSA');
    expect(dsa).toContain('CASE_VIEW_TEAM');
    expect(dsa).not.toContain('CASE_VIEW_ALL');
  });
});

describe('Input checks', () => {
  it('a new case needs a customer, a valid mobile, a bank and a positive amount', () => {
    const bankId = '00000000-0000-4000-8000-000000000001';
    expect(createCaseSchema.safeParse({ customerName: 'Jay Patel', customerMobile: '9876543210', loanType: 'HOME_LOAN', bankId, appliedAmount: 4100000 }).success).toBe(true);
    expect(createCaseSchema.safeParse({ customerName: '', customerMobile: '9876543210', loanType: 'HOME_LOAN', bankId, appliedAmount: 4100000 }).success).toBe(false);
    expect(createCaseSchema.safeParse({ customerName: 'Jay Patel', customerMobile: '12345', loanType: 'HOME_LOAN', bankId, appliedAmount: 4100000 }).success).toBe(false);
    expect(createCaseSchema.safeParse({ customerName: 'Jay Patel', customerMobile: '9876543210', loanType: 'HOME_LOAN', bankId, appliedAmount: -5 }).success).toBe(false);
  });

  it('passwords need 8+ characters with a letter and a number, and not a common one', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('onlyletters').success).toBe(false);
    expect(passwordSchema.safeParse('Rupeemap@123').success).toBe(false);
    expect(passwordSchema.safeParse('Kesar-Mango-47').success).toBe(true);
  });
});
