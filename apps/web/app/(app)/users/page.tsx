'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import type { Role } from '@rupeemap/shared';
import { PageHeader } from '@/components/shell';
import { PeopleList } from '@/components/people';

function Users() {
  const role = (useSearchParams().get('role') ?? undefined) as Role | undefined;
  return (
    <div>
      <PageHeader title="Users" sub="Create DSA Partners, Team Partners and Executives. Block, reset, promote and verify KYC." />
      <PeopleList key={role ?? 'all'} role={role} />
    </div>
  );
}

export default function UsersPage() {
  return (
    <Suspense>
      <Users />
    </Suspense>
  );
}
