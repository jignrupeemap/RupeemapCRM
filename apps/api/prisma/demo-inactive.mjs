// Dev/staging only: adds demo partners whose last business was 35, 64, 72 and 95 days
// ago, so the Inactive Partners screen and the daily check can be tried out.
// Usage (from apps/api): node --env-file=.env prisma/demo-inactive.mjs
import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === 'production') throw new Error('Demo data is not allowed in production');
const prisma = new PrismaClient();
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000);
const template = await prisma.user.findUniqueOrThrow({ where: { mobile: '9000000003' } });
const dsaProfile = await prisma.dsaPartner.findUniqueOrThrow({ where: { userId: template.id } });

const demo = [
  ['Demo Kalpesh Rathod', '9000000101', 'DSA', 95],
  ['Demo Snehal Vora', '9000000102', 'TEAM_PARTNER', 72],
  ['Demo Jatin Bhatt', '9000000103', 'DSA', 64],
  ['Demo Rina Chauhan', '9000000104', 'TEAM_PARTNER', 35],
];
let n = await prisma.dsaPartner.count();
for (const [name, mobile, role, days] of demo) {
  if (await prisma.user.findUnique({ where: { mobile } })) continue;
  const u = await prisma.user.create({
    data: { name, mobile, role, status: 'ACTIVE', passwordHash: template.passwordHash, mobileVerified: true, createdAt: daysAgo(days + 30), activatedAt: daysAgo(days + 30), lastLoginAt: daysAgo(days - 3) },
  });
  if (role === 'DSA') await prisma.dsaPartner.create({ data: { userId: u.id, code: `DSA-${String(++n).padStart(4, '0')}` } });
  else await prisma.teamMembership.create({ data: { userId: u.id, dsaId: dsaProfile.id, startedOn: daysAgo(days + 30) } });
  await prisma.kycProfile.create({ data: { userId: u.id } });
  // Their last case was `days` ago.
  const any = await prisma.loanCase.findFirst({ orderBy: { createdAt: 'asc' } });
  if (any) {
    const seq = await prisma.caseCounter.upsert({ where: { year: 2026 }, create: { year: 2026, lastSeq: 1 }, update: { lastSeq: { increment: 1 } } });
    const customer = await prisma.customer.create({ data: { name: `Customer of ${name.replace('Demo ', '')}` } });
    await prisma.loanCase.create({
      data: {
        caseNo: `LDSA-2026-${String(seq.lastSeq).padStart(6, '0')}`,
        customerId: customer.id,
        loanType: 'HOME_LOAN',
        appliedAmount: 2500000,
        bankId: any.bankId,
        dsaId: role === 'DSA' ? u.id : template.id,
        teamPartnerId: role === 'TEAM_PARTNER' ? u.id : null,
        createdById: u.id,
        createdRole: role,
        createdAt: daysAgo(days),
        statusChangedAt: daysAgo(days),
      },
    });
  }
}
console.log('Demo inactive partners ready');
await prisma.$disconnect();
