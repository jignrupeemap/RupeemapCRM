'use client';
/** Project-wise ranking (PART 28, 98): objective numbers only, sortable highest or lowest. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, MapPin, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { formatINRCompact } from '@/lib/format';
import { Card, cx, EmptyState, ErrorState, Kpi, Modal, Select, Skeleton } from './ui';
import { useMe } from '@/lib/session';
import { DateRangeFilter, DEFAULT_RANGE, rangeToParams, type RangeValue } from './date-range';

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


export function ProjectAnalytics() {
  const [sort, setSort] = useState<SortKey>('logins');
  const [dir, setDir] = useState<'desc' | 'asc'>('desc');
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const [bankId, setBankId] = useState('');
  const [loanType, setLoanType] = useState('');
  const [topFor, setTopFor] = useState<Row | null>(null);
  const isAdmin = useMe().data?.role === 'ADMIN';
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string }[]>('/banks'), staleTime: 600_000 });
  const loanTypes = useQuery({ queryKey: ['loan-types'], queryFn: () => api.get<{ code: string; name: string }[]>('/loan-types'), staleTime: 600_000 });
  const { from, to } = rangeToParams(range);
  const rangeReady = range.key !== 'custom' || !range.from || !range.to || range.from <= range.to;
  const report = useQuery({
    queryKey: ['reports', 'projects', sort, dir, from, to, bankId, loanType],
    queryFn: () => api.get<Report>('/reports/projects', { sort, dir, from, to, bankId, loanType }),
    enabled: rangeReady,
    placeholderData: keepPreviousData,
  });
  const active = SORTS.find((s) => s.key === sort)!;
  const top = report.data ? Math.max(1, ...report.data.items.map(active.value)) : 1;
  const t = report.data?.totals;

  return (
    <div className="space-y-4">
      <DateRangeFilter value={range} onChange={setRange} className="sm:items-start" />
      <div className="grid gap-2 sm:grid-cols-2 lg:max-w-2xl">
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
                className={cx('shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold', sort === s.key ? 'bg-teal-700 text-white' : 'text-ink-600 hover:bg-ink-100')}
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
              <li key={r.projectId} className="flex items-center">
                <Link href={`/cases?projectId=${r.projectId}`} className="grid flex-1 grid-cols-[2rem_1fr] gap-x-3 px-4 py-3 hover:bg-ink-50 sm:grid-cols-[2rem_1fr_minmax(0,22rem)]">
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
                        {r.sanctioned} sanctioned · {r.handovers} handed over
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                      <div className="h-full rounded-full bg-teal" style={{ width: `${(active.value(r) / top) * 100}%` }} />
                    </div>
                  </div>
                </Link>
                {isAdmin && r.logins > 0 && (
                  <button onClick={() => setTopFor(r)} className="mr-3 flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-teal-800 ring-1 ring-inset ring-teal-200 hover:bg-teal-50" aria-label={`Top 5 performers in ${r.name}`}>
                    <Trophy className="h-3.5 w-3.5" /> Top 5
                  </button>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      {topFor && <TopPerformersModal project={topFor} initialRange={range} onClose={() => setTopFor(null)} />}
    </div>
  );
}

interface Performer {
  id: string;
  name: string;
  role: string;
  dsaCode: string | null;
  dsaName: string | null;
  teamPartners?: number;
  logins: number;
  sanctioned: number;
  handovers: number;
  appliedAmount: number;
  disbursedAmount: number;
  handoverAmount: number;
}

/** Admin only: who sourced the most business in one project. */
function TopPerformersModal({ project, initialRange, onClose }: { project: Row; initialRange: RangeValue; onClose: () => void }) {
  const [range, setRange] = useState<RangeValue>(initialRange);
  const [by, setBy] = useState<'logins' | 'handover' | 'disbursed'>('logins');
  const params = rangeToParams(range);
  const q = useQuery({
    queryKey: ['reports', 'top', project.projectId, by, params],
    queryFn: () => api.get<{ partners: Performer[]; teams: Performer[] }>(`/reports/projects/${project.projectId}/top-performers`, { by, ...params }),
    placeholderData: keepPreviousData,
  });
  const List = ({ rows, teams }: { rows: Performer[]; teams?: boolean }) =>
    !rows.length ? (
      <p className="rounded-xl bg-ink-50 p-4 text-sm text-ink-500">No cases in this period.</p>
    ) : (
      <ol className="divide-y divide-ink-100 rounded-xl ring-1 ring-ink-200/70">
        {rows.map((p, i) => (
          <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold', i === 0 ? 'bg-brand-gold text-white' : 'bg-ink-100 text-ink-600')}>{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{p.name}</p>
              <p className="truncate text-xs text-ink-500">
                {teams ? `${p.dsaCode ?? 'DSA'} · ${p.teamPartners ?? 0} Team Partners active` : p.role === 'TEAM_PARTNER' ? `Team Partner · team of ${p.dsaName}` : `DSA · ${p.dsaCode ?? ''}`}
              </p>
            </div>
            <div className="text-right text-sm tabular-nums">
              <p className="font-semibold">
                {p.logins} {p.logins === 1 ? 'login' : 'logins'}
              </p>
              <p className="text-xs text-ink-500">
                {p.handovers} handover · {formatINRCompact(p.handoverAmount)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    );
  return (
    <Modal open wide onOpenChange={(o) => !o && onClose()} title={`Top 5 performers: ${project.name}`} description="Ranked by business sourced in this project. Only Admin can see this.">
      <div className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <Select value={by} onChange={(e) => setBy(e.target.value as typeof by)} aria-label="Rank by" className="sm:w-48">
            <option value="logins">Rank by logins</option>
            <option value="disbursed">Rank by disbursed amount</option>
            <option value="handover">Rank by handover amount</option>
          </Select>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <Skeleton className="h-64" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-bold">Partners (who sourced the case)</h3>
              <List rows={q.data.partners} />
            </section>
            <section>
              <h3 className="mb-2 text-sm font-bold">DSA teams (DSA plus their Team Partners)</h3>
              <List rows={q.data.teams} teams />
            </section>
          </div>
        )}
      </div>
    </Modal>
  );
}
