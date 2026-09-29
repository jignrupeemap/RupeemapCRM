'use client';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { ROLE_LABELS, type Role } from '@rupeemap/shared';
import { api } from '@/lib/api';
import { useMe } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { KycPanel } from '@/components/kyc';

export default function KycDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { data: me } = useMe();
  const staff = me?.role === 'ADMIN' || me?.role === 'EXECUTIVE';
  const user = useQuery({ queryKey: ['kyc', userId], queryFn: () => api.get<{ user: { name: string; mobile: string; role: Role } }>(`/kyc/${userId}`) });
  const u = user.data?.user;
  return (
    <div>
      <PageHeader
        back={staff ? { href: '/kyc', label: 'First Payout KYC' } : { href: '/profile', label: 'Profile' }}
        title={u ? `${u.name}: first payout KYC` : 'First payout KYC'}
        sub={u ? `${ROLE_LABELS[u.role]} · +91 ${u.mobile}` : undefined}
      />
      <KycPanel userId={userId} />
    </div>
  );
}
