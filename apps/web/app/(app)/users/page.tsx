'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import type { Role } from '@rupeemap/shared';
import { PageHeader } from '@/components/shell';
import { PeopleList } from '@/components/people';

function Users() {
  const params = useSearchParams();
  const role = (params.get('role') ?? undefined) as Role | undefined;
  const status = params.get('status') ?? '';
  return (
    <div>
      <PageHeader title="Users" sub="Create DSA Partners, Team Partners and Executives. Block, reset, promote and verify KYC." />
      <PeopleList key={`${role ?? 'all'}-${status}-${params.get('q') ?? ''}`} role={role} initialStatus={status} initialQuery={params.get('q') ?? ''} />
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
