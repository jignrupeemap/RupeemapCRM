'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MessageCircle, Phone, Plus, Search, SlidersHorizontal, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { CASE_STATUSES, CASE_STATUS_LABELS, STUCK_CASE_DAYS, type CaseStatus } from '@rupeemap/shared';
import { api } from '@/lib/api';
import { fmtDate, formatINR, loanTypeName } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { PartnerCardModal } from '@/components/partner-card';
import { Button, Card, cx, EmptyState, ErrorState, Input, Pagination, Select, Skeleton, StatusChip } from '@/components/ui';

interface CaseRow {
  id: string;
  caseNo: string;
  loanType: string;
  loanAccountNo: string | null;
  status: CaseStatus;
  appliedAmount: string;
  handoverAmount: string | null;
  sanctionAmount: string | null;
  disbursedTotal: string | null;
  disbursementType: 'PART' | 'PART_TO_FULL' | 'FULL' | null;
  createdAt: string;
  daysInStage: number;
  customer: { name: string; mobile: string | null };
  bank: { id: string; name: string };
  project: { id: string; name: string } | null;
  dsa: { id: string; name: string; mobile: string } | null;
  teamPartner: { id: string; name: string; mobile: string } | null;
}

/** Part-disbursed cases: how much is still to be disbursed. */
function PartPayment({ c }: { c: CaseRow }) {
  if (c.status !== 'DISBURSED' || c.disbursementType !== 'PART') return null;
  const pending = Math.max(0, Number(c.sanctionAmount ?? 0) - Number(c.disbursedTotal ?? 0));
  return (
    <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-brand-goldsoft px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
      Part payment{pending ? ` · ${formatINR(pending, { whole: true })} pending` : ''}
    </p>
  );
}

/** Who brought the case in: the Team Partner if any, otherwise the DSA ("Self" for the DSA viewing their own). */
function SourcedBy({ c, role, compact, onOpen }: { c: CaseRow; role?: string; compact?: boolean; onOpen?: (userId: string) => void }) {
  const person = c.teamPartner ?? c.dsa;
  if (!person) return <span className="text-ink-400">—</span>;
  const self = role === 'DSA' && !c.teamPartner;
  const label = self ? 'Self' : person.name;
  const sub = self ? null : c.teamPartner ? (role === 'DSA' ? 'Team Partner' : `Team Partner · ${c.dsa?.name ?? ''}`) : 'DSA Partner';
  const text = `Hello ${person.name}, this is about case ${c.caseNo} (${c.customer.name}).`;
  return (
    <div className={cx('flex items-center gap-2', compact && 'justify-between')}>
      <div className="min-w-0">
        {onOpen && !self ? (
          <button
            type="button"
            onClick={(e) => (e.preventDefault(), e.stopPropagation(), onOpen(person.id))}
            className="block max-w-full truncate text-left font-semibold text-teal-800 underline-offset-2 hover:underline"
            title={`Open ${person.name}'s profile`}
          >
            {label}
          </button>
        ) : (
          <p className={cx('truncate font-semibold', self ? 'text-teal-800' : 'text-ink')}>{label}</p>
        )}
        {sub && !compact && <p className="truncate text-xs text-ink-500">{sub}</p>}
      </div>
      {!self && (
        <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
          <a href={`tel:+91${person.mobile}`} className="rounded-lg p-1.5 text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-100" aria-label={`Call ${person.name}`} title={`Call +91 ${person.mobile}`}>
            <Phone className="h-3.5 w-3.5" />
          </a>
          <a
            href={`https://wa.me/91${person.mobile}?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg p-1.5 text-emerald-700 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-50"
            aria-label={`WhatsApp ${person.name}`}
            title="WhatsApp"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </a>
        </div>
      )}
    </div>
  );
}

export default function CasesPage() {
  return (
    <Suspense>
      <Cases />
    </Suspense>
  );
}

function Cases() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const can = useCan();
  const { data: me } = useMe();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [showFilters, setShowFilters] = useState(false);
  const [profileOf, setProfileOf] = useState<string | null>(null);
  const openProfile = me?.role === 'ADMIN' || me?.role === 'EXECUTIVE' ? setProfileOf : undefined;

  const filters = {
    q: params.get('q') ?? '',
    status: params.get('status') ?? '',
    loanType: params.get('loanType') ?? '',
    bankId: params.get('bankId') ?? '',
    projectId: params.get('projectId') ?? '',
    teamPartnerId: params.get('teamPartnerId') ?? '',
    dsaId: params.get('dsaId') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    stuck: params.get('stuck') === '1' ? '1' : '',
    partPayment: params.get('partPayment') === '1' ? '1' : '',
    page: Number(params.get('page') ?? 1),
  };
  const set = (patch: Partial<typeof filters>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries({ ...patch, page: patch.page ?? 1 })) {
      if (v === '' || v === undefined || (k === 'page' && v === 1)) next.delete(k);
      else next.set(k, String(v));
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => q !== filters.q && set({ q }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const list = useQuery({
    queryKey: ['cases', filters],
    queryFn: () => api.page<CaseRow>('/cases', { ...filters, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string }[]>('/banks'), staleTime: 3600_000 });
  const loanTypes = useQuery({ queryKey: ['loan-types'], queryFn: () => api.get<{ code: string; name: string }[]>('/loan-types'), staleTime: 3600_000 });
  const projects = useQuery({ queryKey: ['projects', 'all'], queryFn: () => api.page<{ id: string; name: string }>('/projects', { pageSize: 100 }), staleTime: 300_000 });
  const team = useQuery({
    queryKey: ['team-list'],
    queryFn: () => api.page<{ id: string; name: string }>('/users', { role: 'TEAM_PARTNER', pageSize: 100 }),
    enabled: me?.role === 'DSA',
  });

  const activeStatuses = filters.status ? filters.status.split(',') : [];
  const filterCount = ['loanType', 'bankId', 'projectId', 'teamPartnerId', 'dsaId', 'from', 'to'].filter((k) => (filters as any)[k]).length;

  return (
    <div>
      <PageHeader
        title="All Cases"
        sub={list.data ? `${list.data.meta.total} ${list.data.meta.total === 1 ? 'case' : 'cases'}` : ' '}
        actions={
          can('CASE_CREATE') && (
            <Link href="/cases/new">
              <Button icon={<Plus className="h-4 w-4" />}>Add New Case</Button>
            </Link>
          )
        }
      />

      {profileOf && <PartnerCardModal userId={profileOf} onClose={() => setProfileOf(null)} />}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, mobile, case ID or loan account" className="pl-9" aria-label="Search cases" />
          </div>
          <Button variant="secondary" onClick={() => setShowFilters((v) => !v)} icon={<SlidersHorizontal className="h-4 w-4" />} aria-expanded={showFilters}>
            <span className="hidden sm:inline">Filters</span>
            {filterCount > 0 && <span className="rounded-full bg-teal-700 px-1.5 text-xs text-white">{filterCount}</span>}
          </Button>
        </div>

        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Status">
          <button
            onClick={() => set({ partPayment: filters.partPayment ? '' : '1', status: '' })}
            aria-pressed={!!filters.partPayment}
            className={cx(
              'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset',
              filters.partPayment ? 'bg-amber-600 text-white ring-amber-600' : 'bg-brand-goldsoft text-amber-900 ring-amber-200 hover:brightness-95',
            )}
            title="Cases disbursed in part, waiting for full disbursement"
          >
            Part payment {filters.partPayment && <X className="h-3.5 w-3.5" aria-label="Remove filter" />}
          </button>
          {filters.stuck && (
            <button onClick={() => set({ stuck: '' })} className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand-red px-3 py-1.5 text-sm font-semibold text-white" title="Show all cases again">
              Stuck {STUCK_CASE_DAYS}+ days in one stage <X className="h-3.5 w-3.5" aria-label="Remove filter" />
            </button>
          )}
          <button onClick={() => set({ status: '' })} className={cx('shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset', !activeStatuses.length ? 'bg-teal-700 text-white ring-teal-700' : 'bg-white text-ink-600 ring-ink-200')}>
            All
          </button>
          {CASE_STATUSES.map((st) => {
            const on = activeStatuses.includes(st);
            return (
              <button
                key={st}
                aria-pressed={on}
                onClick={() => set({ status: on ? activeStatuses.filter((x) => x !== st).join(',') : [...activeStatuses, st].join(',') })}
                className={cx('shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset', on ? 'bg-teal-700 text-white ring-teal-700' : 'bg-white text-ink-600 ring-ink-200')}
              >
                {CASE_STATUS_LABELS[st]}
              </button>
            );
          })}
          {can('PAYOUT_VIEW') && (
            <Link
              href={`/payouts?${new URLSearchParams({
                ...(filters.teamPartnerId ? { beneficiaryId: filters.teamPartnerId } : {}),
                ...(filters.from ? { from: filters.from } : {}),
                ...(filters.to ? { to: filters.to } : {}),
              }).toString()}`}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand-goldsoft px-3 py-1.5 text-sm font-semibold text-amber-900 ring-1 ring-inset ring-amber-200 hover:brightness-95"
            >
              <Wallet className="h-4 w-4" /> Payout
            </Link>
          )}
        </div>

        {showFilters && (
          <Card className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6">
            <Select aria-label="Loan type" value={filters.loanType} onChange={(e) => set({ loanType: e.target.value })}>
              <option value="">All loan types</option>
              {loanTypes.data?.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </Select>
            <Select aria-label="Bank" value={filters.bankId} onChange={(e) => set({ bankId: e.target.value })}>
              <option value="">All banks</option>
              {banks.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select aria-label="Project" value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })}>
              <option value="">All projects</option>
              {projects.data?.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            {me?.role === 'DSA' ? (
              <Select aria-label="Team Partner" value={filters.teamPartnerId} onChange={(e) => set({ teamPartnerId: e.target.value })}>
                <option value="">Everyone in team</option>
                {team.data?.data.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            ) : (
              <div className="hidden lg:block" />
            )}
            <Input type="date" aria-label="From date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
            <Input type="date" aria-label="To date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
            {filterCount > 0 && (
              <button onClick={() => set({ loanType: '', bankId: '', projectId: '', teamPartnerId: '', dsaId: '', from: '', to: '' })} className="flex items-center gap-1 text-sm font-semibold text-brand-red sm:col-span-2 lg:col-span-6">
                <X className="h-4 w-4" /> Clear filters
              </button>
            )}
          </Card>
        )}

        {list.isError ? (
          <Card>
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </Card>
        ) : list.isLoading ? (
          <Card className="space-y-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </Card>
        ) : !list.data?.data.length ? (
          <Card>
            <EmptyState
              title={filters.q || filters.status || filterCount ? 'No cases match these filters' : 'No cases yet'}
              body={filters.q || filters.status || filterCount ? 'Try a different search or clear the filters.' : 'Cases you add appear here with their current stage.'}
            />
          </Card>
        ) : (
          <>
            {/* Desktop table */}
            <Card className="hidden overflow-hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-4 py-3">Customer</th>
                      {me?.role !== 'TEAM_PARTNER' && <th className="px-4 py-3">Sourced by</th>}
                      <th className="px-4 py-3">Loan type</th>
                      <th className="px-4 py-3">Loan account</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="hidden px-4 py-3 text-right lg:table-cell">Amount</th>
                      <th className="hidden px-4 py-3 xl:table-cell">Bank</th>
                      <th className="hidden px-4 py-3 xl:table-cell">Project</th>
                      <th className="hidden px-4 py-3 lg:table-cell">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {list.data.data.map((c) => (
                      <tr key={c.id} className="hover:bg-ink-50/60">
                        <td className="px-4 py-3">
                          <Link href={`/cases/${c.id}`} className="font-semibold text-ink hover:text-teal-700 hover:underline">
                            {c.customer.name}
                          </Link>
                          <p className="whitespace-nowrap text-xs text-ink-500">{c.caseNo}</p>
                        </td>
                        {me?.role !== 'TEAM_PARTNER' && (
                          <td className="max-w-[220px] px-4 py-3">
                            <SourcedBy c={c} role={me?.role} onOpen={openProfile} />
                          </td>
                        )}
                        <td className="px-4 py-3 text-ink-700">{loanTypeName(c.loanType)}</td>
                        <td className="px-4 py-3 tabular-nums text-ink-700">{c.loanAccountNo ?? <span className="text-ink-400">—</span>}</td>
                        <td className="px-4 py-3">
                          <StatusChip status={c.status} />
                          <PartPayment c={c} />
                          {c.daysInStage > 15 && !['HANDOVER', 'REJECT', 'WITHDRAW'].includes(c.status) && <p className="mt-1 text-xs font-medium text-brand-red">{c.daysInStage} days in stage</p>}
                        </td>
                        <td className="hidden px-4 py-3 text-right tabular-nums lg:table-cell">{formatINR(c.handoverAmount ?? c.appliedAmount, { whole: true })}</td>
                        <td className="hidden px-4 py-3 text-ink-700 xl:table-cell">{c.bank.name}</td>
                        <td className="hidden px-4 py-3 text-ink-700 xl:table-cell">{c.project?.name ?? '—'}</td>
                        <td className="hidden px-4 py-3 text-ink-500 lg:table-cell">{fmtDate(c.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {/* Mobile cards */}
            <ul className="space-y-2 md:hidden">
              {list.data.data.map((c) => (
                <li key={c.id} className="rounded-2xl border border-ink-200/70 bg-white shadow-card">
                  <Link href={`/cases/${c.id}`} className="block rounded-t-2xl p-4 pb-3 active:bg-ink-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">{c.customer.name}</p>
                        <p className="text-sm text-ink-600">{loanTypeName(c.loanType)}</p>
                      </div>
                      <div className="text-right">
                        <StatusChip status={c.status} />
                        <PartPayment c={c} />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-ink-500">
                      <span className="tabular-nums">{c.loanAccountNo ? `A/c ${c.loanAccountNo}` : c.caseNo}</span>
                      <span className="tabular-nums font-semibold text-ink-700">{formatINR(c.handoverAmount ?? c.appliedAmount, { whole: true })}</span>
                    </div>
                  </Link>
                  {me?.role !== 'TEAM_PARTNER' && (
                    <div className="flex items-center gap-2 border-t border-ink-100 px-4 py-2 text-sm">
                      <span className="shrink-0 text-xs text-ink-500">Sourced by</span>
                      <div className="min-w-0 flex-1">
                        <SourcedBy c={c} role={me?.role} compact onOpen={openProfile} />
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Pagination page={list.data.meta.page} pageSize={list.data.meta.pageSize} total={list.data.meta.total} onPage={(p) => set({ page: p })} />
          </>
        )}
      </div>
    </div>
  );
}
