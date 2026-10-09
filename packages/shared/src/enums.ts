export const ROLES = ['ADMIN', 'EXECUTIVE', 'DSA', 'TEAM_PARTNER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Admin',
  EXECUTIVE: 'Admin Executive',
  DSA: 'DSA Partner',
  TEAM_PARTNER: 'Team Partner',
};

export const USER_STATUSES = ['PENDING_ACTIVATION', 'ACTIVE', 'BLOCKED', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const CASE_STATUSES = [
  'LOGIN',
  'SANCTION',
  'DISBURSED',
  'HANDOVER',
  'QUERY',
  'REJECT',
  'WITHDRAW',
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  LOGIN: 'Login',
  SANCTION: 'Sanction',
  DISBURSED: 'Disbursed',
  HANDOVER: 'Handover',
  QUERY: 'Query',
  REJECT: 'Reject',
  WITHDRAW: 'Withdraw',
};

/** Default loan types; the live list is admin-configurable master data. */
export const DEFAULT_LOAN_TYPES = [
  { code: 'HOME_LOAN', name: 'Home Loan' },
  { code: 'MORTGAGE_LOAN', name: 'Mortgage Loan' },
  { code: 'BUSINESS_LOAN', name: 'Business Loan' },
  { code: 'USED_CAR_LOAN', name: 'Used Car Loan' },
  { code: 'OTHER', name: 'Other' },
] as const;

/** Checklist page groups loans into three families, each with its own document lists. */
export const LOAN_GROUPS = ['HL_LAP', 'BUSINESS', 'USED_CAR'] as const;
export type LoanGroup = (typeof LOAN_GROUPS)[number];
export const LOAN_GROUP_LABELS: Record<LoanGroup, string> = { HL_LAP: 'HL / LAP', BUSINESS: 'Business Loan', USED_CAR: 'Used Car Loan' };
/** Which checklist family a case's loan type belongs to (null = no family, e.g. "Other"). */
export function loanGroupOf(loanType: string | null | undefined): LoanGroup | null {
  const t = (loanType ?? '').toUpperCase();
  if (/HOME|MORTGAGE|LAP|PROPERTY|PLOT|CONSTRUCTION/.test(t)) return 'HL_LAP';
  if (/BUSINESS|MSME|WORKING/.test(t)) return 'BUSINESS';
  if (/CAR|VEHICLE|AUTO/.test(t)) return 'USED_CAR';
  return null;
}

/** Sections a checklist is grouped into, in display order. */
export const CHECKLIST_SECTIONS = ['KYC', 'BUSINESS_PROOF', 'INCOME', 'EXISTING_LOAN', 'PROPERTY', 'VEHICLE', 'OTHER'] as const;
export type ChecklistSection = (typeof CHECKLIST_SECTIONS)[number];
export const CHECKLIST_SECTION_LABELS: Record<ChecklistSection, string> = {
  KYC: 'KYC documents',
  BUSINESS_PROOF: 'Business proof',
  INCOME: 'Income documents',
  EXISTING_LOAN: 'Existing loan documents',
  PROPERTY: 'Property documents',
  VEHICLE: 'Vehicle documents',
  OTHER: 'Other documents',
};

/** Customer income profile: decides which documents the bank asks for. */
export const CUSTOMER_PROFILES = ['SALARIED', 'SENP', 'SEP', 'NRI'] as const;
export type CustomerProfile = (typeof CUSTOMER_PROFILES)[number];
export const CUSTOMER_PROFILE_LABELS: Record<CustomerProfile, string> = {
  SALARIED: 'Salaried',
  SENP: 'SENP (business / self-employed non-professional)',
  SEP: 'SEP (doctor, CA, architect / self-employed professional)',
  NRI: 'NRI',
};
export const CUSTOMER_PROFILE_SHORT: Record<CustomerProfile, string> = { SALARIED: 'Salaried', SENP: 'SENP', SEP: 'SEP', NRI: 'NRI' };

export const DISBURSEMENT_TYPES = ['PART', 'PART_TO_FULL', 'FULL'] as const;
export type DisbursementType = (typeof DISBURSEMENT_TYPES)[number];
export const DISBURSEMENT_TYPE_LABELS: Record<DisbursementType, string> = {
  PART: 'Part Payment',
  PART_TO_FULL: 'Part to Full',
  FULL: 'Full',
};

/**
 * Payout slab limits (Rupeemap rule, 29 Sep 2026). A DSA's slab is the total
 * payout per case; any Team Partner share comes out of it. Nobody can set more
 * than STANDARD_MAX, except Admin, who can set a DSA slab up to ADMIN_MAX.
 */
export const PAYOUT_LIMITS = { STANDARD_MAX: 0.9, ADMIN_MAX: 0.98 } as const;

export const PAYOUT_STATUSES = ['PENDING', 'CONFIRMED', 'PAID', 'HOLD'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  PAID: 'Paid',
  HOLD: 'Hold',
};

export const KYC_STATUSES = [
  'DOCUMENTS_PENDING',
  'UPLOADED',
  'UNDER_ADMIN_VERIFICATION',
  'APPROVED',
  'REJECTED',
  'RESUBMISSION_REQUIRED',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const KYC_STATUS_LABELS: Record<KycStatus, string> = {
  DOCUMENTS_PENDING: 'Documents pending',
  UPLOADED: 'Uploaded',
  UNDER_ADMIN_VERIFICATION: 'Under Admin verification',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RESUBMISSION_REQUIRED: 'Resubmission required',
};

/** First payout KYC documents (PART 38). GST certificate only when the partner is GST registered. */
export const KYC_DOC_TYPES = ['PAN', 'AADHAAR', 'CANCELLED_CHEQUE', 'PHOTO', 'GST_CERTIFICATE'] as const;
export type KycDocType = (typeof KYC_DOC_TYPES)[number];
export const KYC_DOC_LABELS: Record<KycDocType, string> = {
  PAN: 'PAN card',
  AADHAAR: 'Aadhaar card (masked)',
  CANCELLED_CHEQUE: 'Cancelled cheque',
  PHOTO: 'Photograph',
  GST_CERTIFICATE: 'GST certificate',
};
export const KYC_DOC_HINTS: Record<KycDocType, string> = {
  PAN: 'Clear copy of the PAN card',
  AADHAAR: 'Upload the masked Aadhaar (first 8 digits hidden), as UIDAI advises',
  CANCELLED_CHEQUE: 'Cheque of the bank account payouts will be paid into',
  PHOTO: 'Recent passport-size photograph',
  GST_CERTIFICATE: 'Needed only when the partner is GST registered',
};
export function requiredKycDocs(gstApplicable: boolean): KycDocType[] {
  return gstApplicable ? [...KYC_DOC_TYPES] : KYC_DOC_TYPES.filter((t) => t !== 'GST_CERTIFICATE');
}

export const PROJECT_TYPES = ['RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];
export const UNIT_TYPES = ['FLAT', 'PLOT', 'BUNGALOW', 'OFFICE', 'SHOP', 'SHED', 'HOUSE'] as const;
export type UnitType = (typeof UNIT_TYPES)[number];
export const MEASUREMENT_UNITS = ['SQFT', 'SQYD', 'SBA', 'CARPET'] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];
export const MEASUREMENT_UNIT_LABELS: Record<MeasurementUnit, string> = {
  SQFT: 'Sq. Ft.',
  SQYD: 'Sq. Yard',
  SBA: 'SBA',
  CARPET: 'Carpet',
};

export const OTP_PURPOSES = ['ACTIVATE', 'RESET_PASSWORD'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_TRANSITION',
  'KYC_NOT_APPROVED',
  'DUPLICATE_SUSPECTED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  PENDING_ACTIVATION: 'Not activated',
  ACTIVE: 'Active',
  BLOCKED: 'Blocked',
  SUSPENDED: 'Suspended',
  DEACTIVATED: 'Deactivated (inactive)',
};

/**
 * Partner inactivity rule. "Business" is a new case login or a payout. Days are
 * counted from the later of the last business, account activation and reactivation.
 */
export const INACTIVITY = {
  /** Shown on the Inactive Partners screen as "slowing down". */
  WATCH_DAYS: 30,
  /** Admin and Executives are alerted once per inactive spell. */
  ALERT_DAYS: 60,
  /** The partner code is deactivated automatically; only Admin can reactivate. */
  DEACTIVATE_DAYS: 90,
} as const;

/** Insurance commission Rupeemap receives. Rupeemap keeps 100%; it is never part of partner payouts. */
export const INSURANCE_PAYOUT_STATUSES = ['PENDING', 'CONFIRMED', 'RECEIVED', 'HOLD'] as const;
export type InsurancePayoutStatus = (typeof INSURANCE_PAYOUT_STATUSES)[number];
export const INSURANCE_PAYOUT_LABELS: Record<InsurancePayoutStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  RECEIVED: 'Received',
  HOLD: 'Hold',
};
export const INSURANCE_PAYOUT_TRANSITIONS: Record<InsurancePayoutStatus, InsurancePayoutStatus[]> = {
  PENDING: ['CONFIRMED', 'HOLD'],
  CONFIRMED: ['RECEIVED', 'HOLD', 'PENDING'],
  HOLD: ['PENDING', 'CONFIRMED'],
  RECEIVED: [],
};

/** Recovery (clawback) workflow, PART 35–37. Receipts move DEMAND_RAISED → PARTIALLY/FULLY_RECOVERED automatically. */
export const RECOVERY_STATUSES = [
  'RECOVERY_PENDING',
  'BANK_RECOVERY_RECEIVED',
  'DEMAND_RAISED',
  'PARTIALLY_RECOVERED',
  'FULLY_RECOVERED',
  'DISPUTED',
  'WAIVED',
  'CLOSED',
] as const;
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];
export const RECOVERY_STATUS_LABELS: Record<RecoveryStatus, string> = {
  RECOVERY_PENDING: 'Recovery pending',
  BANK_RECOVERY_RECEIVED: 'Bank recovery received',
  DEMAND_RAISED: 'Demand raised',
  PARTIALLY_RECOVERED: 'Partially recovered',
  FULLY_RECOVERED: 'Fully recovered',
  DISPUTED: 'Disputed',
  WAIVED: 'Waived',
  CLOSED: 'Closed',
};

export const RECOVERY_ACTIONS = {
  BANK_RECEIVED: { label: 'Bank recovery received', from: ['RECOVERY_PENDING'], to: 'BANK_RECOVERY_RECEIVED', adminOnly: false },
  RAISE_DEMAND: { label: 'Raise demand to partner', from: ['RECOVERY_PENDING', 'BANK_RECOVERY_RECEIVED'], to: 'DEMAND_RAISED', adminOnly: false },
  DISPUTE: { label: 'Mark disputed', from: ['DEMAND_RAISED', 'PARTIALLY_RECOVERED'], to: 'DISPUTED', adminOnly: false },
  REJECT_DISPUTE: { label: 'Dispute rejected, demand stands', from: ['DISPUTED'], to: 'DEMAND_RAISED', adminOnly: false },
  WAIVE: { label: 'Waive', from: ['RECOVERY_PENDING', 'BANK_RECOVERY_RECEIVED', 'DEMAND_RAISED', 'PARTIALLY_RECOVERED', 'DISPUTED'], to: 'WAIVED', adminOnly: true },
  CLOSE: { label: 'Close', from: ['FULLY_RECOVERED', 'WAIVED'], to: 'CLOSED', adminOnly: false },
} as const satisfies Record<string, { label: string; from: readonly RecoveryStatus[]; to: RecoveryStatus; adminOnly: boolean }>;
export type RecoveryAction = keyof typeof RECOVERY_ACTIONS;

/** Raise Query (PART 45) and Need Assistance (PART 46). */
export const TICKET_KINDS = ['QUERY', 'ASSISTANCE'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];
export const TICKET_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  WAITING: 'Waiting for you',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const QUERY_CATEGORIES = ['CASE', 'PAYOUT', 'RECOVERY', 'BANK', 'PROJECT', 'TECHNICAL', 'GENERAL'] as const;
export const ASSISTANCE_TYPES = ['DOCUMENTS', 'BANK_LOGIN', 'SANCTION_DELAY', 'DISBURSEMENT', 'VALUATION_LEGAL', 'PAYOUT', 'OTHER'] as const;
export const TICKET_CATEGORY_LABELS: Record<string, string> = {
  CASE: 'Case',
  PAYOUT: 'Payout',
  RECOVERY: 'Recovery',
  BANK: 'Bank',
  PROJECT: 'Project',
  TECHNICAL: 'Technical / app',
  GENERAL: 'General',
  DOCUMENTS: 'Documents',
  BANK_LOGIN: 'Bank login / file',
  SANCTION_DELAY: 'Sanction delay',
  DISBURSEMENT: 'Disbursement',
  VALUATION_LEGAL: 'Valuation / legal',
  OTHER: 'Other',
};
