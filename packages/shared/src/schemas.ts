import { z } from 'zod';
import { MEASUREMENT_UNITS, PAYOUT_STATUSES, PROJECT_TYPES, UNIT_TYPES } from './enums';

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
  .regex(/\d/, 'Include at least one number');

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
});

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

export const CHECKLIST_ITEM_STATUSES = ['PENDING', 'RECEIVED', 'NOT_APPLICABLE'] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

export const caseChecklistUpdateSchema = z.object({
  status: z.enum(CHECKLIST_ITEM_STATUSES),
  remarks: z.string().trim().max(300).optional(),
});
