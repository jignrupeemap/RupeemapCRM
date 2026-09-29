'use client';
/** Recovery (payout clawback): list, detail with actions and receipts, and recording a new one from a payout. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Mail, MessageCircle, Send, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { RECOVERY_ACTIONS, RECOVERY_STATUS_LABELS, type RecoveryAction, type RecoveryStatus } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, formatINR } from '@/lib/format';
import { useMe } from '@/lib/session';
import { Badge, Button, Card, cx, DetailGrid, EmptyState, ErrorState, Field, Input, Modal, Pagination, Skeleton, Textarea } from './ui';

export interface RecoveryRow {
  id: string;
  version: number;
  status: RecoveryStatus;
  recoveryAmount: number;
  amountDemanded: number | null;
  amountReceived: number;
  outstanding: number | null;
  recoveryDate: string;
  dueDate: string | null;
  overdue: boolean;
  bankRemarks: string | null;
  reason: string;
  createdAt: string;
  beneficiary: { id: string; name: string; role: string } | null;
  payout: { id: string; amount: number; percent: number; status: string };
  loanCase: { id: string; caseNo: string; customerName: string; bank: string; dsa: string | null };
  receipts?: { id: string; amount: number; receivedOn: string; reference: string | null; enteredByName: string }[];
  history?: { id: string; action: string; prevStatus: RecoveryStatus | null; newStatus: RecoveryStatus; reason: string; changedByName: string; changedAt: string }[];
  canManage: boolean;
  canWhatsApp: boolean;
}

const TONE: Record<RecoveryStatus, string> = {
  RECOVERY_PENDING: 'bg-brand-goldsoft text-amber-800 ring-amber-200',
  BANK_RECOVERY_RECEIVED: 'bg-sky-50 text-sky-800 ring-sky-200',
  DEMAND_RAISED: 'bg-brand-redsoft text-red-800 ring-red-200',
  PARTIALLY_RECOVERED: 'bg-violet-50 text-violet-800 ring-violet-200',
  FULLY_RECOVERED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  DISPUTED: 'bg-orange-50 text-orange-800 ring-orange-200',
  WAIVED: 'bg-ink-100 text-ink-600 ring-ink-200',
  CLOSED: 'bg-ink-100 text-ink-600 ring-ink-200',
};

export function RecoveryChip({ status }: { status: RecoveryStatus }) {
  return <span className={cx('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', TONE[status])}>{RECOVERY_STATUS_LABELS[status]}</span>;
}

export function RecoveryList({ caseId, status, dates, beneficiaryId }: { caseId?: string; status?: string; dates?: { from?: string; to?: string }; beneficiaryId?: string }) {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['recoveries', caseId, status, dates, beneficiaryId, page],
    queryFn: () => api.page<RecoveryRow>('/recoveries', { caseId, status, beneficiaryId, page, ...(dates ?? {}) }),
    placeholderData: keepPreviousData,
  });
  if (q.isError)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  if (q.isLoading) return <Skeleton className="h-48 rounded-2xl" />;
  if (!q.data?.data.length)
    return (
      <Card>
        <EmptyState icon={<Undo2 className="h-6 w-6" />} title="No recoveries" body={caseId ? 'If the bank claws back a payout on this case, Rupeemap records it here.' : 'When a bank claws back a payout, it is recorded and followed up here.'} />
      </Card>
    );
  return (
    <>
      <ul className="space-y-3">
        {q.data.data.map((r) => (
          <li key={r.id}>
            <button onClick={() => setOpen(r.id)} className="block w-full rounded-2xl border border-ink-200/70 bg-white p-4 text-left shadow-card hover:border-ink-300">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.loanCase.customerName}</span>
                    <RecoveryChip status={r.status} />
                    {r.overdue && <Badge tone="red">Overdue</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-500">
                    {r.loanCase.caseNo} · {r.loanCase.bank} · {r.beneficiary?.name} ({r.beneficiary?.role === 'DSA' ? 'DSA' : 'Team Partner'})
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Bank recovered {formatINR(r.recoveryAmount)} on {fmtDate(r.recoveryDate)}
                    {r.dueDate ? ` · due ${fmtDate(r.dueDate)}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-ink-500">Outstanding</p>
                  <p className={cx('font-display text-xl font-bold tabular-nums', r.outstanding ? 'text-brand-red' : '')}>{r.outstanding === null ? '—' : formatINR(r.outstanding)}</p>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
      <Pagination page={q.data.meta.page} pageSize={q.data.meta.pageSize} total={q.data.meta.total} onPage={setPage} />
      {open && <RecoveryModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function RecoveryModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['recovery', id], queryFn: () => api.get<RecoveryRow>(`/recoveries/${id}`) });
  const [action, setAction] = useState<RecoveryAction | 'RECEIPT' | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10));
  const [receivedOn, setReceivedOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['recoveries'] });
    qc.invalidateQueries({ queryKey: ['recovery', id] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    setAction(null);
    setReason('');
    setAmount('');
    setReference('');
  };
  const act = useMutation({
    mutationFn: () =>
      action === 'RECEIPT'
        ? api.post(`/recoveries/${id}/receipts`, { version: r!.version, amount, receivedOn, reference })
        : api.post(`/recoveries/${id}/actions`, { action, version: r!.version, reason, ...(action === 'RAISE_DEMAND' ? { amountDemanded: amount || undefined, dueDate } : {}) }),
    onSuccess: () => done(action === 'RECEIPT' ? 'Amount received saved' : 'Recovery updated'),
    onError: (e: ApiError) => toast.error(e.message),
  });
  const r = q.data;
  const actions = r ? (Object.keys(RECOVERY_ACTIONS) as RecoveryAction[]).filter((a) => (RECOVERY_ACTIONS[a].from as readonly string[]).includes(r.status) && (!RECOVERY_ACTIONS[a].adminOnly || me?.role === 'ADMIN')) : [];
  const canReceive = r && ['DEMAND_RAISED', 'PARTIALLY_RECOVERED'].includes(r.status);

  return (
    <Modal open wide onOpenChange={(o) => !o && onClose()} title={r ? `Recovery · ${r.loanCase.customerName}` : 'Recovery'} description={r ? `${r.loanCase.caseNo} · ${r.loanCase.bank}` : undefined}>
      {!r ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <RecoveryChip status={r.status} />
            {r.overdue && <Badge tone="red">Overdue</Badge>}
          </div>
          <DetailGrid
            items={[
              ['Partner', `${r.beneficiary?.name ?? '—'} (${r.beneficiary?.role === 'DSA' ? 'DSA' : 'Team Partner'})`],
              ['Original payout', `${formatINR(r.payout.amount)} · ${r.payout.percent}%`],
              ['Bank recovered', `${formatINR(r.recoveryAmount)} on ${fmtDate(r.recoveryDate)}`],
              ['Amount demanded', r.amountDemanded === null ? '—' : formatINR(r.amountDemanded)],
              ['Amount received', formatINR(r.amountReceived)],
              ['Outstanding', r.outstanding === null ? '—' : formatINR(r.outstanding)],
              ['Due date', fmtDate(r.dueDate)],
              ['Bank remarks', r.bankRemarks ?? '—'],
              ['Reason', r.reason],
            ]}
          />

          {r.canManage && (actions.length > 0 || canReceive) && (
            <div className="rounded-2xl bg-ink-50 p-4">
              <div className="flex flex-wrap gap-2">
                {canReceive && (
                  <Button size="sm" variant={action === 'RECEIPT' ? 'primary' : 'secondary'} onClick={() => setAction('RECEIPT')}>
                    Amount received
                  </Button>
                )}
                {actions.map((a) => (
                  <Button key={a} size="sm" variant={action === a ? 'primary' : 'secondary'} onClick={() => setAction(a)}>
                    {RECOVERY_ACTIONS[a].label}
                  </Button>
                ))}
              </div>
              {action && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {action === 'RECEIPT' ? (
                    <>
                      <Field label="Amount received" required htmlFor="ra">
                        <Input id="ra" prefix="₹" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={r.outstanding ? String(r.outstanding) : ''} />
                      </Field>
                      <Field label="Received on" required htmlFor="rd">
                        <Input id="rd" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
                      </Field>
                      <div className="sm:col-span-2">
                        <Field label="Reference (UTR / UPI)" htmlFor="rr">
                          <Input id="rr" value={reference} onChange={(e) => setReference(e.target.value)} />
                        </Field>
                      </div>
                    </>
                  ) : (
                    <>
                      {action === 'RAISE_DEMAND' && (
                        <>
                          <Field label="Amount to demand" htmlFor="da" hint={`Blank = full ${formatINR(r.recoveryAmount)}`}>
                            <Input id="da" prefix="₹" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                          </Field>
                          <Field label="Due date" required htmlFor="dd">
                            <Input id="dd" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                          </Field>
                        </>
                      )}
                      <div className="sm:col-span-2">
                        <Field label="Reason" required htmlFor="rs" hint="Recorded in the recovery history and audit log">
                          <Textarea id="rs" value={reason} onChange={(e) => setReason(e.target.value)} />
                        </Field>
                      </div>
                    </>
                  )}
                  <div className="flex justify-end gap-2 sm:col-span-2">
                    <Button variant="ghost" onClick={() => setAction(null)}>
                      Cancel
                    </Button>
                    <Button loading={act.isPending} disabled={action === 'RECEIPT' ? !amount : reason.trim().length < 3} onClick={() => act.mutate()}>
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {!!r.receipts?.length && (
            <section>
              <h3 className="mb-2 text-sm font-bold">Amounts received</h3>
              <ul className="divide-y divide-ink-100 rounded-xl ring-1 ring-ink-200/70">
                {r.receipts.map((x) => (
                  <li key={x.id} className="flex justify-between gap-3 px-3 py-2 text-sm">
                    <span>
                      {fmtDate(x.receivedOn)}
                      {x.reference ? ` · ${x.reference}` : ''} · {x.enteredByName}
                    </span>
                    <span className="font-semibold tabular-nums">{formatINR(x.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {r.canManage && <SendToPartner r={r} />}
          {!!r.history?.length && (
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-ink-700">History ({r.history.length})</summary>
              <ul className="mt-2 space-y-1.5 text-sm text-ink-600">
                {r.history.map((h) => (
                  <li key={h.id}>
                    <span className="font-medium text-ink">{RECOVERY_STATUS_LABELS[h.newStatus]}</span> · {h.reason} · {h.changedByName}, {fmtDateTime(h.changedAt)}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-xs text-ink-500">
            <Link href={`/cases/${r.loanCase.id}`} className="font-semibold text-teal-700 hover:underline">
              Open the case
            </Link>
          </p>
        </div>
      )}
    </Modal>
  );
}

/** Staff: record a bank clawback against a payout. */
/**
 * Admin / Executive: send the recovery details to the partner concerned and/or their DSA.
 * Notification arrives in their CRM; WhatsApp and email open a ready message to send.
 */
function SendToPartner({ r }: { r: RecoveryRow }) {
  const partnerIsDsa = r.beneficiary?.role === 'DSA';
  const [to, setTo] = useState<('PARTNER' | 'DSA')[]>(partnerIsDsa ? ['PARTNER'] : ['PARTNER', 'DSA']);
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: (channel: 'NOTIFICATION' | 'WHATSAPP' | 'EMAIL') =>
      api.post<{ channel: string; sent?: number; links?: { name: string; url: string }[] }>(`/recoveries/${r.id}/send`, { channel, to, note }),
    onSuccess: (x) => {
      if (x.channel === 'NOTIFICATION') toast.success(`Notification sent to ${x.sent} ${x.sent === 1 ? 'person' : 'people'}`);
      for (const l of x.links ?? []) window.open(l.url, '_blank', 'noopener');
      if (x.links?.length) toast.success(`${x.channel === 'EMAIL' ? 'Email' : 'WhatsApp'} message ready for ${x.links.map((l) => l.name).join(' and ')}`);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  const toggle = (k: 'PARTNER' | 'DSA') => setTo((v) => (v.includes(k) ? v.filter((x) => x !== k) : [...v, k]));
  return (
    <section className="rounded-2xl border border-ink-200/70 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Send className="h-4 w-4 text-teal-700" /> Send recovery details
      </h3>
      <p className="mt-0.5 text-xs text-ink-500">Shares the case ID, customer name, amounts and due date. Never the customer&apos;s mobile, PAN or loan account.</p>
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4 accent-teal-700" checked={to.includes('PARTNER')} onChange={() => toggle('PARTNER')} />
          {r.beneficiary?.name ?? 'Partner'} ({partnerIsDsa ? 'DSA Partner' : 'Team Partner'})
        </label>
        {!partnerIsDsa && r.loanCase.dsa && (
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-teal-700" checked={to.includes('DSA')} onChange={() => toggle('DSA')} />
            {r.loanCase.dsa} (their DSA Partner)
          </label>
        )}
      </div>
      <div className="mt-3">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" maxLength={500} className="min-h-[64px]" aria-label="Note" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" icon={<Bell className="h-4 w-4" />} disabled={!to.length} loading={send.isPending && send.variables === 'NOTIFICATION'} onClick={() => send.mutate('NOTIFICATION')}>
          Send notification
        </Button>
        <Button size="sm" variant="secondary" className="text-emerald-800" icon={<MessageCircle className="h-4 w-4" />} disabled={!to.length} loading={send.isPending && send.variables === 'WHATSAPP'} onClick={() => send.mutate('WHATSAPP')}>
          WhatsApp
        </Button>
        <Button size="sm" variant="secondary" icon={<Mail className="h-4 w-4" />} disabled={!to.length} loading={send.isPending && send.variables === 'EMAIL'} onClick={() => send.mutate('EMAIL')}>
          Email
        </Button>
      </div>
    </section>
  );
}

export function RecordRecoveryModal({ payout, onClose }: { payout: { id: string; amount: string; beneficiary: { name: string } | null; caseNo: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ recoveryAmount: String(Number(payout.amount)), recoveryDate: new Date().toISOString().slice(0, 10), bankRemarks: '', reason: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api.post('/recoveries', { payoutId: payout.id, ...v }),
    onSuccess: () => {
      toast.success('Recovery recorded. Raise the demand from Recovery when ready.');
      qc.invalidateQueries({ queryKey: ['recoveries'] });
      onClose();
    },
    onError: (e: ApiError) => (setErrors(e.fields), toast.error(e.message)),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Record bank recovery"
      description={`${payout.beneficiary?.name} · ${payout.caseNo} · payout ${formatINR(payout.amount)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Record recovery
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount the bank recovered" required htmlFor="rv1" error={errors.recoveryAmount}>
          <Input id="rv1" prefix="₹" inputMode="decimal" value={v.recoveryAmount} onChange={(e) => setV({ ...v, recoveryAmount: e.target.value })} />
        </Field>
        <Field label="Recovery date" required htmlFor="rv2">
          <Input id="rv2" type="date" value={v.recoveryDate} onChange={(e) => setV({ ...v, recoveryDate: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Recovery reason" required htmlFor="rv3" error={errors.reason}>
            <Input id="rv3" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="e.g. Loan foreclosed within 6 months" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Bank remarks" htmlFor="rv4">
            <Textarea id="rv4" value={v.bankRemarks} onChange={(e) => setV({ ...v, bankRemarks: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
