'use client';
/** Audit Log (PART 55): who did what and when, with filters, change details, export and a tamper check. */
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FileDown, FileSpreadsheet, ScrollText, ShieldAlert, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { DateRangeFilter, DEFAULT_RANGE, rangeToParams, type RangeValue } from '@/components/date-range';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Input, Pagination, Select, Skeleton } from '@/components/ui';

interface Entry {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string;
  actorMobile: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  entityLabel: string | null;
  link: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  requestId: string | null;
  hash: string;
}
interface Facets {
  actions: { value: string; count: number }[];
  entities: { value: string; count: number }[];
  actors: { id: string; name: string; role: string; count: number }[];
}
interface Verify {
  ok: boolean;
  checked: number;
  contentVerified: number;
  linkOnly: number;
  broken: { id: string; at: string; reason: string }[];
  ms: number;
  checkedAt: string;
}

const ROLE: Record<string, string> = { ADMIN: 'Admin', EXECUTIVE: 'Admin Executive', DSA: 'DSA Partner', TEAM_PARTNER: 'Team Partner' };
const words = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
const entityName = (s: string) => words(s.toUpperCase());

function tone(action: string): 'neutral' | 'teal' | 'gold' | 'red' | 'dark' {
  if (/FAILED|BLOCK|DELETE|REJECT|DEACTIVAT|CLAWBACK|SUSPEND|LOCK/.test(action)) return 'red';
  if (/PAYOUT|RATE|AMOUNT|RECOVER/.test(action)) return 'gold';
  if (/CREATE|APPROV|ACTIVAT|VERIF|PAID/.test(action)) return 'teal';
  if (/LOGIN|LOGOUT|EXPORT/.test(action)) return 'neutral';
  return 'dark';
}

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

function Changes({ e }: { e: Entry }) {
  const b = e.before && typeof e.before === 'object' ? e.before : {};
  const a = e.after && typeof e.after === 'object' ? e.after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      {keys.length ? (
        <div className="overflow-x-auto rounded-xl ring-1 ring-ink-100">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-3 py-2">Field</th>
                <th className="px-3 py-2">Before</th>
                <th className="px-3 py-2">After</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 bg-white">
              {keys.map((k) => {
                const changed = show(b[k]) !== show(a[k]);
                return (
                  <tr key={k}>
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-ink-700">{k}</td>
                    <td className={cx('max-w-[280px] break-words px-3 py-2 font-mono text-xs', changed && k in b ? 'text-red-700 line-through decoration-red-300' : 'text-ink-500')}>{k in b ? show(b[k]) : ''}</td>
                    <td className={cx('max-w-[280px] break-words px-3 py-2 font-mono text-xs', changed ? 'font-semibold text-emerald-700' : 'text-ink-500')}>{k in a ? show(a[k]) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-ink-500">No field changes were recorded for this action.</p>
      )}
      <dl className="space-y-2 text-xs text-ink-500">
        <div>
          <dt className="font-semibold uppercase tracking-wide">Exact time</dt>
          <dd className="text-ink-700">{fmtDateTime(e.at)}</dd>
        </div>
        {e.actorMobile && (
          <div>
            <dt className="font-semibold uppercase tracking-wide">Mobile</dt>
            <dd className="text-ink-700">{e.actorMobile}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold uppercase tracking-wide">Request</dt>
          <dd className="break-all font-mono text-ink-700">{e.requestId ?? '—'}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wide">Entry #{e.id} fingerprint</dt>
          <dd className="break-all font-mono text-ink-700">{e.hash.slice(0, 32)}…</dd>
        </div>
      </dl>
    </div>
  );
}

function Integrity() {
  const v = useMutation({ mutationFn: () => api.get<Verify>('/audit/verify') });
  const r = v.data;
  return (
    <Card className={cx('flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between', r && !r.ok && 'ring-2 ring-red-300')}>
      <div className="flex items-start gap-3">
        <div className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', !r ? 'bg-ink-100 text-ink-600' : r.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
          {r && !r.ok ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
        </div>
        <div className="text-sm">
          <p className="font-semibold text-ink">
            {!r ? 'Tamper check' : r.ok ? `All ${r.checked.toLocaleString('en-IN')} entries are intact` : `${r.broken.length} problem${r.broken.length === 1 ? '' : 's'} found in the log`}
          </p>
          <p className="text-ink-500">
            {!r
              ? 'Entries cannot be edited or deleted, and each one is chained to the one before it. Run a check to confirm nothing was altered.'
              : r.ok
                ? `Chain unbroken. ${r.contentVerified.toLocaleString('en-IN')} entries also matched their fingerprints${r.linkOnly ? `; ${r.linkOnly.toLocaleString('en-IN')} older entries were checked by link only` : ''}. Checked ${timeAgo(r.checkedAt)}.`
                : r.broken.map((b) => `Entry #${b.id}: ${b.reason}`).join(' · ')}
          </p>
          {v.isError && <p className="text-red-700">{(v.error as Error).message}</p>}
        </div>
      </div>
      <Button size="sm" variant="secondary" loading={v.isPending} onClick={() => v.mutate()} className="shrink-0">
        {r ? 'Check again' : 'Check now'}
      </Button>
    </Card>
  );
}

export default function AuditPage() {
  const [range, setRange] = useState<RangeValue>({ ...DEFAULT_RANGE, key: 'week' });
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [actorId, setActorId] = useState('');
  const [ip, setIp] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const facets = useQuery({ queryKey: ['audit', 'facets'], queryFn: () => api.get<Facets>('/audit/facets'), staleTime: 60_000 });
  const filters = { ...rangeToParams(range), action, entity, actorId, ip: ip.trim() };
  const list = useQuery({
    queryKey: ['audit', 'list', filters, page],
    queryFn: () => api.page<Entry>('/audit', { ...filters, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const set = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };
  const exportUrl = (format: 'csv' | 'xlsx') =>
    `/api/v1/audit/export?${new URLSearchParams(Object.entries({ ...filters, format }).filter(([, v]) => v) as [string, string][])}`;
  const rows = list.data?.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Log"
        sub="Every important action in the CRM: logins, case and payout changes, approvals, exports. Read-only."
        actions={
          <>
            <a href={exportUrl('xlsx')} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </a>
            <a href={exportUrl('csv')} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-semibold ring-1 ring-inset ring-ink-200 hover:bg-ink-50">
              <FileDown className="h-4 w-4" /> CSV
            </a>
          </>
        }
      />
      <Integrity />
      <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex flex-wrap gap-2">
          <Select value={actorId} onChange={(e) => set(setActorId)(e.target.value)} className="sm:w-48" aria-label="Person">
            <option value="">Everyone</option>
            {facets.data?.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({ROLE[a.role] ?? a.role})
              </option>
            ))}
          </Select>
          <Select value={action} onChange={(e) => set(setAction)(e.target.value)} className="sm:w-52" aria-label="Action">
            <option value="">All actions</option>
            {facets.data?.actions.map((a) => (
              <option key={a.value} value={a.value}>
                {words(a.value)} ({a.count})
              </option>
            ))}
          </Select>
          <Select value={entity} onChange={(e) => set(setEntity)(e.target.value)} className="sm:w-40" aria-label="Record type">
            <option value="">All records</option>
            {facets.data?.entities.map((a) => (
              <option key={a.value} value={a.value}>
                {entityName(a.value)}
              </option>
            ))}
          </Select>
          <Input value={ip} onChange={(e) => set(setIp)(e.target.value)} placeholder="IP address" className="sm:w-36" aria-label="IP address" />
        </div>
        <DateRangeFilter value={range} onChange={set(setRange)} />
      </div>

      <Card className="overflow-hidden">
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : !list.data ? (
          <Skeleton className="m-4 h-72" />
        ) : !rows.length ? (
          <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No entries match" body="Try a wider date range or clear a filter." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="w-8 px-3 py-2.5" />
                    <th className="px-3 py-2.5">When</th>
                    <th className="px-3 py-2.5">Who</th>
                    <th className="px-3 py-2.5">Action</th>
                    <th className="px-3 py-2.5">Record</th>
                    <th className="px-3 py-2.5">IP address</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((e) => {
                    const isOpen = open === e.id;
                    return (
                      <Fragment key={e.id}>
                        <tr className={cx('cursor-pointer hover:bg-ink-50/60', isOpen && 'bg-ink-50/60')} onClick={() => setOpen(isOpen ? null : e.id)}>
                          <td className="px-3 py-2.5 text-ink-400">
                            <button aria-label={isOpen ? 'Hide details' : 'Show details'} aria-expanded={isOpen} className="grid place-items-center">
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <span className="font-medium text-ink">{timeAgo(e.at)}</span>
                            <span className="block text-xs text-ink-500">{fmtDateTime(e.at)}</span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <span className="font-medium text-ink">{e.actorName}</span>
                            {e.actorRole && <span className="block text-xs text-ink-500">{ROLE[e.actorRole] ?? e.actorRole}</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5">
                            <Badge tone={tone(e.action)}>{words(e.action)}</Badge>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs text-ink-500">{entityName(e.entity)}</span>
                            <span className="block max-w-[260px] truncate">
                              {e.link ? (
                                <Link href={e.link} onClick={(ev) => ev.stopPropagation()} className="font-medium text-teal-700 hover:underline">
                                  {e.entityLabel}
                                </Link>
                              ) : (
                                <span className="text-ink-700">{e.entityLabel ?? e.entityId ?? '—'}</span>
                              )}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-ink-600">{e.ip ?? '—'}</td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-ink-50/60">
                            <td />
                            <td colSpan={5} className="px-3 pb-4 pt-1">
                              <Changes e={e} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-ink-100 px-3">
              <Pagination page={page} pageSize={50} total={list.data.meta.total} onPage={setPage} />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
