'use client';
/** First Payout KYC queue for Admin and Executives. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { KycStatus } from '@rupeemap/shared';
import { api } from '@/lib/api';
import { formatINRCompact, initials, timeAgo } from '@/lib/format';
import { useMe } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { Badge, Card, cx, EmptyState, ErrorState, Input, Skeleton } from '@/components/ui';
import { KycChip } from '@/components/kyc';

interface Row {
  userId: string;
  name: string;
  mobile: string;
  role: 'DSA' | 'TEAM_PARTNER';
  dsaCode: string | null;
  status: KycStatus;
  gstApplicable: boolean;
  uploaded: number;
  required: number;
  pendingPayouts: number;
  pendingPayoutAmount: number;
  updatedAt: string;
}

const TABS = [
  { key: 'verify', label: 'Needs Admin verification', status: 'UNDER_ADMIN_VERIFICATION' },
  { key: 'collect', label: 'Collecting documents', status: 'DOCUMENTS_PENDING,UPLOADED,RESUBMISSION_REQUIRED,REJECTED' },
  { key: 'approved', label: 'Approved', status: 'APPROVED' },
] as const;

export default function KycQueuePage() {
  const { data: me } = useMe();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>(me?.role === 'ADMIN' ? 'verify' : 'collect');
  const [q, setQ] = useState('');
  const current = TABS.find((t) => t.key === tab)!;
  const list = useQuery({
    queryKey: ['kyc', 'queue', tab, q],
    queryFn: () => api.get<Row[]>('/kyc', { status: current.status, q }),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="First Payout KYC"
        sub="PAN, masked Aadhaar, cancelled cheque, photograph and GST certificate (if registered) must be approved by Admin before a partner's first payout is paid."
      />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="KYC stage">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cx('shrink-0 rounded-xl px-3 py-2 text-sm font-semibold', tab === t.key ? 'bg-ink text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <Input placeholder="Search name or mobile" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search partners" className="sm:max-w-xs" />
      </div>

      {list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : list.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title={tab === 'verify' ? 'Nothing waiting for verification' : 'No partners here'} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink-100">
            {list.data.map((r) => (
              <li key={r.userId}>
                <Link href={`/kyc/${r.userId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-bold text-ink-700">{initials(r.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.name}</p>
                    <p className="truncate text-xs text-ink-500">
                      {r.role === 'DSA' ? (r.dsaCode ?? 'DSA') : 'Team Partner'} · +91 {r.mobile} · updated {timeAgo(r.updatedAt)}
                    </p>
                  </div>
                  <div className="hidden w-40 sm:block">
                    <div className="flex justify-between text-xs text-ink-500">
                      <span>Documents</span>
                      <span className="tabular-nums">
                        {r.uploaded}/{r.required}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div className={cx('h-full rounded-full', r.uploaded === r.required ? 'bg-emerald-600' : 'bg-brand-gold')} style={{ width: `${(r.uploaded / r.required) * 100}%` }} />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <KycChip status={r.status} />
                    {r.pendingPayouts > 0 && r.status !== 'APPROVED' && <Badge tone="red">{formatINRCompact(r.pendingPayoutAmount)} payout waiting</Badge>}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
