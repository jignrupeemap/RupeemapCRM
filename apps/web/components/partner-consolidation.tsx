'use client';
/** Admin / Admin Executive: every DSA Partner with their whole team, cases and payouts, with a Total row that equals the overview. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatINR, formatINRCompact } from '@/lib/format';
import { Card, cx, EmptyState, ErrorState, Input, Skeleton } from './ui';

interface Row {
  dsaId: string;
  name: string;
  code: string | null;
  mobile: string | null;
  status: string | null;
  teamSize: number;
  cases: Record<'total' | 'own' | 'team' | 'LOGIN' | 'SANCTION' | 'DISBURSED' | 'HANDOVER' | 'QUERY' | 'REJECT' | 'WITHDRAW', number>;
  amounts: { applied: number; disbursed: number; handover: number };
  payouts: { dsa: number; teamPartners: number; total: number; pending: number; confirmed: number; paid: number; hold: number; lines: number };
}
interface Data {
  rows: Row[];
  totals: { partners: number; teamSize: number; cases: Row['cases']; amounts: Row['amounts']; payouts: Row['payouts'] };
}

const money = (n: number) => (n ? formatINR(n, { whole: true }) : '—');
const num = (n: number) => (n ? n.toLocaleString('en-IN') : '—');
/** yyyy-mm-dd in the viewer's time zone, the format the Payout page reads from its link. */
const day = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function PartnerConsolidation({ params, overview }: { params: Record<string, string | undefined>; overview?: { cases: number; payouts: number } }) {
  const [q, setQ] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const data = useQuery({ queryKey: ['dashboard', 'partners', params], queryFn: () => api.get<Data>('/dashboard/partners', params), placeholderData: keepPreviousData });
  const d = data.data;
  /** A page for one DSA and their team, keeping the dashboard's dates. */
  const link = (path: string, extra: Record<string, string>) =>
    `${path}?${new URLSearchParams(Object.entries({ ...extra, from: day(params.from), to: day(params.to) }).filter(([, v]) => v))}`;
  const cell = (n: number, href: string) => (n ? <Link href={href} className="hover:text-teal-700 hover:underline">{n.toLocaleString('en-IN')}</Link> : '—');
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (d?.rows ?? []).filter(
      (r) => (!hideEmpty || r.cases.total || r.payouts.total) && (!term || r.name.toLowerCase().includes(term) || r.code?.toLowerCase().includes(term) || r.mobile?.includes(term)),
    );
  }, [d, q, hideEmpty]);
  const t = d?.totals;
  const matches = t && overview && t.cases.total === overview.cases && Math.abs(t.payouts.total - overview.payouts) < 1;

  return (
    <section aria-label="Partner-wise business" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-[17px] font-bold">Partner-wise business</h2>
          <p className="text-sm text-ink-500">Each DSA Partner with their Team Partners: all cases and every payout, for the dates chosen above.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} className="h-4 w-4 accent-teal-700" />
            Hide partners with no business
          </label>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a DSA" className="sm:w-44" aria-label="Find a DSA Partner" />
        </div>
      </div>

      <Card className="overflow-hidden">
        {data.isError ? (
          <ErrorState error={data.error} onRetry={() => data.refetch()} />
        ) : !d ? (
          <Skeleton className="m-4 h-48" />
        ) : !d.rows.length ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No DSA Partners yet" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-ink-50 text-left">
                  <tr>
                    <th className="sticky left-0 bg-ink-50 px-3 py-2.5">DSA Partner and team</th>
                    <th className="px-3 py-2.5 text-right">Cases</th>
                    <th className="px-3 py-2.5 text-right">Self / Team</th>
                    <th className="px-3 py-2.5 text-right">Login</th>
                    <th className="px-3 py-2.5 text-right">Sanction</th>
                    <th className="px-3 py-2.5 text-right">Disbursed</th>
                    <th className="px-3 py-2.5 text-right">Handover</th>
                    <th className="px-3 py-2.5 text-right">Handover ₹</th>
                    <th className="px-3 py-2.5 text-right">DSA payout</th>
                    <th className="px-3 py-2.5 text-right">Team payout</th>
                    <th className="px-3 py-2.5 text-right">Total payout</th>
                    <th className="px-3 py-2.5 text-right">Pending</th>
                    <th className="px-3 py-2.5 text-right">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.map((r) => (
                    <tr key={r.dsaId} className="hover:bg-teal-50/40">
                      <td className="sticky left-0 bg-white px-3 py-2.5">
                        <Link href={link('/cases', { dsaId: r.dsaId })} className="font-semibold text-ink hover:text-teal-700 hover:underline" title="Open all cases of this DSA and their team">
                          {r.name}
                        </Link>
                        <span className="block text-xs text-ink-500">
                          {[r.code, `${r.teamSize} Team Partner${r.teamSize === 1 ? '' : 's'}`, r.status && r.status !== 'ACTIVE' ? r.status.toLowerCase() : null].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{cell(r.cases.total, link('/cases', { dsaId: r.dsaId }))}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-ink-600">
                        {r.cases.total ? `${r.cases.own} / ${r.cases.team}` : '—'}
                      </td>
                      {(['LOGIN', 'SANCTION', 'DISBURSED', 'HANDOVER'] as const).map((st) => (
                        <td key={st} className="px-3 py-2.5 text-right tabular-nums">
                          {cell(r.cases[st], link('/cases', { dsaId: r.dsaId, status: st }))}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(r.amounts.handover)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(r.payouts.dsa)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{money(r.payouts.teamPartners)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">
                        {r.payouts.total ? (
                          <Link href={link('/payouts', { dsaId: r.dsaId })} className="text-teal-800 hover:underline">
                            {money(r.payouts.total)}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={cx('whitespace-nowrap px-3 py-2.5 text-right tabular-nums', r.payouts.pending ? 'text-amber-800' : '')}>
                        {r.payouts.pending ? <Link href={link('/payouts', { dsaId: r.dsaId, status: 'PENDING' })} className="hover:underline">{money(r.payouts.pending)}</Link> : '—'}
                      </td>
                      <td className={cx('whitespace-nowrap px-3 py-2.5 text-right tabular-nums', r.payouts.paid ? 'text-emerald-700' : '')}>
                        {r.payouts.paid ? <Link href={link('/payouts', { dsaId: r.dsaId, status: 'PAID' })} className="hover:underline">{money(r.payouts.paid)}</Link> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {t && (
                  <tfoot className="border-t-2 border-ink-200 bg-teal-50/60 font-semibold">
                    <tr>
                      <td className="sticky left-0 bg-teal-50 px-3 py-3">
                        All partners
                        <span className="block text-xs font-normal text-ink-500">
                          {t.partners} DSA Partners · {t.teamSize} Team Partners
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{t.cases.total.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {t.cases.own} / {t.cases.team}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{t.cases.LOGIN}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{t.cases.SANCTION}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{t.cases.DISBURSED}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{t.cases.HANDOVER}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatINR(t.amounts.handover, { whole: true })}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatINR(t.payouts.dsa, { whole: true })}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatINR(t.payouts.teamPartners, { whole: true })}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-teal-900">{formatINR(t.payouts.total, { whole: true })}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatINR(t.payouts.pending, { whole: true })}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatINR(t.payouts.paid, { whole: true })}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {t && (
              <p className={cx('flex items-center gap-1.5 border-t border-ink-100 px-4 py-2.5 text-xs', matches ? 'text-emerald-700' : 'text-ink-500')}>
                {matches && <CheckCircle2 className="h-3.5 w-3.5" />}
                {matches
                  ? `Totals match the overview above: ${t.cases.total} cases and ${formatINRCompact(t.payouts.total)} in payouts. Insurance payout is Rupeemap's own and is not included.`
                  : 'Insurance payout is Rupeemap’s own and is not included in partner payouts.'}
                {rows.length < d.rows.length && ` ${d.rows.length - rows.length} partners with no business in this period are hidden.`}
              </p>
            )}
          </>
        )}
      </Card>
    </section>
  );
}
