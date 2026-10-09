import type { PrismaClient } from '@prisma/client';

/**
 * Checklist page lists: one per loan family (HL/LAP, Business Loan, Used Car Loan) and
 * customer profile (Salaried, SENP, SEP, NRI), each grouped into sections.
 * Admin edits them on the Checklist page; these are only the starting point.
 */
type Doc = [section: string, name: string, required: boolean, hint?: string];

const KYC: Doc[] = [
  ['KYC', 'PAN card', true],
  ['KYC', 'Aadhaar card', true],
  ['KYC', 'Passport-size photographs (2)', true],
  ['KYC', 'Current address proof', true, 'Electricity bill, rent agreement or passport'],
];
const NRI_KYC: Doc[] = [
  ['KYC', 'Passport with valid visa / work permit', true],
  ['KYC', 'PAN card', true],
  ['KYC', 'Passport-size photographs (2)', true],
  ['KYC', 'Overseas address proof', true],
];
const SALARIED_INCOME: Doc[] = [
  ['INCOME', 'Salary slips (last 3 months)', true],
  ['INCOME', 'Salary account statement (last 6 months)', true],
  ['INCOME', 'Form 16 (last 2 years)', true],
  ['INCOME', 'Appointment letter / employment certificate', true, 'Current employer'],
];
const SENP_PROOF: Doc[] = [
  ['BUSINESS_PROOF', 'GST registration / Shop Act / Udyam certificate', true],
  ['BUSINESS_PROOF', 'Business vintage proof (3+ years)', true, 'Older registration or licence'],
  ['BUSINESS_PROOF', 'Office address proof', true],
  ['BUSINESS_PROOF', 'Partnership deed / MOA & AOA', false, 'For a firm or company'],
];
const SENP_INCOME: Doc[] = [
  ['INCOME', 'ITR with computation of income (last 3 years)', true],
  ['INCOME', 'CA-certified P&L and balance sheet (last 3 years)', true],
  ['INCOME', 'Current account statement (last 12 months)', true],
  ['INCOME', 'Savings account statement (last 6 months)', true],
  ['INCOME', 'GST returns (last 12 months)', false, 'If GST registered'],
];
const SEP_PROOF: Doc[] = [
  ['BUSINESS_PROOF', 'Professional degree certificate', true, 'MBBS / MD, CA, architect, etc.'],
  ['BUSINESS_PROOF', 'Professional registration certificate', true, 'MCI / ICAI / COA or equivalent'],
  ['BUSINESS_PROOF', 'Clinic / office address proof', true],
];
const SEP_INCOME: Doc[] = [
  ['INCOME', 'ITR with computation of income (last 2–3 years)', true],
  ['INCOME', 'P&L and balance sheet (last 2 years)', true, 'CA certified, if applicable'],
  ['INCOME', 'Bank statements (last 12 months)', true, 'Practice and savings accounts'],
];
const NRI_INCOME: Doc[] = [
  ['INCOME', 'Overseas employment contract / letter', true],
  ['INCOME', 'Salary slips (last 3 months)', true],
  ['INCOME', 'Overseas bank statement (last 6 months)', true],
  ['INCOME', 'NRE / NRO account statement (last 6 months)', true],
  ['OTHER', 'Power of attorney (if the applicant is abroad)', false, 'Attested by the Indian embassy'],
];
const EXISTING_LOANS: Doc[] = [
  ['EXISTING_LOAN', 'Sanction letters of running loans', false, 'If any loan is running'],
  ['EXISTING_LOAN', 'Loan account statements (last 12 months)', false, 'Showing EMIs paid'],
  ['EXISTING_LOAN', 'Foreclosure letter / NOC for closed loans', false],
];
const PROPERTY: Doc[] = [
  ['PROPERTY', 'Sale agreement / allotment letter', true],
  ['PROPERTY', 'Title chain documents', true, 'Previous sale deeds'],
  ['PROPERTY', 'Approved building plan', true],
  ['PROPERTY', 'Latest property tax receipt', true],
  ['PROPERTY', 'Society NOC / share certificate', false],
  ['PROPERTY', 'Own contribution receipts', false],
];
const VEHICLE: Doc[] = [
  ['VEHICLE', 'RC (registration certificate) of the car', true],
  ['VEHICLE', 'Valuation report', true],
  ['VEHICLE', 'Current insurance policy', true],
  ['VEHICLE', "Seller's KYC", true],
  ['VEHICLE', 'Quotation / sale agreement', true],
];

const BY_PROFILE: Record<string, Doc[]> = {
  SALARIED: [...KYC, ...SALARIED_INCOME],
  SENP: [...KYC, ...SENP_PROOF, ...SENP_INCOME],
  SEP: [...KYC, ...SEP_PROOF, ...SEP_INCOME],
  NRI: [...NRI_KYC, ...NRI_INCOME],
};
const GROUPS: { group: string; label: string; extra: Doc[] }[] = [
  { group: 'HL_LAP', label: 'HL / LAP', extra: [...EXISTING_LOANS, ...PROPERTY] },
  { group: 'BUSINESS', label: 'Business Loan', extra: EXISTING_LOANS },
  { group: 'USED_CAR', label: 'Used Car Loan', extra: [...EXISTING_LOANS, ...VEHICLE] },
];
const PROFILE_NAMES: Record<string, string> = { SALARIED: 'Salaried', SENP: 'SENP', SEP: 'SEP', NRI: 'NRI' };

/** Older lists the Checklist page no longer uses (switched off, kept on record). */
const RETIRED = [
  'Basic KYC (all loans)',
  'HDFC Bank: additional',
  'Home Loan: income and property',
  'Business Loan: business proof',
  'Salaried: income documents',
  'SENP (business): income and business documents',
  'SEP (professional): qualification and income documents',
  'NRI: overseas income and identity',
  'Pensioner: pension documents',
];

/** Adds any missing loan × profile list and switches off the retired ones. Safe to run again. */
export async function seedLoanChecklists(prisma: PrismaClient, createdById: string) {
  await prisma.checklistTemplate.updateMany({ where: { name: { in: RETIRED }, loanGroup: null, active: true }, data: { active: false } });
  let added = 0;
  for (const g of GROUPS) {
    for (const [profile, docs] of Object.entries(BY_PROFILE)) {
      const exists = await prisma.checklistTemplate.findFirst({ where: { loanGroup: g.group, profile, deletedAt: null } });
      if (exists) continue;
      const all = [...docs, ...g.extra];
      await prisma.checklistTemplate.create({
        data: {
          name: `${g.label}: ${PROFILE_NAMES[profile]}`,
          loanGroup: g.group,
          profile,
          createdById,
          items: { create: all.map(([section, name, required, hint], n) => ({ section, name, required, hint, sortOrder: n })) },
        },
      });
      added++;
    }
  }
  return added;
}
