'use client';
/** Team Data (DSA) and Users (Admin/Executive) share this list and its actions. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreVertical, Percent, Plus, ShieldCheck, TrendingUp, UserX } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ROLE_LABELS, type Role } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDate, formatINRCompact, initials } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Pagination, Select, Skeleton, Textarea } from './ui';

export interface Person {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  role: Role;
  status: 'PENDING_ACTIVATION' | 'ACTIVE' | 'BLOCKED' | 'SUSPENDED' | 'DEACTIVATED';
  lastLoginAt: string | null;
  createdAt: string;
  dsaCode: string | null;
  dsa: { id: string; name: string } | null;
  kycStatus: string | null;
  payoutPercent: number | null;
  stats: { total: number; login: number; sanction: number; disbursed: number; handover: number; query: number; reject: number; withdraw: number; handoverAmount: number };
}

const STATUS: Record<Person['status'], [string, 'teal' | 'gold' | 'red' | 'neutral']> = {
  ACTIVE: ['Active', 'teal'],
  PENDING_ACTIVATION: ['Not activated', 'gold'],
  BLOCKED: ['Blocked', 'red'],
  SUSPENDED: ['Suspended', 'neutral'],
  DEACTIVATED: ['Deactivated · inactive', 'red'],
};

export function PeopleList({ role, title }: { role?: Role; title?: string }) {
  const { data: me } = useMe();
  const can = useCan();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState<string>(role ?? '');
  const [adding, setAdding] = useState(false);
  const [action, setAction] = useState<{ p: Person; kind: 'rate' | 'status' | 'reset' | 'promote' | 'kyc' } | null>(null);
  const list = useQuery({
    queryKey: ['users', roleFilter, q, page],
    queryFn: () => api.page<Person>('/users', { role: roleFilter, q, page, pageSize: 20 }),
    placeholderData: keepPreviousData,
  });
  const isDsa = me?.role === 'DSA';
  const canAdd = can('USER_CREATE_TEAM_PARTNER') || can('USER_CREATE_DSA') || can('USER_CREATE_EXECUTIVE');

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search name or mobile" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} aria-label="Search people" className="sm:max-w-xs" />
        {!role && (
          <Select value={roleFilter} onChange={(e) => (setRoleFilter(e.target.value), setPage(1))} aria-label="Role" className="sm:max-w-[200px]">
            <option value="">All roles</option>
            <option value="DSA">DSA Partners</option>
            <option value="TEAM_PARTNER">Team Partners</option>
            <option value="EXECUTIVE">Executives</option>
          </Select>
        )}
        {canAdd && (
          <Button className="sm:ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
            {isDsa ? 'Add Team Partner' : 'Add user'}
          </Button>
        )}
      </div>

      {list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : list.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !list.data?.data.length ? (
        <Card>
          <EmptyState title={isDsa ? 'No Team Partners yet' : 'No users found'} body={isDsa ? 'Add a Team Partner with their name and mobile. They activate their login with an OTP.' : undefined} />
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <tr>
                    <th className="px-4 py-3">{title ?? 'Name'}</th>
                    <th className="px-4 py-3 text-right">Cases</th>
                    <th className="px-4 py-3 text-right">Login</th>
                    <th className="px-4 py-3 text-right">Sanction</th>
                    <th className="px-4 py-3 text-right">Disbursed</th>
                    <th className="px-4 py-3 text-right">Handover</th>
                    <th className="px-4 py-3 text-right">Payout %</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-2 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {list.data.data.map((p) => (
                    <tr key={p.id} className="hover:bg-ink-50/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-bold text-ink-700">{initials(p.name)}</span>
                          <div className="min-w-0">
                            <Link href={`/cases?${p.role === 'TEAM_PARTNER' ? 'teamPartnerId' : 'dsaId'}=${p.id}`} className="font-semibold hover:underline">
                              {p.name}
                            </Link>
                            <p className="text-xs text-ink-500">
                              +91 {p.mobile}
                              {!role && ` · ${ROLE_LABELS[p.role]}`}
                              {p.dsaCode && ` · ${p.dsaCode}`}
                              {p.dsa && !isDsa && ` · Team of ${p.dsa.name}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{p.stats.total}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.stats.login}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.stats.sanction}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.stats.disbursed}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {p.stats.handover}
                        {p.stats.handoverAmount > 0 && <span className="block text-xs text-ink-500">{formatINRCompact(p.stats.handoverAmount)}</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.role === 'EXECUTIVE' || p.role === 'ADMIN' ? '—' : p.payoutPercent !== null ? `${p.payoutPercent}%` : <span className="text-brand-red">Not set</span>}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={STATUS[p.status][1]}>{STATUS[p.status][0]}</Badge>
                          {p.kycStatus && p.kycStatus !== 'APPROVED' && <span className="text-xs text-amber-700">KYC pending</span>}
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <RowMenu p={p} onAction={(kind) => setAction({ p, kind })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Pagination page={list.data.meta.page} pageSize={list.data.meta.pageSize} total={list.data.meta.total} onPage={setPage} />
        </>
      )}
      {adding && <AddPersonModal onClose={() => setAdding(false)} />}
      {action && <ActionModal {...action} onClose={() => setAction(null)} />}
    </div>
  );
}

function RowMenu({ p, onAction }: { p: Person; onAction: (k: 'rate' | 'status' | 'reset' | 'promote' | 'kyc') => void }) {
  const can = useCan();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const items: [string, typeof Percent, 'rate' | 'status' | 'reset' | 'promote' | 'kyc', boolean][] = [
    ['Set payout %', Percent, 'rate', p.role === 'DSA' ? can('PAYOUT_PERCENTAGE_UPDATE_DSA') : p.role === 'TEAM_PARTNER' && can('PAYOUT_PERCENTAGE_UPDATE_TEAM')],
    ['Reset password', KeyRound, 'reset', can('USER_RESET_PASSWORD') && p.role !== 'ADMIN' && (p.role !== 'EXECUTIVE' || me?.role === 'ADMIN')],
    ['Verify KYC', ShieldCheck, 'kyc', can('KYC_VERIFY') && !!p.kycStatus && p.kycStatus !== 'APPROVED'],
    ['Promote to DSA', TrendingUp, 'promote', can('USER_PROMOTE') && p.role === 'TEAM_PARTNER'],
    [p.status === 'ACTIVE' ? 'Block or suspend' : 'Change status', UserX, 'status', can('USER_BLOCK') && p.role !== 'ADMIN' && p.id !== me?.id && p.status !== 'DEACTIVATED'],
  ];
  const shown = items.filter((i) => i[3]);
  if (!shown.length) return null;
  return (
    <div className="relative">
      <button className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label={`Actions for ${p.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} onBlur={() => setTimeout(() => setOpen(false), 150)}>
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-ink-200 bg-white p-1 shadow-pop">
          {shown.map(([label, Icon, kind]) => (
            <button key={kind} role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-ink-50" onMouseDown={() => onAction(kind)}>
              <Icon className="h-4 w-4 text-ink-500" /> {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddPersonModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const can = useCan();
  const roles = (['DSA', 'TEAM_PARTNER', 'EXECUTIVE'] as const).filter((r) => can(r === 'DSA' ? 'USER_CREATE_DSA' : r === 'TEAM_PARTNER' ? 'USER_CREATE_TEAM_PARTNER' : 'USER_CREATE_EXECUTIVE'));
  const [v, setV] = useState({ name: '', mobile: '', email: '', role: roles.includes('DSA') ? 'DSA' : 'TEAM_PARTNER', dsaId: '', payoutPercent: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dsas = useQuery({ queryKey: ['dsa-list'], queryFn: () => api.page<{ id: string; name: string; dsaCode: string }>('/users', { role: 'DSA', status: 'ACTIVE', pageSize: 100 }), enabled: me?.role !== 'DSA' });
  const m = useMutation({
    mutationFn: () =>
      api.post('/users', {
        name: v.name,
        mobile: v.mobile,
        email: v.email || undefined,
        role: v.role,
        dsaId: v.role === 'TEAM_PARTNER' && me?.role !== 'DSA' ? v.dsaId || undefined : undefined,
        payoutPercent: v.payoutPercent === '' || v.role === 'EXECUTIVE' ? undefined : v.payoutPercent,
      }),
    onSuccess: () => {
      toast.success(`${v.name} added. They will receive an SMS to activate their login with OTP.`);
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e: ApiError) => {
      setErrors(e.fields);
      toast.error(e.message);
    },
  });
  const set = (k: string, val: string) => (setV((p) => ({ ...p, [k]: val })), setErrors((e) => ({ ...e, [k]: '' })));
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={me?.role === 'DSA' ? 'Add Team Partner' : 'Add user'}
      description="The account starts inactive. The person verifies their mobile with an OTP and creates their own password."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Create login
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {roles.length > 1 && (
          <Field label="Role" htmlFor="role">
            <Select id="role" value={v.role} onChange={(e) => set('role', e.target.value)}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Full name" required htmlFor="nm" error={errors.name}>
          <Input id="nm" value={v.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Mobile number" required htmlFor="mb" error={errors.mobile} hint="Used as the login ID">
          <Input id="mb" inputMode="numeric" prefix="+91" value={v.mobile} onChange={(e) => set('mobile', e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="em" error={errors.email}>
          <Input id="em" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        {v.role === 'TEAM_PARTNER' && me?.role !== 'DSA' && (
          <Field label="DSA" required htmlFor="ds" error={errors.dsaId}>
            <Select id="ds" value={v.dsaId} onChange={(e) => set('dsaId', e.target.value)}>
              <option value="">Choose DSA</option>
              {dsas.data?.data.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.dsaCode}</option>)}
            </Select>
          </Field>
        )}
        {v.role !== 'EXECUTIVE' && (v.role === 'DSA' ? can('PAYOUT_PERCENTAGE_UPDATE_DSA') : can('PAYOUT_PERCENTAGE_UPDATE_TEAM')) && (
          <Field label="Payout percentage" htmlFor="pp" error={errors.percent} hint="Of the handover amount. Can be changed later; old payouts keep their rate.">
            <Input id="pp" inputMode="decimal" value={v.payoutPercent} onChange={(e) => set('payoutPercent', e.target.value)} placeholder="0.50" />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function ActionModal({ p, kind, onClose }: { p: Person; kind: 'rate' | 'status' | 'reset' | 'promote' | 'kyc'; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [percent, setPercent] = useState(p.payoutPercent?.toString() ?? '');
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [statusAction, setStatusAction] = useState(p.status === 'ACTIVE' ? 'BLOCK' : 'UNBLOCK');
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const m = useMutation({
    mutationFn: async () => {
      if (kind === 'rate') return api.post(`/users/${p.id}/payout-rates`, { percent, effectiveFrom: from, reason });
      if (kind === 'status') return api.post(`/users/${p.id}/status`, { action: statusAction, reason });
      if (kind === 'reset') return api.post(`/users/${p.id}/reset-password`);
      if (kind === 'promote') return api.post(`/users/${p.id}/promote`, { reason });
      return api.post(`/users/${p.id}/kyc`, { decision, reason: reason || undefined });
    },
    onSuccess: () => {
      toast.success({ rate: 'Payout percentage saved', status: 'Status updated', reset: 'Password cleared. They will set a new one with OTP.', promote: `${p.name} is now a DSA Partner`, kyc: 'KYC decision saved' }[kind]);
      qc.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  const titles = { rate: 'Set payout percentage', status: 'Change account status', reset: 'Reset password', promote: 'Promote to DSA Partner', kyc: 'Verify first payout KYC' };
  const needsReason = kind !== 'reset' && !(kind === 'kyc' && decision === 'APPROVE');
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={titles[kind]}
      description={`${p.name} · ${ROLE_LABELS[p.role]} · +91 ${p.mobile}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={kind === 'status' && statusAction !== 'UNBLOCK' && statusAction !== 'ACTIVATE' ? 'danger' : 'primary'} loading={m.isPending} disabled={needsReason && reason.trim().length < 3} onClick={() => m.mutate()}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {kind === 'rate' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payout percentage" required htmlFor="pc" hint={p.payoutPercent !== null ? `Current ${p.payoutPercent}%` : 'Not set yet'}>
              <Input id="pc" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} />
            </Field>
            <Field label="Effective from" required htmlFor="ef" hint="Existing payouts keep their old rate">
              <Input id="ef" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          </div>
        )}
        {kind === 'status' && (
          <Field label="Action" htmlFor="sa">
            <Select id="sa" value={statusAction} onChange={(e) => setStatusAction(e.target.value)}>
              {p.status === 'ACTIVE' ? (
                <>
                  <option value="BLOCK">Block (signs out immediately)</option>
                  <option value="SUSPEND">Suspend (signs out immediately)</option>
                </>
              ) : (
                <option value="UNBLOCK">Reactivate</option>
              )}
            </Select>
          </Field>
        )}
        {kind === 'reset' && <p className="text-sm text-ink-600">Their current password stops working and they are signed out everywhere. They set a new password using “Activate account” with an OTP on their mobile.</p>}
        {kind === 'promote' && <p className="text-sm text-ink-600">They leave {p.dsa?.name ?? 'their DSA'}’s team and get their own DSA code. Past cases, payouts and history stay linked to them and to the old team.</p>}
        {kind === 'kyc' && (
          <div className="grid grid-cols-2 gap-2">
            {(['APPROVE', 'REJECT'] as const).map((d) => (
              <label key={d} className={cx('flex cursor-pointer justify-center rounded-xl border py-2.5 text-sm font-semibold', decision === d ? 'border-ink bg-ink text-white' : 'border-ink-200')}>
                <input type="radio" className="sr-only" checked={decision === d} onChange={() => setDecision(d)} />
                {d === 'APPROVE' ? 'Approve' : 'Needs resubmission'}
              </label>
            ))}
          </div>
        )}
        {kind !== 'reset' && (
          <Field label={kind === 'kyc' && decision === 'APPROVE' ? 'Note (optional)' : 'Reason'} required={needsReason} htmlFor="rn">
            <Textarea id="rn" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

export { fmtDate };
