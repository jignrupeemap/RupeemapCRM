'use client';
/** Insurance on a case. Rupeemap's commission is shown to Admin and Executives only. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, ShieldPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { INSURANCE_PAYOUT_LABELS, INSURANCE_PAYOUT_TRANSITIONS, type InsurancePayoutStatus } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, formatINR } from '@/lib/format';
import { Button, Card, cx, DetailGrid, EmptyState, ErrorState, Field, Input, Modal, Skeleton, Textarea } from './ui';

export interface InsurancePayoutRow {
  id: string;
  amount: string;
  status: InsurancePayoutStatus;
  receivedOn: string | null;
  reference: string | null;
  remarks: string | null;
  version: number;
  history?: { id: string; prevStatus: InsurancePayoutStatus | null; newStatus: InsurancePayoutStatus | null; prevAmount: string | null; newAmount: string | null; reason: string; changedByName: string; changedAt: string }[];
}
export interface PolicyRow {
  id: string;
  companyName: string;
  productName: string | null;
  policyNumber: string | null;
  insuranceAmount: string;
  premiumAmount: string | null;
  managerName: string | null;
  managerMobile: string | null;
  managerEmail: string | null;
  remarks: string | null;
  createdAt: string;
  payout?: InsurancePayoutRow | null;
}

const TONE: Record<InsurancePayoutStatus, string> = {
  PENDING: 'bg-brand-goldsoft text-amber-800 ring-amber-200',
  CONFIRMED: 'bg-sky-50 text-sky-800 ring-sky-200',
  RECEIVED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  HOLD: 'bg-brand-redsoft text-red-800 ring-red-200',
};

export function InsuranceChip({ status }: { status: InsurancePayoutStatus }) {
  return <span className={cx('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', TONE[status])}>{INSURANCE_PAYOUT_LABELS[status]}</span>;
}

export function CaseInsuranceTab({ caseId, closed }: { caseId: string; closed: boolean }) {
  const q = useQuery({ queryKey: ['insurance', 'case', caseId], queryFn: () => api.get<{ policies: PolicyRow[]; canManage: boolean }>(`/cases/${caseId}/insurance`) });
  const [editing, setEditing] = useState<PolicyRow | 'new' | null>(null);
  const [payout, setPayout] = useState<PolicyRow | null>(null);
  if (q.isLoading) return <Skeleton className="h-48 rounded-2xl" />;
  if (q.isError)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  const { policies, canManage } = q.data!;
  return (
    <div className="space-y-4">
      {canManage && !closed && (
        <div className="flex justify-end">
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add insurance
          </Button>
        </div>
      )}
      {!policies.length ? (
        <Card>
          <EmptyState icon={<ShieldPlus className="h-6 w-6" />} title="No insurance on this case" body={canManage ? 'Add the policy sold with this loan. Its commission is tracked separately and kept by Rupeemap.' : 'Rupeemap adds insurance sold with this loan here.'} />
        </Card>
      ) : (
        policies.map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-bold">{p.companyName}</p>
                <p className="text-sm text-ink-500">
                  {[p.productName, p.policyNumber && `Policy ${p.policyNumber}`].filter(Boolean).join(' · ') || 'Insurance'}
                </p>
              </div>
              {canManage && (
                <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(p)}>
                  Edit
                </Button>
              )}
            </div>
            <div className="mt-4">
              <DetailGrid
                items={[
                  ['Insurance amount', formatINR(p.insuranceAmount, { whole: true })],
                  ['Premium', p.premiumAmount ? formatINR(p.premiumAmount) : '—'],
                  ['Insurance manager', p.managerName ?? '—'],
                  ['Manager mobile', p.managerMobile ? `+91 ${p.managerMobile}` : '—'],
                  ['Manager email', p.managerEmail ?? '—'],
                  ['Added', fmtDate(p.createdAt)],
                ]}
              />
              {p.remarks && <p className="mt-3 text-sm text-ink-600">Remarks: {p.remarks}</p>}
            </div>
            {p.payout && (
              <div className="mt-5 rounded-2xl bg-ink-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Rupeemap insurance payout (not shared with partners)</p>
                    <p className="mt-1 flex items-center gap-2">
                      <span className="font-display text-xl font-bold tabular-nums">{formatINR(p.payout.amount)}</span>
                      <InsuranceChip status={p.payout.status} />
                    </p>
                    {p.payout.status === 'RECEIVED' && (
                      <p className="text-xs text-ink-500">
                        Received {fmtDate(p.payout.receivedOn)}
                        {p.payout.reference ? ` · Ref ${p.payout.reference}` : ''}
                      </p>
                    )}
                  </div>
                  {canManage && p.payout.status !== 'RECEIVED' && (
                    <Button size="sm" onClick={() => setPayout(p)}>
                      Update payout
                    </Button>
                  )}
                </div>
                {!!p.payout.history?.length && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-ink-700">History ({p.payout.history.length})</summary>
                    <ul className="mt-2 space-y-1.5 text-sm text-ink-600">
                      {p.payout.history.map((h) => (
                        <li key={h.id}>
                          <span className="font-medium text-ink">{h.prevStatus && h.prevStatus !== h.newStatus ? `${INSURANCE_PAYOUT_LABELS[h.prevStatus]} → ${INSURANCE_PAYOUT_LABELS[h.newStatus!]}` : INSURANCE_PAYOUT_LABELS[h.newStatus!]}</span>
                          {h.prevAmount && h.newAmount && Number(h.prevAmount) !== Number(h.newAmount) ? ` · ${formatINR(h.prevAmount)} → ${formatINR(h.newAmount)}` : ''} · {h.reason} · {h.changedByName}, {fmtDateTime(h.changedAt)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </Card>
        ))
      )}
      {editing && <PolicyModal caseId={caseId} policy={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {payout?.payout && <InsurancePayoutModal policyId={payout.id} payout={payout.payout} title={payout.companyName} onClose={() => setPayout(null)} />}
    </div>
  );
}

function PolicyModal({ caseId, policy, onClose }: { caseId: string; policy: PolicyRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    companyName: policy?.companyName ?? '',
    productName: policy?.productName ?? '',
    policyNumber: policy?.policyNumber ?? '',
    insuranceAmount: policy?.insuranceAmount ? String(Number(policy.insuranceAmount)) : '',
    premiumAmount: policy?.premiumAmount ? String(Number(policy.premiumAmount)) : '',
    managerName: policy?.managerName ?? '',
    managerMobile: policy?.managerMobile ?? '',
    managerEmail: policy?.managerEmail ?? '',
    remarks: policy?.remarks ?? '',
    payoutAmount: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v, val: string) => (setV((x) => ({ ...x, [k]: val })), setErrors((e) => ({ ...e, [k]: '' })));
  const m = useMutation({
    mutationFn: () => (policy ? api.patch(`/insurance/${policy.id}`, v) : api.post(`/cases/${caseId}/insurance`, v)),
    onSuccess: () => {
      toast.success(policy ? 'Insurance updated' : 'Insurance added');
      qc.invalidateQueries({ queryKey: ['insurance'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e: ApiError) => (setErrors(e.fields), toast.error(e.message)),
  });
  const text = (k: keyof typeof v, label: string, opts: { required?: boolean; prefix?: string; type?: string; mode?: 'decimal' | 'numeric' | 'email' } = {}) => (
    <Field label={label} required={opts.required} htmlFor={`ins-${k}`} error={errors[k]}>
      <Input id={`ins-${k}`} value={v[k]} prefix={opts.prefix} type={opts.type} inputMode={opts.mode} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={policy ? 'Edit insurance' : 'Add insurance'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {text('companyName', 'Insurance company', { required: true })}
        {text('productName', 'Product')}
        {text('insuranceAmount', 'Insurance amount (cover)', { required: true, prefix: '₹', mode: 'decimal' })}
        {text('premiumAmount', 'Premium', { prefix: '₹', mode: 'decimal' })}
        {text('policyNumber', 'Policy number')}
        {text('managerName', 'Insurance manager name')}
        {text('managerMobile', 'Manager mobile', { mode: 'numeric' })}
        {text('managerEmail', 'Manager email', { type: 'email', mode: 'email' })}
        {!policy && (
          <div className="sm:col-span-2">
            <Field label="Rupeemap insurance payout (commission)" htmlFor="ins-payoutAmount" hint="Kept 100% by Rupeemap. Never added to DSA or Team Partner payouts. You can set it later." error={errors.payoutAmount}>
              <Input id="ins-payoutAmount" prefix="₹" inputMode="decimal" value={v.payoutAmount} onChange={(e) => set('payoutAmount', e.target.value)} />
            </Field>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="Remarks" htmlFor="ins-remarks">
            <Textarea id="ins-remarks" value={v.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

export function InsurancePayoutModal({ policyId, payout, title, onClose }: { policyId: string; payout: InsurancePayoutRow; title: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<InsurancePayoutStatus | ''>('');
  const [amount, setAmount] = useState(String(Number(payout.amount)));
  const [reference, setReference] = useState('');
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const amountChanged = Number(amount) !== Number(payout.amount);
  const m = useMutation({
    mutationFn: () =>
      api.patch(`/insurance/${policyId}/payout`, {
        version: payout.version,
        reason,
        ...(status ? { status } : {}),
        ...(amountChanged ? { amount: Number(amount) } : {}),
        ...(status === 'RECEIVED' ? { reference: reference || undefined, receivedOn } : {}),
      }),
    onSuccess: () => {
      toast.success('Insurance payout updated');
      qc.invalidateQueries({ queryKey: ['insurance'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Insurance payout · ${title}`}
      description={`Now ${formatINR(payout.amount)} · ${INSURANCE_PAYOUT_LABELS[payout.status]}. Kept 100% by Rupeemap.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} disabled={reason.trim().length < 3 || (!status && !amountChanged)} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Commission amount" htmlFor="ipa">
          <Input id="ipa" prefix="₹" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-700">Move to</p>
          <div className="flex flex-wrap gap-2">
            {INSURANCE_PAYOUT_TRANSITIONS[payout.status].map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(status === s ? '' : s)}
                className={cx('rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset', status === s ? 'bg-ink text-white ring-ink' : 'ring-ink-200')}
              >
                {INSURANCE_PAYOUT_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
        {status === 'RECEIVED' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reference (UTR)" htmlFor="ipr">
              <Input id="ipr" value={reference} onChange={(e) => setReference(e.target.value)} />
            </Field>
            <Field label="Received on" htmlFor="ipd">
              <Input id="ipd" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Reason" required htmlFor="ipn" hint="Recorded in history and the audit log">
          <Textarea id="ipn" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. As per insurer's September statement" />
        </Field>
      </div>
    </Modal>
  );
}
