'use client';
/** Project-wise ranking (PART 28, 98): objective numbers only, sortable highest or lowest. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatINRCompact } from '@/lib/format';
import { Card, cx, EmptyState, ErrorState, Kpi, Select, Skeleton } from './ui';

interface Row {
  projectId: string;
  name: string;
  city: string;
  locality: string;
  projectType: string;
  active: boolean;
  logins: number;
  sanctioned: number;
  disbursed: number;
  handovers: number;
  dropped: number;
  appliedAmount: number;
  sanctionedAmount: number;
  disbursedAmount: number;
  handoverAmount: number;
  payoutAmount: number;
}
interface Report {
  items: Row[];
  totals: { projects: number; logins: number; appliedAmount: number; disbursedAmount: number; handoverAmount: number; payoutAmount: number };
  unlinked: { cases: number; appliedAmount: number };
}

const SORTS = [
  { key: 'logins', label: 'Logins', value: (r: Row) => r.logins, fmt: (n: number) => `${n} ${n === 1 ? 'case' : 'cases'}` },
  { key: 'applied', label: 'Loan amount', value: (r: Row) => r.appliedAmount, fmt: formatINRCompact },
  { key: 'disbursed', label: 'Disbursed', value: (r: Row) => r.disbursedAmount, fmt: formatINRCompact },
  { key: 'handover', label: 'Handover', value: (r: Row) => r.handoverAmount, fmt: formatINRCompact },
  { key: 'payout', label: 'Payout', value: (r: Row) => r.payoutAmount, fmt: formatINRCompact },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

const RANGES = [
  { key: '', label: 'All time' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: '365', label: 'Last 12 months' },
];

export function ProjectAnalytics() {
  const [sort, setSort] = useState<SortKey>('logins');
  const [dir, setDir] = useState<'desc' | 'asc'>('desc');
  const [range, setRange] = useState('');
  const [bankId, setBankId] = useState('');
  const [loanType, setLoanType] = useState('');
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string }[]>('/banks'), staleTime: 600_000 });
  const loanTypes = useQuery({ queryKey: ['loan-types'], queryFn: () => api.get<{ code: string; name: string }[]>('/loan-types'), staleTime: 600_000 });
  const from = range ? new Date(Date.now() - Number(range) * 86_400_000).toISOString() : undefined;
  const report = useQuery({
    queryKey: ['reports', 'projects', sort, dir, range, bankId, loanType],
    queryFn: () => api.get<Report>('/reports/projects', { sort, dir, from, bankId, loanType }),
    placeholderData: keepPreviousData,
  });
  const active = SORTS.find((s) => s.key === sort)!;
  const top = report.data ? Math.max(1, ...report.data.items.map(active.value)) : 1;
  const t = report.data?.totals;

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <Select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </Select>
        <Select value={bankId} onChange={(e) => setBankId(e.target.value)} aria-label="Bank">
          <option value="">All banks</option>
          {banks.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select value={loanType} onChange={(e) => setLoanType(e.target.value)} aria-label="Loan type">
          <option value="">All loan types</option>
          {loanTypes.data?.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Projects with cases" value={t ? t.projects : '–'} sub={report.data ? `${report.data.unlinked.cases} cases without a project` : undefined} />
        <Kpi label="Logins" value={t ? t.logins : '–'} sub={t ? formatINRCompact(t.appliedAmount) + ' applied' : undefined} />
        <Kpi label="Disbursed" value={t ? formatINRCompact(t.disbursedAmount) : '–'} tone="teal" />
        <Kpi label="Handover" value={t ? formatINRCompact(t.handoverAmount) : '–'} tone="teal" />
        <Kpi label="Payout" value={t ? formatINRCompact(t.payoutAmount) : '–'} tone="gold" />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Rank projects by">
            {SORTS.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={sort === s.key}
                onClick={() => setSort(s.key)}
                className={cx('shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold', sort === s.key ? 'bg-ink text-white' : 'text-ink-600 hover:bg-ink-100')}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-xl bg-ink-50 p-1 ring-1 ring-ink-200/70" role="group" aria-label="Order">
            {(['desc', 'asc'] as const).map((d) => (
              <button key={d} onClick={() => setDir(d)} aria-pressed={dir === d} className={cx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold', dir === d ? 'bg-white shadow-card' : 'text-ink-500')}>
                {d === 'desc' ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
                {d === 'desc' ? 'Highest' : 'Lowest'}
              </button>
            ))}
          </div>
        </div>

        {report.isError ? (
          <ErrorState error={report.error} onRetry={() => report.refetch()} />
        ) : report.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : !report.data?.items.length ? (
          <EmptyState title="No project data yet" body="Cases linked to a Project Master entry are counted here." />
        ) : (
          <ol className="divide-y divide-ink-100">
            {report.data.items.map((r, i) => (
              <li key={r.projectId}>
                <Link href={`/cases?projectId=${r.projectId}`} className="grid grid-cols-[2rem_1fr] gap-x-3 px-4 py-3 hover:bg-ink-50 sm:grid-cols-[2rem_1fr_minmax(0,22rem)]">
                  <span className="row-span-2 pt-0.5 font-display text-sm font-bold tabular-nums text-ink-400 sm:row-span-1">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {r.name}
                      {!r.active && <span className="ml-2 text-xs font-semibold text-brand-red">Inactive</span>}
                    </p>
                    <p className="flex items-center gap-1 truncate text-xs text-ink-500">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {[r.locality, r.city].filter(Boolean).join(', ')}
                    </p>
                  </div>
                  <div className="col-start-2 mt-2 sm:col-start-3 sm:mt-0">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="font-semibold tabular-nums">{active.fmt(active.value(r))}</span>
                      <span className="text-xs tabular-nums text-ink-500">
                        {r.logins} login · {r.sanctioned} sanction · {r.handovers} handover
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                      <div className="h-full rounded-full bg-teal" style={{ width: `${(active.value(r) / top) * 100}%` }} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
