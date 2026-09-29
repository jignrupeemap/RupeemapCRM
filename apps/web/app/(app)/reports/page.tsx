'use client';
/** Reports (PART 49–50): pick a report, filter it, read it here, export CSV / Excel, or print to PDF. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { BarChart3, FileDown, FileSpreadsheet, Printer } from 'lucide-react';
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

export default function ReportsPage() {
  const { data: me } = useMe();
  const staff = me?.role === 'ADMIN' || me?.role === 'EXECUTIVE';
  const available = useQuery({ queryKey: ['reports', 'available'], queryFn: () => api.get<{ key: string; label: string; canExport: boolean }[]>('/reports') });
  const [key, setKey] = useState('cases');
  const [range, setRange] = useState<RangeValue>({ ...DEFAULT_RANGE, key: 'month' });
  const [bankId, setBankId] = useState('');
  const [dsaId, setDsaId] = useState('');
  const [teamPartnerId, setTeamPartnerId] = useState('');
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string }[]>('/banks'), staleTime: 600_000 });
  const people = useQuery({
    queryKey: ['report-people', me?.role],
    queryFn: () => api.page<{ id: string; name: string; role: string }>('/users', staff ? { pageSize: 100 } : { role: 'TEAM_PARTNER', pageSize: 100 }),
    enabled: staff || me?.role === 'DSA',
    staleTime: 300_000,
  });
  const filters = { ...rangeToParams(range), bankId, dsaId, teamPartnerId };
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
              <button key={x.key} onClick={() => setKey(x.key)} className={cx('shrink-0 rounded-xl px-3 py-2 text-left text-sm font-semibold', key === x.key ? 'bg-ink text-white' : 'text-ink-700 hover:bg-ink-100')}>
                {x.label}
              </button>
            ))}
          </nav>
        </Card>
        <div className="min-w-0 space-y-3">
          <div className="flex flex-col gap-2 print:hidden xl:flex-row xl:items-start xl:justify-between">
            <div className="flex flex-wrap gap-2">
              <Select value={bankId} onChange={(e) => setBankId(e.target.value)} className="w-44" aria-label="Bank">
                <option value="">All banks</option>
                {banks.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
              {staff && (
                <Select value={dsaId} onChange={(e) => setDsaId(e.target.value)} className="w-44" aria-label="DSA">
                  <option value="">All DSAs</option>
                  {dsas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
              {(staff || me?.role === 'DSA') && (
                <Select value={teamPartnerId} onChange={(e) => setTeamPartnerId(e.target.value)} className="w-44" aria-label="Team Partner">
                  <option value="">All Team Partners</option>
                  {tps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
            <DateRangeFilter value={range} onChange={setRange} />
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-lg font-bold">{r?.title ?? '…'}</h2>
                <p className="text-sm text-ink-500">
                  {r ? `${r.rowCount.toLocaleString('en-IN')} rows${r.rowCount > r.rows.length ? `, first ${r.rows.length} shown here; exports include all` : ''}` : ''}
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
                            {show(row[c.key], c)}
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
