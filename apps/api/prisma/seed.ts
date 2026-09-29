/**
 * Development/staging seed: master data plus one demo user per role.
 * Demo password for every seeded user: Rupeemap@123 (development only).
 */
import { PrismaClient } from '@prisma/client';
import { hash, Algorithm } from '@node-rs/argon2';
import { DEFAULT_LOAN_TYPES, normalizeName } from '@rupeemap/shared';

const prisma = new PrismaClient();
const DEMO_PASSWORD = 'Rupeemap@123';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  const passwordHash = await hash(DEMO_PASSWORD, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

  for (const [i, lt] of DEFAULT_LOAN_TYPES.entries()) {
    await prisma.loanType.upsert({ where: { code: lt.code }, create: { ...lt, sortOrder: i }, update: {} });
  }

  const bankNames = [
    ['HDFC Bank', 'HDFC', false],
    ['ICICI Bank', 'ICICI', false],
    ['State Bank of India', 'SBI', false],
    ['Axis Bank', 'Axis', false],
    ['Kotak Mahindra Bank', 'Kotak', false],
    ['Bank of Baroda', 'BoB', false],
    ['LIC Housing Finance', 'LICHFL', true],
    ['Bajaj Housing Finance', 'Bajaj', true],
    ['Aditya Birla Capital', 'ABCL', true],
  ] as const;
  const banks = [];
  for (const [name, shortName, isNbfc] of bankNames) {
    banks.push(await prisma.bank.upsert({ where: { name }, create: { name, shortName, isNbfc }, update: {} }));
  }

  const designations = ['Sales Manager', 'Relationship Head', 'Zonal Head', 'Regional Head', 'National Head'];
  const des = [];
  for (const [level, name] of designations.entries()) {
    des.push(await prisma.bankerDesignation.upsert({ where: { name }, create: { name, level }, update: {} }));
  }

  const upsertUser = async (mobile: string, name: string, role: 'ADMIN' | 'EXECUTIVE' | 'DSA' | 'TEAM_PARTNER', username?: string) =>
    prisma.user.upsert({
      where: { mobile },
      create: { mobile, name, role, username, status: 'ACTIVE', mobileVerified: true, passwordHash },
      update: {},
    });

  const admin = await upsertUser('9000000001', 'Jignesh Patel', 'ADMIN', 'admin');
  const exec = await upsertUser('9000000002', 'Priya Shah', 'EXECUTIVE', 'priya');
  const dsa = await upsertUser('9000000003', 'Mehul Desai', 'DSA', 'mehul');
  const tp = await upsertUser('9000000004', 'Ravi Parmar', 'TEAM_PARTNER', 'ravi');
  const tp2 = await upsertUser('9000000005', 'Nisha Joshi', 'TEAM_PARTNER', 'nisha');

  const dsaProfile = await prisma.dsaPartner.upsert({
    where: { userId: dsa.id },
    create: { userId: dsa.id, code: 'DSA-0001', firmName: 'Desai Financial Services' },
    update: {},
  });
  for (const t of [tp, tp2]) {
    const has = await prisma.teamMembership.findFirst({ where: { userId: t.id, endedOn: null } });
    if (!has) await prisma.teamMembership.create({ data: { userId: t.id, dsaId: dsaProfile.id } });
  }
  for (const u of [dsa, tp, tp2]) {
    await prisma.kycProfile.upsert({ where: { userId: u.id }, create: { userId: u.id }, update: {} });
  }
  const rateExists = await prisma.payoutRate.count({ where: { userId: dsa.id } });
  if (!rateExists) {
    const from = new Date('2026-04-01');
    await prisma.payoutRate.createMany({
      data: [
        { userId: dsa.id, percent: 0.8, effectiveFrom: from, setById: admin.id, reason: 'Initial rate' },
        { userId: tp.id, percent: 0.5, effectiveFrom: from, setById: dsa.id, reason: 'Initial rate' },
        { userId: tp2.id, percent: 0.45, effectiveFrom: from, setById: dsa.id, reason: 'Initial rate' },
      ],
    });
  }

  const projects = [
    ['Shivalik Parkview', 'Ahmedabad', 'Bopal', 'Gujarat', 'PR/GJ/AHMEDABAD/AUDA/RAA01234/2024', 'RESIDENTIAL', ['FLAT'], 4500000, 9500000, 'SBA'],
    ['Goyal Orchid Greens', 'Ahmedabad', 'Shela', 'Gujarat', 'PR/GJ/AHMEDABAD/AUDA/RAA05678/2023', 'RESIDENTIAL', ['FLAT', 'BUNGALOW'], 6000000, 22000000, 'SBA'],
    ['Titanium Business Hub', 'Ahmedabad', 'Prahladnagar', 'Gujarat', 'PR/GJ/AHMEDABAD/AMC/CAA00987/2022', 'COMMERCIAL', ['OFFICE', 'SHOP'], 7500000, 35000000, 'CARPET'],
    ['Sanand Industrial Park', 'Sanand', 'Chharodi', 'Gujarat', null, 'INDUSTRIAL', ['SHED', 'PLOT'], 12000000, 60000000, 'SQYD'],
    ['Raghuvir Symphony', 'Surat', 'Vesu', 'Gujarat', 'PR/GJ/SURAT/SUDA/RAA04321/2024', 'RESIDENTIAL', ['FLAT'], 5200000, 12500000, 'SBA'],
  ] as const;
  const projectRows = [];
  for (const [name, city, locality, state, rera, projectType, unitTypes, priceMin, priceMax, measurementUnit] of projects) {
    projectRows.push(
      await prisma.project.upsert({
        where: { nameNormalized: normalizeName(name) },
        create: {
          name,
          nameNormalized: normalizeName(name),
          city,
          locality,
          state,
          reraNumber: rera,
          projectType,
          unitTypes: [...unitTypes],
          priceMin,
          priceMax,
          measurementUnit,
          createdById: admin.id,
        },
        update: {},
      }),
    );
  }

  if (!(await prisma.bankerContact.count())) {
    const people = [
      [0, 0, 'Kunal Mehta', '9824000011', 'kunal.mehta@hdfcbank.example', 'Navrangpura', 'Home Loan'],
      [0, 2, 'Sonal Trivedi', '9824000012', 'sonal.trivedi@hdfcbank.example', 'CG Road', 'Home Loan'],
      [1, 0, 'Amit Rana', '9824000013', 'amit.rana@icicibank.example', 'Satellite', 'Mortgage Loan'],
      [2, 0, 'Deepak Solanki', '9824000014', 'deepak.solanki@sbi.example', 'Ashram Road', 'Home Loan'],
      [6, 0, 'Hetal Pandya', '9824000015', 'hetal.pandya@lichfl.example', 'Ellisbridge', 'Home Loan'],
    ] as const;
    for (const [b, d, name, mobile, email, branch, product] of people) {
      await prisma.bankerContact.create({ data: { bankId: banks[b].id, designationId: des[d].id, name, mobile, email, branch, city: 'Ahmedabad', region: 'Gujarat', product } });
    }
  }

  if (!(await prisma.checklistTemplate.count())) {
    const templates: { name: string; loanType?: string; bankId?: string; items: [string, boolean, string?][] }[] = [
      {
        name: 'Basic KYC (all loans)',
        items: [
          ['PAN card', true],
          ['Aadhaar card', true],
          ['Passport-size photograph', true],
          ['Address proof', true, 'Electricity bill, rent agreement or passport'],
          ['Bank statement (last 6 months)', true],
        ],
      },
      {
        name: 'Home Loan: income and property',
        loanType: 'HOME_LOAN',
        items: [
          ['Salary slips (last 3 months)', false, 'Salaried applicants'],
          ['Form 16 / ITR (last 2 years)', true],
          ['Sale agreement / allotment letter', true],
          ['Approved building plan', false],
          ['Own contribution receipt', false],
        ],
      },
      {
        name: 'Business Loan: business proof',
        loanType: 'BUSINESS_LOAN',
        items: [
          ['GST registration', true],
          ['ITR with computation (last 3 years)', true],
          ['Audited balance sheet and P&L', true],
          ['Current account statement (12 months)', true],
        ],
      },
      {
        name: 'HDFC Bank: additional',
        bankId: banks[0].id,
        loanType: 'HOME_LOAN',
        items: [['HDFC application form signed', true], ['Processing fee cheque', true]],
      },
    ];
    for (const t of templates) {
      await prisma.checklistTemplate.create({
        data: {
          name: t.name,
          loanType: t.loanType,
          bankId: t.bankId,
          createdById: admin.id,
          items: { create: t.items.map(([name, required, hint], n) => ({ name, required, hint, sortOrder: n })) },
        },
      });
    }
  }

  if (!(await prisma.bankCode.count())) {
    const codes = [
      [0, 'Home Loan', 'HDFC-AHM-DSA-2231', 'Ahmedabad', 'Gujarat', 'Navrangpura'],
      [0, 'Loan Against Property', 'HDFC-AHM-LAP-0418', 'Ahmedabad', 'Gujarat', 'CG Road'],
      [1, 'Home Loan', 'ICICI-GJ-HL-7781', 'Ahmedabad', 'Gujarat', 'Satellite'],
      [2, 'Home Loan', 'SBI-RACPC-AHD-119', 'Ahmedabad', 'Gujarat', 'RACPC Ashram Road'],
      [6, 'Home Loan', 'LICHFL-AHD-DSA-552', 'Ahmedabad', 'Gujarat', 'Ellisbridge'],
      [7, 'Home Loan', 'BHFL-SUR-DSA-903', 'Surat', 'Gujarat', 'Vesu'],
    ] as const;
    for (const [b, product, code, city, region, branch] of codes) {
      await prisma.bankCode.create({ data: { bankId: banks[b].id, product, code, city, region, branch, effectiveFrom: new Date('2026-04-01'), createdById: admin.id } });
    }
  }

  if (!(await prisma.slider.count())) {
    await prisma.slider.createMany({
      data: [
        { kind: 'BANK_OFFER', title: 'HDFC Home Loan from 8.35%', subtitle: 'Festive offer on salaried profiles. Zero processing fee till 31 Oct.', theme: 'teal', ctaLabel: 'Add a case', ctaUrl: '/cases/new', sortOrder: 1 },
        { kind: 'CAMPAIGN', title: 'Diwali Disbursal Drive', subtitle: 'Extra 0.10% payout on every Home Loan handover in October.', theme: 'ink', ctaLabel: 'View payouts', ctaUrl: '/payouts', sortOrder: 2 },
        { kind: 'ANNOUNCEMENT', title: 'Complete your first payout KYC', subtitle: 'PAN, Aadhaar, cancelled cheque and photo are needed before your first payout is released.', theme: 'gold', ctaLabel: 'My profile', ctaUrl: '/profile', sortOrder: 3 },
      ],
    });
  }

  console.log('Seeded. Demo users (password %s):', DEMO_PASSWORD);
  for (const u of [admin, exec, dsa, tp, tp2]) console.log(`  ${u.role.padEnd(13)} ${u.mobile}  ${u.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
