import type { PrismaClient } from '@prisma/client';

/**
 * Standard document checklists per customer profile (all banks, all loan types).
 * They combine with "Basic KYC (all loans)" and any bank / loan-type checklist.
 * Admin can edit or switch any of them off under Checklist → Manage checklists.
 */
export const PROFILE_CHECKLISTS: { profile: string; name: string; items: [string, boolean, string?][] }[] = [
  {
    profile: 'SALARIED',
    name: 'Salaried: income documents',
    items: [
      ['Salary slips (last 3 months)', true],
      ['Salary account statement (last 6 months)', true, 'Showing salary credits'],
      ['Form 16 (last 2 years)', true],
      ['ITR (last 2 years)', false, 'If filed'],
      ['Appointment / offer letter or employment certificate', true, 'Current employer'],
      ['Employee ID card', false],
      ['Increment / promotion letter', false, 'If salary changed recently'],
    ],
  },
  {
    profile: 'SENP',
    name: 'SENP (business): income and business documents',
    items: [
      ['ITR with computation of income (last 3 years)', true],
      ['Balance sheet and P&L, CA certified (last 3 years)', true],
      ['Business proof: GST / Shop Act / Udyam registration', true],
      ['Business vintage proof (3+ years)', true, 'Older registration or licence'],
      ['Current account statement (last 12 months)', true],
      ['Savings account statement (last 6 months)', true],
      ['GST returns (last 12 months)', false, 'If GST registered'],
      ['Partnership deed / MOA & AOA', false, 'For a firm or company'],
      ['Office address proof', true],
    ],
  },
  {
    profile: 'SEP',
    name: 'SEP (professional): qualification and income documents',
    items: [
      ['Highest professional degree certificate', true, 'MBBS / MD, CA, architect, etc.'],
      ['Professional registration certificate', true, 'MCI / ICAI / COA or equivalent'],
      ['ITR with computation of income (last 2–3 years)', true],
      ['Balance sheet and P&L (last 2 years)', true, 'CA certified, if applicable'],
      ['Bank statements (last 12 months)', true, 'Practice and savings accounts'],
      ['Clinic / office address proof', true],
      ['GST registration', false, 'If registered'],
    ],
  },
  {
    profile: 'NRI',
    name: 'NRI: overseas income and identity',
    items: [
      ['Passport with valid visa / work permit', true],
      ['Overseas employment contract or letter', true],
      ['Salary slips (last 3 months)', true],
      ['Overseas bank statement (last 6 months)', true, 'Showing salary credits'],
      ['NRE / NRO account statement (last 6 months)', true],
      ['Overseas address proof', true],
      ['Power of attorney (if the applicant is abroad)', false, 'Attested by the Indian embassy'],
      ['Continuous discharge certificate (seafarers)', false],
    ],
  },
];

/**
 * Salaried-only documents that the original "Home Loan" checklist listed for everyone.
 * The Salaried profile checklist now carries them, so they are switched off there
 * (switched off, not deleted, so progress already marked on cases is kept).
 */
const MOVED_TO_SALARIED: { template: string; items: string[] }[] = [
  { template: 'Home Loan: income and property', items: ['Salary slips (last 3 months)', 'Form 16 / ITR (last 2 years)'] },
];

/** Adds any profile checklist that does not exist yet (matched by name). Safe to run again. */
export async function seedProfileChecklists(prisma: PrismaClient, createdById: string) {
  for (const m of MOVED_TO_SALARIED) {
    await prisma.checklistTemplateItem.updateMany({
      where: { name: { in: m.items }, active: true, template: { name: m.template, profile: null } },
      data: { active: false },
    });
  }
  // The Pensioner profile was withdrawn (Oct 2026): switch its checklist off, keep the record.
  await prisma.checklistTemplate.updateMany({ where: { profile: 'PENSIONER', deletedAt: null, active: true }, data: { active: false } });
  let added = 0;
  for (const t of PROFILE_CHECKLISTS) {
    const exists = await prisma.checklistTemplate.findFirst({ where: { name: t.name, deletedAt: null } });
    if (exists) continue;
    await prisma.checklistTemplate.create({
      data: {
        name: t.name,
        profile: t.profile,
        createdById,
        items: { create: t.items.map(([name, required, hint], n) => ({ name, required, hint, sortOrder: n })) },
      },
    });
    added++;
  }
  return added;
}
