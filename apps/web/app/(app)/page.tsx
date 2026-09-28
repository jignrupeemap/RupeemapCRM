'use client';
import { useQuery } from '@tanstack/react-query';
import {
  BookUser,
  Building2,
  ClipboardCheck,
  FileStack,
  Hash,
  HelpCircle,
  LifeBuoy,
  Plus,
  Users,
  Wallet,
  AlarmClock,
  ArrowUpRight,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { ROLE_LABELS, type CaseStatus, type Permission } from '@rupeemap/shared';
import { api } from '@/lib/api';
import { fmtDate, formatINR, formatINRCompact, loanTypeName } from '@/lib/format';
import { useMe } from '@/lib/session';
import { HeroSlider, type Slide } from '@/components/hero-slider';
import { Banner, Card, cx, EmptyState, Kpi, SectionTitle, Skeleton, StatusChip } from '@/components/ui';

const TrendChart = dynamic(() => import('@/components/trend-chart'), { ssr: false, loading: () => <Skeleton className="h-56" /> });

interface Summary {
  cases: Record<string, number> & { total: number };
  amounts: { applied: number; sanctioned: number; disbursed: number; handover: number };
  conversion: { sanction: number; disbursed: number; handover: number };
  payouts: Record<string, { count: number; amount: number }>;
  bankReceived: { count: number; amount: number };
  stuckCases: number;
  projects: { projectId: string; name: string; city: string; cases: number; appliedAmount: number; disbursedAmount: number; handoverAmount: number }[];
  recent: { id: string; caseNo: string; status: CaseStatus; loanType: string; appliedAmount: string; createdAt: string; customer: { name: string }; bank: { name: string } }[];
  trend: { month: string; logins: number; handovers: number; handoverAmount: number }[];
  users: { role: string; status: string; count: number }[];
}

const QUICK: { href: string; label: string; icon: typeof Plus; perm?: Permission; roles?: string[]; tone: string }[] = [
  { href: '/cases/new', label: 'Add New Case', icon: Plus, perm: 'CASE_CREATE', tone: 'bg-ink text-white' },
  { href: '/cases', label: 'All Cases', icon: FileStack, tone: 'bg-sky-50 text-sky-800' },
  { href: '/team', label: 'Team Data', icon: Users, perm: 'USER_VIEW', roles: ['DSA'], tone: 'bg-violet-50 text-violet-800' },
  { href: '/users', label: 'Users', icon: Users, perm: 'USER_VIEW', roles: ['ADMIN', 'EXECUTIVE'], tone: 'bg-violet-50 text-violet-800' },
  { href: '/payouts', label: 'Payout', icon: Wallet, perm: 'PAYOUT_VIEW', tone: 'bg-brand-goldsoft text-amber-800' },
  { href: '/projects', label: 'Project Master', icon: Building2, perm: 'PROJECT_VIEW', tone: 'bg-teal-50 text-teal-800' },
  { href: '/checklist', label: 'Checklist', icon: ClipboardCheck, perm: 'CHECKLIST_VIEW', tone: 'bg-emerald-50 text-emerald-800' },
  { href: '/bank-codes', label: 'Bankwise Code', icon: Hash, perm: 'BANK_CODE_VIEW', tone: 'bg-ink-100 text-ink-700' },
  { href: '/bankers', label: 'Bankers', icon: BookUser, perm: 'BANKER_VIEW', tone: 'bg-rose-50 text-rose-800' },
  { href: '/queries', label: 'Raise Query', icon: HelpCircle, perm: 'QUERY_CREATE', tone: 'bg-orange-50 text-orange-800' },
  { href: '/assistance', label: 'Need Assistance', icon: LifeBuoy, perm: 'SUPPORT_CREATE', tone: 'bg-brand-redsoft text-red-800' },
];

const RANGES = [
  { key: 'all', label: 'All time' },
  { key: 'month', label: 'This month' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'today', label: 'Today' },
] as const;

function rangeParams(k: string) {
  const now = new Date();
  if (k === 'today') return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() };
  if (k === 'week') return { from: new Date(Date.now() - 7 * 86400000).toISOString() };
  if (k === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() };
  return {};
}

export default function DashboardPage() {
  const { data: me } = useMe();
  const [range, setRange] = useState<string>('all');
  const sliders = useQuery({ queryKey: ['sliders'], queryFn: () => api.get<Slide[]>('/sliders/active'), staleTime: 300_000 });
  const summary = useQuery({ queryKey: ['dashboard', range], queryFn: () => api.get<Summary>('/dashboard/summary', rangeParams(range)) });
  if (!me) return null;
  const isAdmin = me.role === 'ADMIN' || me.role === 'EXECUTIVE';
  const s = summary.data;
  const quick = QUICK.filter((q) => (!q.perm || me.permissions.includes(q.perm)) && (!q.roles || q.roles.includes(me.role)));
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-ink-500">{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'},</p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">{me.name}</h1>
        </div>
        <p className="text-sm text-ink-500">
          {ROLE_LABELS[me.role]}
          {me.dsaCode && ` · ${me.dsaCode}`}
          {me.dsa && ` · Team of ${me.dsa.name}`}
        </p>
      </div>

      {sliders.isLoading ? <Skeleton className="h-[210px] rounded-3xl lg:h-[34vh]" /> : <HeroSlider slides={sliders.data ?? []} />}

      {(me.role === 'DSA' || me.role === 'TEAM_PARTNER') && me.kycStatus && me.kycStatus !== 'APPROVED' && (
        <Banner title="First payout KYC verification pending" tone="gold">
          PAN, Aadhaar, cancelled cheque{me.role === 'DSA' ? ', GST certificate (if applicable)' : ''} and a photograph are needed before your first payout can be released. Share them with your Rupeemap executive.
        </Banner>
      )}

      <section aria-label="Quick actions">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-10">
          {quick.map((q) => (
            <Link key={q.href} href={q.href} className="group flex flex-col items-center gap-2 rounded-2xl p-2 text-center transition hover:bg-white hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
              <span className={cx('flex h-12 w-12 items-center justify-center rounded-2xl transition group-hover:scale-105', q.tone)}>
                <q.icon className="h-[22px] w-[22px]" />
              </span>
              <span className="text-[12px] font-semibold leading-tight text-ink-700">{q.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Key numbers" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-bold">{isAdmin ? 'Organisation overview' : me.role === 'DSA' ? 'You and your team' : 'Your cases'}</h2>
          <div className="flex rounded-xl bg-white p-1 shadow-card ring-1 ring-ink-200/70" role="tablist" aria-label="Date range">
            {RANGES.map((r) => (
              <button key={r.key} role="tab" aria-selected={range === r.key} onClick={() => setRange(r.key)} className={cx('rounded-lg px-2.5 py-1.5 text-xs font-semibold', range === r.key ? 'bg-ink text-white' : 'text-ink-600 hover:bg-ink-50')}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {!s ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-2xl" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <Kpi label="Total cases" value={s.cases.total} sub={formatINRCompact(s.amounts.applied) + ' applied'} href="/cases" />
              <Kpi label="Login" value={s.cases.LOGIN} href="/cases?status=LOGIN" />
              <Kpi label="Sanction" value={s.cases.SANCTION} sub={`${s.conversion.sanction}% reached`} href="/cases?status=SANCTION" />
              <Kpi label="Disbursed" value={s.cases.DISBURSED} sub={formatINRCompact(s.amounts.disbursed)} tone="teal" href="/cases?status=DISBURSED" />
              <Kpi label="Handover" value={s.cases.HANDOVER} sub={formatINRCompact(s.amounts.handover)} tone="teal" href="/cases?status=HANDOVER" />
              <Kpi label="Query" value={s.cases.QUERY} tone={s.cases.QUERY ? 'gold' : 'neutral'} href="/cases?status=QUERY" />
              <Kpi label="Reject" value={s.cases.REJECT} tone={s.cases.REJECT ? 'red' : 'neutral'} href="/cases?status=REJECT" />
              <Kpi label="Withdraw" value={s.cases.WITHDRAW} href="/cases?status=WITHDRAW" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              <Kpi label="Pending payout" value={formatINRCompact(s.payouts.PENDING.amount)} sub={`${s.payouts.PENDING.count} payouts`} tone="gold" href="/payouts?status=PENDING" />
              <Kpi label="Confirmed" value={formatINRCompact(s.payouts.CONFIRMED.amount)} sub={`${s.payouts.CONFIRMED.count} payouts`} href="/payouts?status=CONFIRMED" />
              <Kpi label="Paid" value={formatINRCompact(s.payouts.PAID.amount)} sub={`${s.payouts.PAID.count} payouts`} tone="teal" href="/payouts?status=PAID" />
              <Kpi label="Hold" value={formatINRCompact(s.payouts.HOLD.amount)} sub={`${s.payouts.HOLD.count} payouts`} tone={s.payouts.HOLD.count ? 'red' : 'neutral'} href="/payouts?status=HOLD" />
              <Kpi label="Recovery" value="₹0" sub="Module in Phase 11" />
            </div>
          </>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <SectionTitle title="Logins and handovers" sub="Last 6 months, by month of login" />
          {s ? <TrendChart data={s.trend} /> : <Skeleton className="h-56" />}
        </Card>
        <Card className="p-5 lg:col-span-2">
          <SectionTitle
            title="Needs attention"
            action={
              <Link href="/cases?status=LOGIN,SANCTION,DISBURSED,QUERY" className="text-sm font-semibold text-teal-700">
                View cases
              </Link>
            }
          />
          {s ? (
            <ul className="space-y-3">
              <AttentionRow icon={<AlarmClock className="h-4 w-4" />} tone="red" label="Cases stuck more than 15 days in one stage" value={s.stuckCases} />
              <AttentionRow icon={<HelpCircle className="h-4 w-4" />} tone="gold" label="Cases in Query" value={s.cases.QUERY} />
              <AttentionRow icon={<Wallet className="h-4 w-4" />} tone="gold" label="Payouts on Hold" value={s.payouts.HOLD.count} />
              <AttentionRow icon={<Wallet className="h-4 w-4" />} tone="teal" label="Received from bank" value={`${s.bankReceived.count} · ${formatINRCompact(s.bankReceived.amount)}`} />
            </ul>
          ) : (
            <Skeleton className="h-40" />
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="p-5 pb-2">
            <SectionTitle title="Recent cases" action={<Link href="/cases" className="text-sm font-semibold text-teal-700">All cases</Link>} />
          </div>
          {s && !s.recent.length ? (
            <EmptyState title="No cases yet" body="Add your first case to start tracking it from Login to Handover." action={me.permissions.includes('CASE_CREATE') && <Link href="/cases/new" className="font-semibold text-teal-700">Add New Case</Link>} />
          ) : (
            <ul className="divide-y divide-ink-100">
              {(s?.recent ?? []).map((c) => (
                <li key={c.id}>
                  <Link href={`/cases/${c.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-ink-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{c.customer.name}</p>
                      <p className="truncate text-xs text-ink-500">
                        {c.caseNo} · {loanTypeName(c.loanType)} · {c.bank.name}
                      </p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <p className="text-sm font-semibold tabular-nums">{formatINR(c.appliedAmount, { whole: true })}</p>
                      <p className="text-xs text-ink-500">{fmtDate(c.createdAt)}</p>
                    </div>
                    <StatusChip status={c.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <div className="p-5 pb-2">
            <SectionTitle title="Project-wise logins" sub="Sorted by number of cases" action={<Link href="/projects" className="text-sm font-semibold text-teal-700">Project Master</Link>} />
          </div>
          {s && !s.projects.length ? (
            <EmptyState title="No project cases yet" body="Cases linked to a Project Master entry appear here." />
          ) : (
            <ul className="space-y-1 px-5 pb-5">
              {(s?.projects ?? []).slice(0, 6).map((p, i, arr) => (
                <li key={p.projectId} className="py-2">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate font-semibold">{p.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-600">
                      {p.cases} {p.cases === 1 ? 'case' : 'cases'} · {formatINRCompact(p.appliedAmount)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-teal" style={{ width: `${(p.cases / arr[0].cases) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {p.city} · Handover {formatINRCompact(p.handoverAmount)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {isAdmin && s && s.users.length > 0 && <UsersOverview users={s.users} />}
    </div>
  );
}

function AttentionRow({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: 'red' | 'gold' | 'teal' }) {
  const t = { red: 'bg-brand-redsoft text-red-700', gold: 'bg-brand-goldsoft text-amber-700', teal: 'bg-teal-50 text-teal-700' }[tone];
  return (
    <li className="flex items-center gap-3">
      <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', t)}>{icon}</span>
      <span className="flex-1 text-sm text-ink-700">{label}</span>
      <span className="font-display text-lg font-bold tabular-nums">{value}</span>
    </li>
  );
}

function UsersOverview({ users }: { users: { role: string; status: string; count: number }[] }) {
  const count = (role?: string, status?: string) => users.filter((u) => (!role || u.role === role) && (!status || u.status === status)).reduce((a, u) => a + u.count, 0);
  return (
    <section aria-label="Users">
      <SectionTitle title="Users" action={<Link href="/users" className="text-sm font-semibold text-teal-700">Manage users <ArrowUpRight className="inline h-4 w-4" /></Link>} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="DSA Partners" value={count('DSA')} href="/users?role=DSA" />
        <Kpi label="Team Partners" value={count('TEAM_PARTNER')} href="/users?role=TEAM_PARTNER" />
        <Kpi label="Executives" value={count('EXECUTIVE')} href="/users?role=EXECUTIVE" />
        <Kpi label="Active" value={count(undefined, 'ACTIVE')} tone="teal" />
        <Kpi label="Blocked" value={count(undefined, 'BLOCKED')} tone={count(undefined, 'BLOCKED') ? 'red' : 'neutral'} />
        <Kpi label="Suspended" value={count(undefined, 'SUSPENDED')} />
      </div>
    </section>
  );
}
