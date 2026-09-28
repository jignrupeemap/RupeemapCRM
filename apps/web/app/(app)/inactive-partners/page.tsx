'use client';
/**
 * Inactive Partners (Admin and Executives): who has stopped doing business, so
 * the team can call them before the 90-day automatic deactivation.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Phone, PlayCircle, RotateCcw, UserMinus } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { INACTIVITY } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDate, initials } from '@/lib/format';
import { useMe } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui';

interface Row {
  id: string;
  name: string;
  mobile: string;
  role: 'DSA' | 'TEAM_PARTNER';
  status: string;
  dsaCode: string | null;
  dsaName: string | null;
  lastCaseAt: string | null;
  lastPayoutAt: string | null;
  lastLoginAt: string | null;
  lastActivityAt: string;
  daysInactive: number;
  totalCases: number;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  inactivityAlertedAt: string | null;
}
interface Report {
  items: Row[];
  summary: { watch: number; alert: number; due: number; deactivated: number };
}

const TABS = [
  { key: 'watch', label: `${INACTIVITY.WATCH_DAYS}–${INACTIVITY.ALERT_DAYS - 1} days`, hint: 'Slowing down', params: { minDays: INACTIVITY.WATCH_DAYS, maxDays: INACTIVITY.ALERT_DAYS } },
  { key: 'alert', label: `${INACTIVITY.ALERT_DAYS}+ days`, hint: 'Admin and Executives alerted', params: { minDays: INACTIVITY.ALERT_DAYS } },
  { key: 'deactivated', label: 'Deactivated', hint: `${INACTIVITY.DEACTIVATE_DAYS} days, code switched off`, params: { status: 'DEACTIVATED' } },
] as const;
type TabKey = (typeof TABS)[number]['key'];

function whatsappLink(r: Row) {
  const text = `Hello ${r.name}, this is Rupeemap. We haven't seen a new case from you for ${r.daysInactive} days. Is there anything we can help with to restart business? Share your next case with us.`;
  return `https://wa.me/91${r.mobile}?text=${encodeURIComponent(text)}`;
}

function DaysMeter({ days }: { days: number }) {
  const pct = Math.min(100, (days / INACTIVITY.DEACTIVATE_DAYS) * 100);
  const tone = days >= INACTIVITY.ALERT_DAYS ? 'bg-brand-red' : days >= INACTIVITY.WATCH_DAYS ? 'bg-brand-gold' : 'bg-teal';
  const left = INACTIVITY.DEACTIVATE_DAYS - days;
  return (
    <div className="min-w-[132px]">
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-xl font-bold tabular-nums">{days}</span>
        <span className="text-xs text-ink-500">days</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden>
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink-500">{left > 0 ? `${left} days to deactivation` : 'Deactivation due today'}</p>
    </div>
  );
}

function Inactive() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'alert') as TabKey;
  const [role, setRole] = useState('');
  const [q, setQ] = useState('');
  const [reactivating, setReactivating] = useState<Row | null>(null);
  const isAdmin = me?.role === 'ADMIN';
  const current = TABS.find((t) => t.key === tab)!;

  const report = useQuery({
    queryKey: ['inactivity', tab, role, q],
    queryFn: () => api.get<Report>('/inactivity/partners', { ...current.params, role, q }),
    placeholderData: keepPreviousData,
  });
  const run = useMutation({
    mutationFn: () => api.post<{ alerted: number; deactivated: number }>('/inactivity/run'),
    onSuccess: (r) => {
      toast.success(`Check done: ${r.alerted} newly alerted, ${r.deactivated} deactivated`);
      qc.invalidateQueries({ queryKey: ['inactivity'] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const s = report.data?.summary;
  const counts: Record<TabKey, number | undefined> = { watch: s?.watch, alert: s ? s.alert + s.due : undefined, deactivated: s?.deactivated };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inactive Partners"
        sub={`DSA and Team Partners with no case login or payout. Admin and Executives are alerted at ${INACTIVITY.ALERT_DAYS} days; the code is deactivated automatically at ${INACTIVITY.DEACTIVATE_DAYS} days and only Admin can reactivate it.`}
        actions={
          isAdmin && (
            <Button variant="secondary" icon={<PlayCircle className="h-4 w-4" />} loading={run.isPending} onClick={() => run.mutate()}>
              Run today&apos;s check now
            </Button>
          )
        }
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-3" role="tablist" aria-label="Inactivity">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => router.replace(`/inactive-partners?tab=${t.key}`)}
            className={cx(
              'rounded-2xl border p-3 text-left transition sm:p-4',
              tab === t.key ? 'border-ink bg-ink text-white shadow-pop' : 'border-ink-200/70 bg-white shadow-card hover:border-ink-300',
            )}
          >
            <span className={cx('block text-xs font-semibold uppercase tracking-wide', tab === t.key ? 'text-white/70' : 'text-ink-500')}>{t.label}</span>
            <span className="mt-1 block font-display text-2xl font-bold tabular-nums">{counts[t.key] ?? '–'}</span>
            <span className={cx('hidden text-xs sm:block', tab === t.key ? 'text-white/70' : 'text-ink-500')}>{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search name or mobile" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search partners" className="sm:max-w-xs" />
        <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" className="sm:max-w-[260px]">
          <option value="">DSA and Team Partners</option>
          <option value="DSA">DSA Partners</option>
          <option value="TEAM_PARTNER">Team Partners</option>
        </Select>
      </div>

      {report.isError ? (
        <Card>
          <ErrorState error={report.error} onRetry={() => report.refetch()} />
        </Card>
      ) : report.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !report.data?.items.length ? (
        <Card>
          <EmptyState
            icon={<UserMinus className="h-6 w-6" />}
            title={tab === 'deactivated' ? 'No deactivated codes' : 'Everyone here is doing business'}
            body={tab === 'deactivated' ? undefined : 'No partner in this range. Check the other tabs.'}
          />
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="px-4 py-3">Partner</th>
                  <th className="px-4 py-3">{tab === 'deactivated' ? 'Deactivated' : 'No business for'}</th>
                  <th className="px-4 py-3">Last case</th>
                  <th className="px-4 py-3">Last payout</th>
                  <th className="px-4 py-3">Last sign-in</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {report.data.items.map((r) => (
                  <tr key={r.id} className="hover:bg-ink-50/60">
                    <td className="px-4 py-3">
                      <PartnerCell r={r} />
                    </td>
                    <td className="px-4 py-3">
                      {tab === 'deactivated' ? (
                        <div>
                          <p className="font-semibold">{fmtDate(r.deactivatedAt)}</p>
                          <p className="text-xs text-ink-500">{r.deactivationReason}</p>
                        </div>
                      ) : (
                        <DaysMeter days={r.daysInactive} />
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{fmtDate(r.lastCaseAt)}</td>
                    <td className="px-4 py-3 tabular-nums">{fmtDate(r.lastPayoutAt)}</td>
                    <td className="px-4 py-3 tabular-nums">{fmtDate(r.lastLoginAt)}</td>
                    <td className="px-4 py-3">
                      <Actions r={r} isAdmin={isAdmin} onReactivate={() => setReactivating(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {report.data.items.map((r) => (
              <li key={r.id}>
                <Card className="p-4">
                  <PartnerCell r={r} />
                  <div className="mt-3 flex items-end justify-between gap-3">
                    {tab === 'deactivated' ? (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Deactivated</p>
                        <p className="font-semibold">{fmtDate(r.deactivatedAt)}</p>
                      </div>
                    ) : (
                      <DaysMeter days={r.daysInactive} />
                    )}
                    <div className="text-right text-xs text-ink-500">
                      <p>Last case {fmtDate(r.lastCaseAt)}</p>
                      <p>Last payout {fmtDate(r.lastPayoutAt)}</p>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-ink-100 pt-3">
                    <Actions r={r} isAdmin={isAdmin} onReactivate={() => setReactivating(r)} stretch />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}

      {reactivating && <ReactivateModal row={reactivating} onClose={() => setReactivating(null)} />}
    </div>
  );
}

function PartnerCell({ r }: { r: Row }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-bold text-ink-700">{initials(r.name)}</span>
      <div className="min-w-0">
        <Link href={`/cases?${r.role === 'TEAM_PARTNER' ? 'teamPartnerId' : 'dsaId'}=${r.id}`} className="font-semibold hover:underline">
          {r.name}
        </Link>
        <p className="truncate text-xs text-ink-500">
          <Badge tone={r.role === 'DSA' ? 'dark' : 'neutral'}>{r.role === 'DSA' ? (r.dsaCode ?? 'DSA') : 'Team Partner'}</Badge>
          {r.dsaName && <span> · Team of {r.dsaName}</span>}
          <span> · {r.totalCases} {r.totalCases === 1 ? 'case' : 'cases'} in total</span>
        </p>
      </div>
    </div>
  );
}

function Actions({ r, isAdmin, onReactivate, stretch }: { r: Row; isAdmin: boolean; onReactivate: () => void; stretch?: boolean }) {
  const base = 'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 ring-inset';
  return (
    <div className={cx('flex gap-2', stretch ? 'grid grid-cols-2' : 'justify-end')}>
      {r.status === 'DEACTIVATED' ? (
        isAdmin ? (
          <Button size="sm" variant="teal" icon={<RotateCcw className="h-4 w-4" />} onClick={onReactivate} className={stretch ? 'col-span-2' : ''}>
            Reactivate
          </Button>
        ) : (
          <span className="text-xs text-ink-500">Only Admin can reactivate</span>
        )
      ) : (
        <>
          <a href={`tel:+91${r.mobile}`} className={cx(base, 'bg-white text-ink ring-ink-200 hover:bg-ink-50')}>
            <Phone className="h-4 w-4" /> Call
          </a>
          <a href={whatsappLink(r)} target="_blank" rel="noreferrer" className={cx(base, 'bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100')}>
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
        </>
      )}
    </div>
  );
}

function ReactivateModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () => api.post(`/inactivity/partners/${row.id}/reactivate`, { reason }),
    onSuccess: () => {
      toast.success(`${row.name}'s code is active again`);
      qc.invalidateQueries({ queryKey: ['inactivity'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e: ApiError) => setError(e.fields.reason ?? e.message),
  });
  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Reactivate ${row.name}?`}
      description={`Their ${INACTIVITY.DEACTIVATE_DAYS}-day clock restarts today. They can sign in again with their existing password.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="teal" loading={m.isPending} onClick={() => m.mutate()}>
            Reactivate code
          </Button>
        </>
      }
    >
      <Field label="Reason" required error={error} hint="Saved in the audit log" htmlFor="reason">
        <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Spoke to partner, 2 cases expected this month" />
      </Field>
    </Modal>
  );
}

export default function InactivePartnersPage() {
  return (
    <Suspense>
      <Inactive />
    </Suspense>
  );
}
