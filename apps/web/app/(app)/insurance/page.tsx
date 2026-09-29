'use client';
/** Insurance register for Admin and Executives: every policy and Rupeemap's commission on it. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ShieldPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { INSURANCE_PAYOUT_LABELS, INSURANCE_PAYOUT_STATUSES, type InsurancePayoutStatus } from '@rupeemap/shared';
import { api } from '@/lib/api';
import { fmtDate, formatINR, formatINRCompact } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { DateRangeFilter, DEFAULT_RANGE, rangeToParams, type RangeValue } from '@/components/date-range';
import { InsuranceChip, InsurancePayoutModal, type PolicyRow } from '@/components/insurance';
import { Button, Card, cx, EmptyState, ErrorState, Input, Kpi, Pagination, Skeleton } from '@/components/ui';

type Row = PolicyRow & { loanCase: { id: string; caseNo: string; customer: { name: string }; bank: { name: string } } };

export default function InsurancePage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [updating, setUpdating] = useState<Row | null>(null);
  const dates = rangeToParams(range);
  const list = useQuery({
    queryKey: ['insurance', 'list', status, q, page, dates],
    queryFn: () => api.page<Row>('/insurance', { status, q, page, ...dates }),
    placeholderData: keepPreviousData,
  });
  const summary: { status: InsurancePayoutStatus; count: number; amount: number }[] = list.data?.meta.summary ?? [];
  const sum = (s: InsurancePayoutStatus) => summary.find((x) => x.status === s) ?? { count: 0, amount: 0 };
  const total = summary.reduce((a, s) => a + s.amount, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Insurance" sub="Insurance sold with loans and Rupeemap's insurance payout on each policy. Rupeemap keeps 100% of it; it is never part of DSA or Team Partner payouts." />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <Input placeholder="Search company, policy, customer or case" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="sm:max-w-sm" aria-label="Search insurance" />
        <DateRangeFilter value={range} onChange={(v) => (setRange(v), setPage(1))} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <button onClick={() => (setStatus(''), setPage(1))} className={cx('rounded-2xl text-left ring-2 transition', !status ? 'ring-teal-600' : 'ring-transparent')} aria-pressed={!status}>
          <Kpi label="Insurance payout" value={formatINRCompact(total)} sub={`${summary.reduce((a, s) => a + s.count, 0)} policies · show all`} tone="teal" />
        </button>
        {INSURANCE_PAYOUT_STATUSES.map((s) => (
          <button key={s} onClick={() => (setStatus(status === s ? '' : s), setPage(1))} className={cx('rounded-2xl text-left ring-2 transition', status === s ? 'ring-teal-600' : 'ring-transparent')} aria-pressed={status === s}>
            <Kpi label={INSURANCE_PAYOUT_LABELS[s]} value={formatINRCompact(sum(s).amount)} sub={`${sum(s).count} policies`} tone={s === 'RECEIVED' ? 'teal' : s === 'HOLD' ? 'red' : s === 'PENDING' ? 'gold' : 'neutral'} />
          </button>
        ))}
      </div>

      {list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : list.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !list.data?.data.length ? (
        <Card>
          <EmptyState icon={<ShieldPlus className="h-6 w-6" />} title="No insurance yet" body="Add insurance from a case's Insurance tab." />
        </Card>
      ) : (
        <>
          <ul className="space-y-3">
            {list.data.data.map((p) => (
              <li key={p.id}>
                <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{p.companyName}</span>
                      {p.payout && <InsuranceChip status={p.payout.status} />}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-500">
                      <Link href={`/cases/${p.loanCase.id}`} className="font-medium text-ink hover:underline">
                        {p.loanCase.customer.name}
                      </Link>{' '}
                      · {p.loanCase.caseNo} · {p.loanCase.bank.name}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-600">
                      Cover {formatINR(p.insuranceAmount, { whole: true })}
                      {p.premiumAmount ? ` · Premium ${formatINR(p.premiumAmount, { whole: true })}` : ''} · Added {fmtDate(p.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                    <p className="font-display text-xl font-bold tabular-nums">{p.payout ? formatINR(p.payout.amount) : '—'}</p>
                    {p.payout && p.payout.status !== 'RECEIVED' && (
                      <Button size="sm" onClick={() => setUpdating(p)}>
                        Update payout
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination page={list.data.meta.page} pageSize={list.data.meta.pageSize} total={list.data.meta.total} onPage={setPage} />
        </>
      )}
      {updating?.payout && <InsurancePayoutModal policyId={updating.id} payout={updating.payout} title={updating.companyName} onClose={() => setUpdating(null)} />}
    </div>
  );
}
