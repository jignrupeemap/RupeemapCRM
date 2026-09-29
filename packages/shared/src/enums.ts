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

export const DISBURSEMENT_TYPES = ['PART', 'PART_TO_FULL', 'FULL'] as const;
export type DisbursementType = (typeof DISBURSEMENT_TYPES)[number];
export const DISBURSEMENT_TYPE_LABELS: Record<DisbursementType, string> = {
  PART: 'Part Payment',
  PART_TO_FULL: 'Part to Full',
  FULL: 'Full',
};

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
