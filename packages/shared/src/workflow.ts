import { z } from 'zod';
import type { CaseStatus, PayoutStatus, Role } from './enums';
import { DISBURSEMENT_TYPES } from './enums';

const money = z.coerce
  .number({ invalid_type_error: 'Enter an amount' })
  .positive('Amount must be more than zero')
  .max(1_000_000_000_000, 'Amount is too large')
  .transform((v) => Math.round(v * 100) / 100);

const text = (label: string, max = 1000) =>
  z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`).max(max);

/**
 * Case actions. The API is the only place these are executed; the web app
 * reads the same definitions to render the right modal.
 */
export const CASE_ACTIONS = {
  SANCTION: {
    label: 'Mark Sanctioned',
    from: ['LOGIN'] as CaseStatus[],
    to: 'SANCTION' as CaseStatus,
    schema: z.object({ sanctionAmount: money, remarks: z.string().trim().max(1000).optional() }),
  },
  DISBURSE: {
    label: 'Mark Disbursed',
    from: ['SANCTION', 'DISBURSED'] as CaseStatus[],
    to: 'DISBURSED' as CaseStatus,
    schema: z.object({
      disbursedAmount: money,
      disbursementType: z.enum(DISBURSEMENT_TYPES, { required_error: 'Choose the disbursement type' }),
      remarks: z.string().trim().max(1000).optional(),
    }),
  },
  HANDOVER: {
    label: 'Mark Handover',
    from: ['DISBURSED'] as CaseStatus[],
    to: 'HANDOVER' as CaseStatus,
    schema: z.object({
      handoverAmount: money,
      otcPddCleared: z.boolean({ required_error: 'Choose whether OTC/PDD is cleared' }),
      loanAccountNo: text('Loan account number', 40),
      salesManagerName: text('Sales manager name', 120),
      salesManagerEmail: z.string().trim().email('Enter a valid email'),
      remarks: z.string().trim().max(1000).optional(),
    }),
  },
  RAISE_QUERY: {
    label: 'Raise Query',
    from: ['LOGIN', 'SANCTION', 'DISBURSED'] as CaseStatus[],
    to: 'QUERY' as CaseStatus,
    schema: z.object({ remarks: text('Query remark') }),
  },
  RESOLVE_QUERY: {
    label: 'Resolve Query',
    from: ['QUERY'] as CaseStatus[],
    to: null, // returns to the stage the case was in before the query
    schema: z.object({ remarks: text('Resolution remark') }),
  },
  REJECT: {
    label: 'Reject',
    from: ['LOGIN', 'SANCTION', 'QUERY'] as CaseStatus[],
    to: 'REJECT' as CaseStatus,
    schema: z.object({ reason: text('Reject reason', 200), remarks: text('Remarks') }),
  },
  WITHDRAW: {
    label: 'Withdraw',
    from: ['LOGIN', 'SANCTION', 'QUERY'] as CaseStatus[],
    to: 'WITHDRAW' as CaseStatus,
    schema: z.object({ reason: text('Withdrawal reason', 200), remarks: text('Remarks') }),
  },
  REOPEN: {
    label: 'Reopen',
    from: ['REJECT', 'WITHDRAW'] as CaseStatus[],
    to: 'LOGIN' as CaseStatus,
    schema: z.object({ reason: text('Reason for reopening', 500) }),
  },
} as const;

export type CaseAction = keyof typeof CASE_ACTIONS;
export const CASE_ACTION_KEYS = Object.keys(CASE_ACTIONS) as CaseAction[];

export const REJECT_REASONS = [
  'Low CIBIL score',
  'Income not eligible',
  'Property not approved',
  'Documents incomplete',
  'Negative profile / area',
  'Other',
];
export const WITHDRAW_REASONS = [
  'Customer not interested',
  'Better offer from another bank',
  'Customer postponed purchase',
  'Documents not provided',
  'Other',
];

/**
 * Which actions a user may take on a case in the given status. Permission and
 * ownership checks happen before this in the API.
 */
export function allowedCaseActions(
  status: CaseStatus,
  ctx: { role: Role; canChangeStatus: boolean; canReopen: boolean },
): CaseAction[] {
  if (!ctx.canChangeStatus) return [];
  return CASE_ACTION_KEYS.filter((a) => {
    if (!CASE_ACTIONS[a].from.includes(status)) return false;
    if (a === 'REOPEN') return ctx.canReopen;
    return true;
  });
}

export const PAYOUT_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  PENDING: ['CONFIRMED', 'HOLD'],
  CONFIRMED: ['PAID', 'HOLD', 'PENDING'],
  HOLD: ['PENDING', 'CONFIRMED'],
  PAID: [],
};

export function canMovePayout(from: PayoutStatus, to: PayoutStatus): boolean {
  return PAYOUT_TRANSITIONS[from].includes(to);
}

/** Payout amount rounded to paise, using the percentage snapshot. */
export function computePayoutAmount(baseAmount: number, percent: number): number {
  return Math.round(baseAmount * percent) / 100;
}

/** Case number like LDSA-2026-000001. */
export function formatCaseNo(year: number, seq: number): string {
  return `LDSA-${year}-${String(seq).padStart(6, '0')}`;
}
