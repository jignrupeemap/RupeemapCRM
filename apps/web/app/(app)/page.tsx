'use client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
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
  UserMinus,
  Upload,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState } from 'react';
import { ROLE_LABELS, type CaseStatus, type Permission } from '@rupeemap/shared';
import { api } from '@/lib/api';
import { fmtDate, formatINR, formatINRCompact, loanTypeName } from '@/lib/format';
import { useMe } from '@/lib/session';
import { HeroSlider, type Slide } from '@/components/hero-slider';
import { DateRangeFilter, DEFAULT_RANGE, rangeToParams, type RangeValue } from '@/components/date-range';
import { Banner, Card, cx, EmptyState, Kpi, SectionTitle, Skeleton, StatusChip } from '@/components/ui';
import { PartnerConsolidation } from '@/components/partner-consolidation';

const TrendChart = dynamic(() => import('@/components/trend-chart'), { ssr: false, loading: () => <Skeleton className="h-56" /> });

interface InactivitySummary {
  watch: number;
  alert: number;
  due: number;
  deactivated: number;
}

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
  insurance: { policies: number; total: number; received: number; pending: number } | null;
  recovery: { count: number; amount: number } | null;
}

const QUICK: { href: string; label: string; icon: typeof Plus; perm?: Permission; roles?: string[]; tone: string }[] = [
  { href: '/cases/new', label: 'Add New Case', icon: Plus, perm: 'CASE_CREATE', tone: 'bg-brand-gradient text-white shadow-brand' },
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


export default function DashboardPage() {
  const { data: me } = useMe();
  const [range, setRange] = useState<RangeValue>(DEFAULT_RANGE);
  const params = rangeToParams(range);
  const rangeReady = range.key !== 'custom' || !range.from || !range.to || range.from <= range.to;
  const sliders = useQuery({ queryKey: ['sliders'], queryFn: () => api.get<Slide[]>('/sliders/active'), staleTime: 300_000 });
  const summary = useQuery({ queryKey: ['dashboard', params], queryFn: () => api.get<Summary>('/dashboard/summary', params), enabled: rangeReady, placeholderData: keepPreviousData });
  const isStaff = me?.role === 'ADMIN' || me?.role === 'EXECUTIVE';
  const tickets = useQuery({
    queryKey: ['tickets', 'counts'],
    queryFn: () => api.get<Record<'QUERY' | 'ASSISTANCE', { open: number; waiting: number }>>('/tickets/counts'),
    staleTime: 60_000,
  });
  const inactivity = useQuery({
    queryKey: ['inactivity', 'summary'],
    queryFn: () => api.get<InactivitySummary>('/inactivity/summary'),
    enabled: !!isStaff && !!me?.permissions.includes('USER_VIEW'),
    staleTime: 300_000,
  });
  if (!me) return null;
  const isAdmin = isStaff;
  const s = summary.data;
  const quick = QUICK.filter((q) => (!q.perm || me.permissions.includes(q.perm)) && (!q.roles || q.roles.includes(me.role)));
  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-ink-500">
            {hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'} ·{' '}
            {new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(new Date())}
          </p>
          <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-tight">{me.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full bg-teal-700 px-3 py-1 text-xs font-semibold text-white">{ROLE_LABELS[me.role]}</span>
          {me.dsaCode && <span className="inline-flex items-center rounded-full bg-white px-3 py-1 font-mono text-xs font-semibold text-ink-700 ring-1 ring-inset ring-ink-200">{me.dsaCode}</span>}
          {me.dsa && <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-medium text-ink-600 ring-1 ring-inset ring-ink-200">Team of {me.dsa.name}</span>}
        </div>
      </div>

      {sliders.isLoading ? <Skeleton className="h-[210px] rounded-3xl lg:h-[34vh]" /> : <HeroSlider slides={sliders.data ?? []} />}

      {(me.role === 'DSA' || me.role === 'TEAM_PARTNER') && me.kycStatus && me.kycStatus !== 'APPROVED' && (
        <Banner
          title={me.kycStatus === 'UNDER_ADMIN_VERIFICATION' ? 'First payout KYC is being verified' : me.kycStatus === 'RESUBMISSION_REQUIRED' ? 'First payout KYC: new documents needed' : 'First payout KYC verification pending'}
          tone={me.kycStatus === 'UNDER_ADMIN_VERIFICATION' ? 'teal' : 'gold'}
          action={
            me.kycStatus !== 'UNDER_ADMIN_VERIFICATION' && (
              <Link href="/profile#kyc" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white shadow-brand hover:brightness-110">
                <Upload className="h-4 w-4" /> {me.kycStatus === 'RESUBMISSION_REQUIRED' ? 'Fix documents' : 'Upload documents'}
              </Link>
            )
          }
        >
          {me.kycStatus === 'UNDER_ADMIN_VERIFICATION'
            ? 'Your documents are with Rupeemap Admin. Your first payout can be released once they are approved.'
            : `Upload your PAN, masked Aadhaar, cancelled cheque, photograph${me.role === 'DSA' ? ' and GST certificate (if GST registered)' : ''} so your first payout can be released.`}
        </Banner>
      )}

      <section aria-label="Quick actions">
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-10">
          {quick.map((q) => (
            <Link key={q.href} href={q.href} className="group flex flex-col items-center gap-2 rounded-2xl border border-transparent p-2.5 text-center transition hover:border-ink-200/60 hover:bg-white hover:shadow-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500">
              <span className={cx('flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-inset ring-black/[.04] transition group-hover:-translate-y-0.5', q.tone)}>
                <q.icon className="h-[22px] w-[22px]" />
              </span>
              <span className="text-[12px] font-semibold leading-tight text-ink-700">{q.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Key numbers" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h2 className="pt-1.5 font-display text-[17px] font-bold">{isAdmin ? 'Organisation overview' : me.role === 'DSA' ? 'You and your team' : 'Your cases'}</h2>
          <DateRangeFilter value={range} onChange={setRange} />
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
            <div className={cx('grid grid-cols-2 gap-3 sm:grid-cols-4', s.insurance ? 'lg:grid-cols-6' : 'lg:grid-cols-5')}>
              <Kpi label="Pending payout" value={formatINRCompact(s.payouts.PENDING.amount)} sub={`${s.payouts.PENDING.count} payouts`} tone="gold" href="/payouts?status=PENDING" />
              <Kpi label="Confirmed" value={formatINRCompact(s.payouts.CONFIRMED.amount)} sub={`${s.payouts.CONFIRMED.count} payouts`} href="/payouts?status=CONFIRMED" />
              <Kpi label="Paid" value={formatINRCompact(s.payouts.PAID.amount)} sub={`${s.payouts.PAID.count} payouts`} tone="teal" href="/payouts?status=PAID" />
              <Kpi label="Hold" value={formatINRCompact(s.payouts.HOLD.amount)} sub={`${s.payouts.HOLD.count} payouts`} tone={s.payouts.HOLD.count ? 'red' : 'neutral'} href="/payouts?status=HOLD" />
              <Kpi label="Recovery outstanding" value={formatINRCompact(s.recovery?.amount ?? 0)} sub={`${s.recovery?.count ?? 0} open`} tone={s.recovery?.amount ? 'red' : 'neutral'} href="/recovery" />
              {s.insurance && (
                <Kpi label="Insurance payout (Rupeemap)" value={formatINRCompact(s.insurance.total)} sub={`${formatINRCompact(s.insurance.received)} received · ${s.insurance.policies} policies`} tone="teal" href="/insurance" />
              )}
            </div>
          </>
        )}
      </section>

      {isStaff && me.permissions.includes('CASE_VIEW_ALL') && (
        <PartnerConsolidation
          params={params}
          overview={s ? { cases: s.cases.total, payouts: Object.values(s.payouts).reduce((a, p) => a + p.amount, 0) } : undefined}
        />
      )}

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
              {tickets.data && (
                <li>
                  <Link href={isStaff ? '/assistance' : '/queries'} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-1 hover:bg-ink-50">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-goldsoft text-amber-700">
                      <LifeBuoy className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-sm text-ink-700">{isStaff ? 'Queries and assistance to answer' : 'Replies from Rupeemap waiting for you'}</span>
                    <span className="font-display text-lg font-bold tabular-nums">
                      {isStaff ? tickets.data.QUERY.open + tickets.data.ASSISTANCE.open : tickets.data.QUERY.waiting + tickets.data.ASSISTANCE.waiting}
                    </span>
                  </Link>
                </li>
              )}
              {inactivity.data && (
                <li>
                  <Link href="/inactive-partners" className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-1 hover:bg-ink-50">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-redsoft text-red-700">
                      <UserMinus className="h-4 w-4" />
                    </span>
                    <span className="flex-1 text-sm text-ink-700">Partners with no business for 60+ days</span>
                    <span className="font-display text-lg font-bold tabular-nums">{inactivity.data.alert + inactivity.data.due}</span>
                  </Link>
                </li>
              )}
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

      {isAdmin && s && s.users.length > 0 && <UsersOverview users={s.users} inactivity={inactivity.data} />}
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

function UsersOverview({ users, inactivity }: { users: { role: string; status: string; count: number }[]; inactivity?: InactivitySummary }) {
  const count = (role?: string, status?: string) => users.filter((u) => (!role || u.role === role) && (!status || u.status === status)).reduce((a, u) => a + u.count, 0);
  return (
    <section aria-label="Users">
      <SectionTitle title="Users" action={<Link href="/users" className="text-sm font-semibold text-teal-700">Manage users <ArrowUpRight className="inline h-4 w-4" /></Link>} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Kpi label="DSA Partners" value={count('DSA')} href="/users?role=DSA" />
        <Kpi label="Team Partners" value={count('TEAM_PARTNER')} href="/users?role=TEAM_PARTNER" />
        <Kpi label="Executives" value={count('EXECUTIVE')} href="/users?role=EXECUTIVE" />
        <Kpi label="Active" value={count(undefined, 'ACTIVE')} tone="teal" />
        <Kpi label="Blocked" value={count(undefined, 'BLOCKED')} tone={count(undefined, 'BLOCKED') ? 'red' : 'neutral'} />
        <Kpi label="Suspended" value={count(undefined, 'SUSPENDED')} />
        {inactivity && (
          <>
            <Kpi label="Inactive 60+ days" value={inactivity.alert + inactivity.due} sub={`${inactivity.watch} more at 30+ days`} tone={inactivity.alert + inactivity.due ? 'gold' : 'neutral'} href="/inactive-partners" />
            <Kpi label="Deactivated" value={inactivity.deactivated} sub="90 days, no business" tone={inactivity.deactivated ? 'red' : 'neutral'} href="/inactive-partners?tab=deactivated" />
          </>
        )}
      </div>
    </section>
  );
}
