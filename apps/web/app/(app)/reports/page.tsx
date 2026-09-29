'use client';
/** Reports (PART 49–50): pick a report, filter it, read it here, export CSV / Excel, or print to PDF. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BarChart3, FileDown, FileSpreadsheet, Printer, X } from 'lucide-react';
import { CASE_STATUSES, CASE_STATUS_LABELS, PAYOUT_STATUSES, PAYOUT_STATUS_LABELS } from '@rupeemap/shared';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { fmtDate, formatINR } from '@/lib/format';
import { useMe } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { DateRangeFilter, DEFAULT_RANGE, rangeToParams, type RangeValue } from '@/components/date-range';
import { Button, Card, cx, EmptyState, ErrorState, Select, Skeleton } from '@/components/ui';

interface Col {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'percent' | 'date';
}
interface Result {
  title: string;
  columns: Col[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  rowCount: number;
  truncated?: boolean;
}

function show(v: unknown, c: Col) {
  if (v === null || v === undefined || v === '') return '—';
  if (c.type === 'money') return formatINR(Number(v), { whole: true });
  if (c.type === 'percent') return `${v}%`;
  if (c.type === 'date') return fmtDate(v as string);
  if (c.type === 'number') return Number(v).toLocaleString('en-IN');
  return String(v);
}

/** yyyy-mm-dd in the viewer's time zone (the format list pages read from links). */
const ymd = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ReportsPage() {
  const { data: me } = useMe();
  const staff = me?.role === 'ADMIN' || me?.role === 'EXECUTIVE';
  const available = useQuery({ queryKey: ['reports', 'available'], queryFn: () => api.get<{ key: string; label: string; canExport: boolean }[]>('/reports') });
  const [key, setKey] = useState('cases');
  const [range, setRange] = useState<RangeValue>({ ...DEFAULT_RANGE, key: 'month' });
  const [bankId, setBankId] = useState('');
  const [dsaId, setDsaId] = useState('');
  const [teamPartnerId, setTeamPartnerId] = useState('');
  const [status, setStatus] = useState('');
  const [loanType, setLoanType] = useState('');
  const [projectId, setProjectId] = useState('');
  const [partPayment, setPartPayment] = useState(false);
  const caseBased = ['cases', 'dsa-performance', 'team-performance', 'banks'].includes(key);
  const statusChoices: [string, string][] =
    key === 'payouts' ? PAYOUT_STATUSES.map((x) => [x, PAYOUT_STATUS_LABELS[x]]) : caseBased ? CASE_STATUSES.map((x) => [x, CASE_STATUS_LABELS[x]]) : [];
  const loanTypes = useQuery({ queryKey: ['loan-types'], queryFn: () => api.get<{ code: string; name: string }[]>('/loan-types'), staleTime: 3600_000 });
  const projects = useQuery({ queryKey: ['projects', 'all'], queryFn: () => api.page<{ id: string; name: string }>('/projects', { pageSize: 100 }), staleTime: 300_000 });
  const pick = (k: string) => (setKey(k), setStatus(''), setPartPayment(false));
  const clear = () => (setBankId(''), setDsaId(''), setTeamPartnerId(''), setStatus(''), setLoanType(''), setProjectId(''), setPartPayment(false), setRange({ ...DEFAULT_RANGE, key: 'month' }));
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string }[]>('/banks'), staleTime: 600_000 });
  const people = useQuery({
    queryKey: ['report-people', me?.role],
    queryFn: () => api.page<{ id: string; name: string; role: string }>('/users', staff ? { pageSize: 100 } : { role: 'TEAM_PARTNER', pageSize: 100 }),
    enabled: staff || me?.role === 'DSA',
    staleTime: 300_000,
  });
  const filters = {
    ...rangeToParams(range),
    bankId,
    dsaId,
    teamPartnerId,
    loanType,
    projectId,
    status: statusChoices.some(([v]) => v === status) ? status : '',
    partPayment: caseBased && partPayment ? '1' : '',
  };
  const active = [bankId, dsaId, teamPartnerId, loanType, projectId, filters.status, filters.partPayment].filter(Boolean).length;
  /** A cell's link, keeping the report's dates and filters so the list shows the same cases. */
  const cellHref = (href: string) => {
    if (!href.startsWith('/cases?')) return href;
    const u = new URLSearchParams(href.slice('/cases?'.length));
    const keep: Record<string, string> = {
      from: ymd(filters.from),
      to: ymd(filters.to),
      bankId,
      dsaId,
      teamPartnerId,
      loanType,
      projectId,
      partPayment: filters.partPayment,
      ...(caseBased ? { status: filters.status } : {}),
    };
    for (const [k, v] of Object.entries(keep)) if (v && !u.has(k)) u.set(k, v);
    return `/cases?${u.toString()}`;
  };
  const report = useQuery({
    queryKey: ['reports', 'run', key, filters],
    queryFn: () => api.get<Result>(`/reports/run/${key}`, filters),
    placeholderData: keepPreviousData,
    enabled: !!available.data?.some((r) => r.key === key),
  });
  const canExport = available.data?.find((r) => r.key === key)?.canExport;
  const exportUrl = (format: 'csv' | 'xlsx') => `/api/v1/reports/run/${key}/export?${new URLSearchParams(Object.entries({ ...filters, format }).filter(([, v]) => v) as [string, string][])}`;
  const r = report.data;
  const dsas = (people.data?.data ?? []).filter((p) => p.role === 'DSA');
  const tps = (people.data?.data ?? []).filter((p) => p.role === 'TEAM_PARTNER');

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <PageHeader title="Reports" sub={staff ? 'Organisation reports with filters. Export to Excel or CSV, or print to PDF.' : 'Reports on your own and your team’s business.'} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <Card className="h-fit p-2 print:hidden">
          <nav aria-label="Reports" className="flex gap-1 overflow-x-auto lg:flex-col">
            {available.data?.map((x) => (
              <button key={x.key} onClick={() => pick(x.key)} className={cx('shrink-0 rounded-xl px-3 py-2 text-left text-sm font-semibold', key === x.key ? 'bg-teal-700 text-white' : 'text-ink-700 hover:bg-ink-100')}>
                {x.label}
              </button>
            ))}
          </nav>
        </Card>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-col gap-2 print:hidden xl:flex-row xl:items-start xl:justify-between">
            <div className="flex flex-wrap gap-2">
              <Select value={bankId} onChange={(e) => setBankId(e.target.value)} className="sm:w-44" aria-label="Bank">
                <option value="">All banks</option>
                {banks.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
              {staff && (
                <Select value={dsaId} onChange={(e) => setDsaId(e.target.value)} className="sm:w-44" aria-label="DSA">
                  <option value="">All DSAs</option>
                  {dsas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
              {(staff || me?.role === 'DSA') && (
                <Select value={teamPartnerId} onChange={(e) => setTeamPartnerId(e.target.value)} className="sm:w-44" aria-label="Team Partner">
                  <option value="">All Team Partners</option>
                  {tps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
              {statusChoices.length > 0 && (
                <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44" aria-label="Status">
                  <option value="">Any status</option>
                  {statusChoices.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
              <Select value={loanType} onChange={(e) => setLoanType(e.target.value)} className="sm:w-44" aria-label="Loan type">
                <option value="">All loan types</option>
                {loanTypes.data?.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </Select>
              <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="sm:w-44" aria-label="Project">
                <option value="">All projects</option>
                {projects.data?.data.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name}
                  </option>
                ))}
              </Select>
              {caseBased && (
                <label className={cx('flex h-11 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-semibold ring-1 ring-inset', partPayment ? 'bg-amber-600 text-white ring-amber-600' : 'bg-brand-goldsoft text-amber-900 ring-amber-200')}>
                  <input type="checkbox" className="h-4 w-4 accent-amber-700" checked={partPayment} onChange={(e) => setPartPayment(e.target.checked)} />
                  Part payment only
                </label>
              )}
              {active > 0 && (
                <button onClick={clear} className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-ink-600 hover:bg-ink-100">
                  <X className="h-4 w-4" /> Clear filters ({active})
                </button>
              )}
            </div>
            <DateRangeFilter value={range} onChange={setRange} />
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-lg font-bold">{r?.title ?? '…'}</h2>
                <p className="text-sm text-ink-500">
                  {r ? `${r.rowCount.toLocaleString('en-IN')} ${r.rowCount === 1 ? 'row' : 'rows'}${r.rowCount > r.rows.length ? `, first ${r.rows.length} shown here; exports include all` : ''}` : ''}
                  {range.key !== 'all' ? ` · ${range.key === 'custom' ? `${range.from} to ${range.to}` : range.key === 'month' ? 'this month' : range.key === 'week' ? 'last 7 days' : 'today'}` : ' · all time'}
                </p>
              </div>
              <div className="flex gap-2 print:hidden">
                {canExport && (
                  <>
                    <a href={exportUrl('xlsx')} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700">
                      <FileSpreadsheet className="h-4 w-4" /> Excel
                    </a>
                    <a href={exportUrl('csv')} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-semibold ring-1 ring-inset ring-ink-200 hover:bg-ink-50">
                      <FileDown className="h-4 w-4" /> CSV
                    </a>
                  </>
                )}
                <Button size="sm" variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
                  PDF
                </Button>
              </div>
            </div>
            {report.isError ? (
              <ErrorState error={report.error} onRetry={() => report.refetch()} />
            ) : !r ? (
              <Skeleton className="m-4 h-64" />
            ) : !r.rows.length ? (
              <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="Nothing in this period" body="Try a wider date range or remove a filter." />
            ) : (
              <div className="max-h-[70vh] overflow-auto print:max-h-none print:overflow-visible">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                    <tr>
                      {r.columns.map((c) => (
                        <th key={c.key} className={cx('whitespace-nowrap px-3 py-2.5', ['money', 'number', 'percent'].includes(c.type ?? '') && 'text-right')}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {r.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-ink-50/60">
                        {r.columns.map((c) => (
                          <td key={c.key} className={cx('whitespace-nowrap px-3 py-2', ['money', 'number', 'percent'].includes(c.type ?? '') && 'text-right tabular-nums')}>
                            {(row._links as Record<string, string> | undefined)?.[c.key] && row[c.key] !== 0 && row[c.key] !== '' ? (
                              <Link href={cellHref((row._links as Record<string, string>)[c.key])} className="font-medium text-teal-800 underline-offset-2 hover:underline">
                                {show(row[c.key], c)}
                              </Link>
                            ) : (
                              show(row[c.key], c)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {r.totals && (
                    <tfoot className="sticky bottom-0 bg-ink-50 font-semibold">
                      <tr>
                        {r.columns.map((c, i) => (
                          <td key={c.key} className={cx('whitespace-nowrap px-3 py-2.5', ['money', 'number', 'percent'].includes(c.type ?? '') && 'text-right tabular-nums')}>
                            {i === 0 ? 'Total' : c.key in r.totals! ? show(r.totals![c.key], c) : ''}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
