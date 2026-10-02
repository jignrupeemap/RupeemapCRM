// Adds the profile-wise checklists to an existing database without touching anything else.
// Usage (from apps/api): npx tsx prisma/seed-profiles.ts
import { PrismaClient } from '@prisma/client';
import { seedProfileChecklists } from './profile-checklists';

async function main() {
  const prisma = new PrismaClient();
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', deletedAt: null }, orderBy: { createdAt: 'asc' } });
  if (!admin) console.log('No Admin user yet; run the main seed first.');
  else console.log('profile checklists added:', await seedProfileChecklists(prisma, admin.id));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
