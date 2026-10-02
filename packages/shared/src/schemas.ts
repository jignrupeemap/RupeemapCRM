import { z } from 'zod';
import { CUSTOMER_PROFILES, MEASUREMENT_UNITS, PAYOUT_STATUSES, PROJECT_TYPES, UNIT_TYPES } from './enums';

const blankToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

export const mobileSchema = z
  .string({ required_error: 'Mobile number is required' })
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'));

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number')
  .refine((p) => !COMMON_PASSWORDS.has(p.toLowerCase().replace(/[^a-z0-9]/g, '')), 'This password is too common. Choose something harder to guess')
  .refine((p) => !/^(.)\1+$/.test(p.replace(/\d+$/, '')) && !/^(0123|1234|2345|abcd)/i.test(p), 'This password is too easy to guess');

/** Passwords attackers try first (compared ignoring case and symbols). */
const COMMON_PASSWORDS = new Set([
  'password1', 'password12', 'password123', 'passw0rd', 'passw0rd1', 'admin123', 'admin1234', 'welcome1', 'welcome123',
  'qwerty123', 'qwerty1234', 'abc12345', 'abcd1234', 'india123', 'india1234', 'iloveyou1', 'letmein1', 'test1234',
  'rupeemap1', 'rupeemap12', 'rupeemap123', 'rupeemap2026', 'loan12345', 'dsa12345', 'mumbai123', 'ahmedabad1',
]);

export const loginSchema = z.object({
  login: z.string().trim().min(1, 'Enter your mobile number or username').max(64),
  password: z.string().min(1, 'Enter your password').max(128),
});

export const otpRequestSchema = z.object({
  mobile: mobileSchema,
  purpose: z.enum(['ACTIVATE', 'RESET_PASSWORD']),
});

export const otpVerifySchema = z.object({
  mobile: mobileSchema,
  purpose: z.enum(['ACTIVATE', 'RESET_PASSWORD']),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit OTP'),
});

export const setPasswordSchema = z.object({
  token: z.string().min(20),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const createPartnerSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(120),
  mobile: mobileSchema,
  email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
});

export const createUserSchema = createPartnerSchema.extend({
  role: z.enum(['DSA', 'TEAM_PARTNER', 'EXECUTIVE']),
  dsaId: z.string().uuid().optional(),
  payoutPercent: z.coerce.number().min(0).max(100).optional(),
});

export const userStatusActionSchema = z.object({
  action: z.enum(['BLOCK', 'UNBLOCK', 'SUSPEND', 'ACTIVATE']),
  reason: z.string().trim().min(3, 'Enter a reason').max(500),
});

export const payoutRateSchema = z.object({
  percent: z.coerce.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100%'),
  effectiveFrom: z.coerce.date(),
  reason: z.string().trim().min(3, 'Enter a reason').max(500),
});

export const createCaseSchema = z.object({
  customerName: z.string().trim().min(2, 'Enter the customer name').max(120),
  customerMobile: mobileSchema.optional().or(z.literal('').transform(() => undefined)),
  customerPan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN like ABCDE1234F')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  coApplicantName: z.string().trim().max(120).optional(),
  customerProfile: z.enum(CUSTOMER_PROFILES).optional().or(z.literal('').transform(() => undefined)),
  loanType: z.string().trim().min(1, 'Choose a loan type'),
  appliedAmount: z.coerce.number({ invalid_type_error: 'Enter the loan amount' }).positive('Enter the loan amount').max(1e12),
  bankId: z.string().uuid('Choose a bank'),
  projectId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  salesManagerName: z.string().trim().max(120).optional(),
  salesManagerId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)),
  remarks: z.string().trim().max(1000).optional(),
  /** DSA can file a case on behalf of a Team Partner in their team; Admin/Executive must pick a DSA. */
  dsaId: z.string().uuid().optional(),
  teamPartnerId: z.string().uuid().optional(),
  acknowledgeDuplicate: z.boolean().optional(),
});
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

export const caseTransitionSchema = z.object({
  action: z.string(),
  version: z.number().int().nonnegative(),
  data: z.record(z.any()).default({}),
});

export const caseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  status: z.string().optional(),
  loanType: z.string().optional(),
  bankId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  dsaId: z.string().uuid().optional(),
  teamPartnerId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** "1" = open cases that have not moved stage for STUCK_CASE_DAYS or more (same rule as the dashboard). */
  stuck: z.enum(['1']).optional(),
  /** "1" = part-disbursed cases still waiting for full disbursement. */
  partPayment: z.enum(['1']).optional(),
});

/** An open case counts as stuck after this many days in one stage. */
export const STUCK_CASE_DAYS = 15;
export const STUCK_CASE_STATUSES = ['LOGIN', 'SANCTION', 'DISBURSED', 'QUERY'] as const;

export const projectSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the project name').max(160),
    city: z.string().trim().min(2, 'Enter the city').max(80),
    locality: z.string().trim().max(120).optional().default(''),
    state: z.string().trim().min(2, 'Enter the state').max(80),
    reraNumber: z.string().trim().max(60).optional().or(z.literal('').transform(() => undefined)),
    projectType: z.enum(PROJECT_TYPES),
    unitTypes: z.array(z.enum(UNIT_TYPES)).min(1, 'Choose at least one unit type'),
    priceMin: z.coerce.number().nonnegative().optional(),
    priceMax: z.coerce.number().nonnegative().optional(),
    measurementUnit: z.enum(MEASUREMENT_UNITS).optional(),
    active: z.boolean().default(true),
  })
  .refine((p) => p.priceMin == null || p.priceMax == null || p.priceMin <= p.priceMax, {
    message: 'Minimum price cannot be more than maximum',
    path: ['priceMax'],
  });

export const payoutUpdateSchema = z.object({
  status: z.enum(PAYOUT_STATUSES),
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(3, 'Enter a reason').max(500),
  paymentRef: z.string().trim().max(80).optional(),
  paidOn: z.coerce.date().optional(),
});

export const bankReceiptSchema = z.object({
  version: z.number().int().nonnegative(),
  amount: z.coerce.number().positive(),
  receivedOn: z.coerce.date(),
  reason: z.string().trim().min(3).max(500),
});

/** Normalised key for duplicate-safe project names ("Shivalik  Park-2" → "shivalik park 2"). */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const optionalId = z.string().uuid().optional().or(z.literal('').transform(() => undefined)).nullable();

export const checklistTemplateSchema = z.object({
  name: z.string().trim().min(2, 'Enter a checklist name').max(120),
  bankId: optionalId,
  loanType: z.string().trim().max(40).optional().or(z.literal('').transform(() => undefined)).nullable(),
  projectId: optionalId,
  /** Blank = every customer profile. */
  profile: z.enum(CUSTOMER_PROFILES).optional().or(z.literal('').transform(() => undefined)).nullable(),
  product: z.string().trim().max(80).optional().or(z.literal('').transform(() => undefined)).nullable(),
  active: z.boolean().default(true),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(2, 'Enter the document name').max(120),
        required: z.boolean().default(true),
        hint: z.string().trim().max(200).optional().or(z.literal('').transform(() => undefined)),
        active: z.boolean().default(true),
      }),
    )
    .min(1, 'Add at least one document')
    .max(80),
});
export type ChecklistTemplateInput = z.infer<typeof checklistTemplateSchema>;

export const caseProfileSchema = z.object({ customerProfile: z.enum(CUSTOMER_PROFILES).nullable() });

export const CHECKLIST_ITEM_STATUSES = ['PENDING', 'RECEIVED', 'NOT_APPLICABLE'] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

export const caseChecklistUpdateSchema = z.object({
  status: z.enum(CHECKLIST_ITEM_STATUSES),
  remarks: z.string().trim().max(300).optional(),
});

/** A blank form field means "not given", never 0. */
const optionalMoney = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().nonnegative('Cannot be negative').max(1e12).optional());

const optionalText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

export const insurancePolicySchema = z.object({
  companyName: z.string().trim().min(2, 'Enter the insurance company').max(120),
  productName: optionalText(120),
  policyNumber: optionalText(60),
  insuranceAmount: z.coerce.number({ invalid_type_error: 'Enter the insurance amount' }).positive('Enter the insurance amount').max(1e12),
  premiumAmount: optionalMoney,
  managerName: optionalText(120),
  managerMobile: mobileSchema.optional().or(z.literal('').transform(() => undefined)),
  managerEmail: z.string().trim().email('Enter a valid email').optional().or(z.literal('').transform(() => undefined)),
  remarks: optionalText(1000),
  /** Rupeemap's commission on this policy (optional when adding; can be set later). */
  payoutAmount: optionalMoney,
});
export type InsurancePolicyInput = z.infer<typeof insurancePolicySchema>;

export const insurancePayoutUpdateSchema = z
  .object({
    version: z.number().int().nonnegative(),
    amount: z.number().nonnegative().max(1e12).optional(),
    status: z.enum(['PENDING', 'CONFIRMED', 'RECEIVED', 'HOLD']).optional(),
    receivedOn: z.coerce.date().optional(),
    reference: z.string().trim().max(80).optional(),
    reason: z.string().trim().min(3, 'Enter a reason').max(500),
  })
  .refine((v) => v.amount !== undefined || v.status !== undefined, { message: 'Change the amount or the status', path: ['status'] });

export const recoveryCreateSchema = z.object({
  payoutId: z.string().uuid('Choose the payout'),
  recoveryAmount: z.coerce.number({ invalid_type_error: 'Enter the amount the bank recovered' }).positive('Enter the amount the bank recovered').max(1e12),
  recoveryDate: z.coerce.date({ invalid_type_error: 'Enter the recovery date' }),
  bankRemarks: z.string().trim().max(1000).optional().or(z.literal('').transform(() => undefined)),
  reason: z.string().trim().min(3, 'Enter the recovery reason').max(500),
});

export const recoveryActionSchema = z.object({
  action: z.enum(['BANK_RECEIVED', 'RAISE_DEMAND', 'DISPUTE', 'REJECT_DISPUTE', 'WAIVE', 'CLOSE']),
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(3, 'Enter a reason').max(500),
  amountDemanded: z.coerce.number().positive().max(1e12).optional(),
  dueDate: z.coerce.date().optional(),
});

const optionalStr = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const optionalDate = z.preprocess(blankToUndefined, z.coerce.date().optional());

export const bankerSchema = z.object({
  bankId: z.string().uuid('Choose the bank'),
  designationId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  name: z.string().trim().min(2, 'Enter the banker name').max(120),
  mobile: z.preprocess(blankToUndefined, mobileSchema.optional()),
  email: z.preprocess(blankToUndefined, z.string().trim().email('Enter a valid email').optional()),
  branch: optionalStr(120),
  city: optionalStr(80),
  region: optionalStr(80),
  product: optionalStr(80),
  active: z.boolean().default(true),
  visibleToPartners: z.boolean().default(true),
});
export type BankerInput = z.infer<typeof bankerSchema>;

export const bankerShareSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Choose at least one banker').max(50),
  channel: z.enum(['WHATSAPP', 'EMAIL']),
  /** Optional recipient: a mobile for WhatsApp or an email address. Blank lets the sender pick a contact. */
  to: optionalStr(120),
});

export const bankCodeSchema = z
  .object({
    bankId: z.string().uuid('Choose the bank'),
    product: z.string().trim().min(2, 'Enter the product').max(80),
    code: z.string().trim().min(1, 'Enter the code').max(60),
    city: optionalStr(80),
    region: optionalStr(80),
    branch: optionalStr(120),
    effectiveFrom: optionalDate,
    expiresOn: optionalDate,
    active: z.boolean().default(true),
    remarks: optionalStr(500),
    visibleToPartners: z.boolean().default(true),
  })
  .refine((v) => !v.effectiveFrom || !v.expiresOn || v.effectiveFrom <= v.expiresOn, { message: 'Expiry must be after the effective date', path: ['expiresOn'] });
export type BankCodeInput = z.infer<typeof bankCodeSchema>;

export const recoveryReceiptSchema = z.object({
  version: z.number().int().nonnegative(),
  amount: z.coerce.number({ invalid_type_error: 'Enter the amount received' }).positive('Enter the amount received').max(1e12),
  receivedOn: z.coerce.date(),
  reference: z.string().trim().max(80).optional().or(z.literal('').transform(() => undefined)),
});

/** Admin / Executive sends recovery details to the partner concerned and/or their DSA. */
export const RECOVERY_MESSAGE_CHANNELS = ['NOTIFICATION', 'WHATSAPP', 'EMAIL'] as const;
export const recoveryMessageSchema = z.object({
  channel: z.enum(RECOVERY_MESSAGE_CHANNELS),
  to: z.array(z.enum(['PARTNER', 'DSA'])).min(1, 'Choose who receives it').max(2),
  note: z.string().trim().max(500).optional().or(z.literal('').transform(() => undefined)),
});

export const ticketCreateSchema = z
  .object({
    kind: z.enum(['QUERY', 'ASSISTANCE']),
    category: z.string().trim().min(1, 'Choose a category').max(40),
    caseId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
    subject: z.string().trim().min(3, 'Enter a short subject').max(160),
    description: z.string().trim().min(3, 'Describe the problem').max(4000),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  })
  .refine((v) => v.kind !== 'ASSISTANCE' || !!v.caseId, { message: 'Choose the case you need help with', path: ['caseId'] });

export const ticketReplySchema = z.object({
  body: z.string().trim().min(1, 'Write a message').max(4000),
  internal: z.boolean().default(false),
});

export const ticketUpdateSchema = z.object({
  version: z.number().int().nonnegative(),
  status: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']).optional(),
  assignedToId: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  note: z.string().trim().max(1000).optional(),
});
