import type { Role } from './enums';

/**
 * Permission codes checked by the API. The UI only uses them to hide controls;
 * the server re-checks every one of them.
 */
export const PERMISSIONS = {
  USER_CREATE_DSA: 'Create DSA Partners',
  USER_CREATE_TEAM_PARTNER: 'Create Team Partners',
  USER_CREATE_EXECUTIVE: 'Create Admin Executives',
  USER_VIEW: 'View users',
  USER_RESET_PASSWORD: 'Reset user passwords',
  USER_BLOCK: 'Block, unblock and suspend users',
  USER_DELETE: 'Delete users (soft)',
  USER_PROMOTE: 'Promote Team Partner to DSA',
  PERMISSION_MANAGE: 'Manage executive permissions',

  CASE_CREATE: 'Create cases',
  CASE_VIEW_OWN: 'View own cases',
  CASE_VIEW_TEAM: 'View team cases',
  CASE_VIEW_ALL: 'View all cases',
  CASE_UPDATE: 'Edit case details',
  CASE_STATUS_CHANGE: 'Change case status',
  CASE_FINANCIAL_CORRECTION: 'Correct sanction, disbursed and handover amounts',
  CASE_REOPEN: 'Reopen rejected or withdrawn cases',

  PAYOUT_VIEW: 'View payouts',
  PAYOUT_UPDATE: 'Change payout status and amount',
  PAYOUT_MARK_BANK_RECEIVED: 'Mark payout received from bank',
  PAYOUT_PERCENTAGE_UPDATE_DSA: 'Set DSA payout percentage',
  PAYOUT_PERCENTAGE_UPDATE_TEAM: 'Set Team Partner payout percentage',

  KYC_VIEW: 'View first payout KYC',
  KYC_UPLOAD: 'Upload first payout KYC documents',
  KYC_VERIFY: 'Verify first payout KYC (final)',

  INSURANCE_VIEW: 'View insurance',
  INSURANCE_UPDATE: 'Add and update insurance',
  RECOVERY_VIEW: 'View recovery',
  RECOVERY_UPDATE: 'Record recovery and raise demands',
  WHATSAPP_SEND: 'Send WhatsApp messages',

  PROJECT_VIEW: 'View Project Master',
  PROJECT_MANAGE: 'Add, edit and deactivate projects',
  PROJECT_DELETE: 'Delete projects',
  CHECKLIST_VIEW: 'View checklists',
  CHECKLIST_MANAGE: 'Manage checklists',
  BANK_VIEW: 'View banks',
  BANK_MANAGE: 'Manage banks',
  BANK_CODE_VIEW: 'View Bankwise Codes',
  BANK_CODE_MANAGE: 'Manage Bankwise Codes',
  BANKER_VIEW: 'View banker directory',
  BANKER_MANAGE: 'Add and edit bankers',
  BANKER_DELETE: 'Delete bankers',
  BANKER_SHARE: 'Share banker details',

  QUERY_CREATE: 'Raise queries',
  QUERY_ANSWER: 'Answer and assign queries',
  SUPPORT_CREATE: 'Request assistance',
  SUPPORT_HANDLE: 'Handle assistance requests',

  NOTIFICATION_SEND_BROADCAST: 'Send notifications to groups',
  NOTIFICATION_SEND_INDIVIDUAL: 'Send notifications to one user',
  SLIDER_MANAGE: 'Manage dashboard sliders',
  REPORT_VIEW: 'View reports',
  REPORT_EXPORT: 'Export reports',
  GLOBAL_SEARCH: 'Global search',
  AUDIT_VIEW: 'View audit log',
  SETTINGS_MANAGE: 'Manage master data and settings',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** Permissions a DSA or Team Partner can never receive, whatever the configuration. */
export const PARTNER_FORBIDDEN: Permission[] = [
  'PAYOUT_UPDATE',
  'PAYOUT_MARK_BANK_RECEIVED',
  'PAYOUT_PERCENTAGE_UPDATE_DSA',
  'KYC_UPLOAD',
  'KYC_VERIFY',
  'INSURANCE_UPDATE',
  'RECOVERY_UPDATE',
  'CASE_FINANCIAL_CORRECTION',
  'CASE_VIEW_ALL',
  'USER_CREATE_DSA',
  'USER_CREATE_EXECUTIVE',
  'USER_BLOCK',
  'USER_PROMOTE',
  'PERMISSION_MANAGE',
  'AUDIT_VIEW',
];

const PARTNER_COMMON: Permission[] = [
  'CASE_CREATE',
  'CASE_VIEW_OWN',
  'CASE_UPDATE',
  'CASE_STATUS_CHANGE',
  'PAYOUT_VIEW',
  'KYC_VIEW',
  'INSURANCE_VIEW',
  'RECOVERY_VIEW',
  'PROJECT_VIEW',
  'CHECKLIST_VIEW',
  'BANK_VIEW',
  'BANK_CODE_VIEW',
  'BANKER_VIEW',
  'QUERY_CREATE',
  'SUPPORT_CREATE',
  'REPORT_VIEW',
];

/** Executive defaults; Admin can switch each one on or off per executive. */
export const EXECUTIVE_DEFAULTS: Permission[] = [
  'USER_CREATE_TEAM_PARTNER',
  'PAYOUT_PERCENTAGE_UPDATE_TEAM',
  'USER_VIEW',
  'USER_RESET_PASSWORD',
  'USER_BLOCK',
  'CASE_CREATE',
  'CASE_VIEW_ALL',
  'CASE_UPDATE',
  'CASE_STATUS_CHANGE',
  'CASE_FINANCIAL_CORRECTION',
  'PAYOUT_VIEW',
  'PAYOUT_UPDATE',
  'PAYOUT_MARK_BANK_RECEIVED',
  'KYC_VIEW',
  'KYC_UPLOAD',
  'INSURANCE_VIEW',
  'INSURANCE_UPDATE',
  'RECOVERY_VIEW',
  'RECOVERY_UPDATE',
  'PROJECT_VIEW',
  'PROJECT_MANAGE',
  'CHECKLIST_VIEW',
  'BANK_VIEW',
  'BANK_CODE_VIEW',
  'BANK_CODE_MANAGE',
  'BANKER_VIEW',
  'BANKER_MANAGE',
  'BANKER_SHARE',
  'QUERY_CREATE',
  'QUERY_ANSWER',
  'SUPPORT_CREATE',
  'SUPPORT_HANDLE',
  'NOTIFICATION_SEND_INDIVIDUAL',
  'REPORT_VIEW',
  'REPORT_EXPORT',
  'GLOBAL_SEARCH',
];

export const ROLE_DEFAULT_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  EXECUTIVE: EXECUTIVE_DEFAULTS,
  DSA: [
    ...PARTNER_COMMON,
    'CASE_VIEW_TEAM',
    'USER_CREATE_TEAM_PARTNER',
    'USER_VIEW',
    'USER_RESET_PASSWORD',
    'PAYOUT_PERCENTAGE_UPDATE_TEAM',
    'REPORT_EXPORT', // own team's data only, like every report
  ],
  TEAM_PARTNER: PARTNER_COMMON,
};

/** Permissions Admin may toggle for an executive (Admin-only ones excluded). */
export const EXECUTIVE_CONFIGURABLE: Permission[] = ALL_PERMISSIONS.filter(
  (p) => !['USER_CREATE_EXECUTIVE', 'USER_PROMOTE', 'PERMISSION_MANAGE', 'KYC_VERIFY', 'USER_DELETE', 'PAYOUT_PERCENTAGE_UPDATE_DSA'].includes(p),
);

/**
 * Effective permissions = role defaults, then per-user grants/denials (executives only),
 * then the hard partner ceiling.
 */
export function effectivePermissions(
  role: Role,
  overrides: { permission: string; granted: boolean }[] = [],
): Permission[] {
  const set = new Set<Permission>(ROLE_DEFAULT_PERMISSIONS[role]);
  if (role === 'EXECUTIVE') {
    for (const o of overrides) {
      const p = o.permission as Permission;
      if (!EXECUTIVE_CONFIGURABLE.includes(p)) continue;
      if (o.granted) set.add(p);
      else set.delete(p);
    }
  }
  if (role === 'DSA' || role === 'TEAM_PARTNER') {
    for (const p of PARTNER_FORBIDDEN) set.delete(p);
  }
  return [...set];
}
