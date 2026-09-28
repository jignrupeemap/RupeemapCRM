'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PAYOUT_STATUSES, PAYOUT_STATUS_LABELS, PAYOUT_TRANSITIONS, ROLE_LABELS, type PayoutStatus, type Role } from '@rupeemap/shared';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { fmtDate, formatINR, formatINRCompact, loanTypeName } from '@/lib/format';
import { useCan } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Kpi, Modal, Pagination, PayoutChip, Skeleton, Textarea } from '@/components/ui';

interface PayoutRow {
  id: string;
  version: number;
  status: PayoutStatus;
  amount: string;
  baseAmount: string;
  percentSnapshot: string;
  beneficiaryRole: Role;
  beneficiary: { id: string; name: string } | null;
  kycStatus: string | null;
  receivedFromBank: boolean;
  bankReceivedAmount: string | null;
  paymentRef: string | null;
  paidOn: string | null;
  createdAt: string;
  loanCase: { id: string; caseNo: string; loanType: string; loanAccountNo: string | null; handoverDate: string | null; customer: { name: string }; bank: { name: string } };
}

export default function PayoutsPage() {
  return (
    <Suspense>
      <Payouts />
    </Suspense>
  );
}

function Payouts() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const can = useCan();
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [editing, setEditing] = useState<{ p: PayoutRow; to: PayoutStatus } | null>(null);
  const [receipt, setReceipt] = useState<PayoutRow | null>(null);
  const q = useQuery({ queryKey: ['payouts', status, page], queryFn: () => api.page<PayoutRow>('/payouts', { status, page, pageSize: 20 }), placeholderData: keepPreviousData });
  const summary: { status: PayoutStatus; count: number; amount: number }[] = q.data?.meta.summary ?? [];
  const sum = (s: PayoutStatus) => summary.find((x) => x.status === s) ?? { count: 0, amount: 0 };
  const manage = can('PAYOUT_UPDATE');
  const go = (s: string) => router.replace(`${pathname}${s ? `?status=${s}` : ''}`, { scroll: false });

  return (
    <div>
      <PageHeader title="Payout" sub={manage ? 'Confirm, hold and release partner payouts. First payout needs approved KYC.' : 'Payouts are created automatically at Handover. Only Rupeemap can change their status.'} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PAYOUT_STATUSES.map((s) => (
          <button key={s} onClick={() => go(status === s ? '' : s)} className={cx('rounded-2xl text-left ring-2 transition', status === s ? 'ring-ink' : 'ring-transparent')} aria-pressed={status === s}>
            <Kpi label={PAYOUT_STATUS_LABELS[s]} value={formatINRCompact(sum(s).amount)} sub={`${sum(s).count} ${sum(s).count === 1 ? 'payout' : 'payouts'}`} tone={s === 'PAID' ? 'teal' : s === 'HOLD' ? 'red' : s === 'PENDING' ? 'gold' : 'neutral'} />
          </button>
        ))}
      </div>

      {q.isError ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      ) : q.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !q.data?.data.length ? (
        <Card>
          <EmptyState title={status ? `No ${PAYOUT_STATUS_LABELS[status as PayoutStatus].toLowerCase()} payouts` : 'No payouts yet'} body="A payout appears here as Pending when a case reaches Handover." />
        </Card>
      ) : (
        <>
          <ul className="space-y-3">
            {q.data.data.map((p) => (
              <li key={p.id}>
                <Card className="p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/cases/${p.loanCase.id}`} className="font-semibold hover:underline">
                          {p.loanCase.customer.name}
                        </Link>
                        <PayoutChip status={p.status} />
                        {p.receivedFromBank && <Badge tone="teal">Received from bank</Badge>}
                        {p.kycStatus !== 'APPROVED' && p.status !== 'PAID' && <Badge tone="gold">KYC pending</Badge>}
                      </div>
                      <p className="mt-0.5 text-sm text-ink-500">
                        {p.loanCase.caseNo} · {loanTypeName(p.loanCase.loanType)} · {p.loanCase.bank.name}
                        {p.loanCase.loanAccountNo ? ` · A/c ${p.loanCase.loanAccountNo}` : ''}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-600">
                        {p.beneficiary?.name} ({ROLE_LABELS[p.beneficiaryRole]}) · {Number(p.percentSnapshot)}% of {formatINR(p.baseAmount, { whole: true })} · Handover {fmtDate(p.loanCase.handoverDate)}
                      </p>
                      {p.paymentRef && <p className="mt-0.5 text-xs text-ink-500">Paid {fmtDate(p.paidOn)} · UTR {p.paymentRef}</p>}
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                      <p className="font-display text-xl font-bold tabular-nums">{formatINR(p.amount)}</p>
                      {manage && (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {PAYOUT_TRANSITIONS[p.status].map((to) => (
                            <Button key={to} size="sm" variant={to === 'PAID' ? 'teal' : to === 'HOLD' ? 'secondary' : 'primary'} onClick={() => setEditing({ p, to })}>
                              {to === 'PENDING' ? 'Back to Pending' : to === 'HOLD' ? 'Hold' : `Mark ${PAYOUT_STATUS_LABELS[to]}`}
                            </Button>
                          ))}
                          {!p.receivedFromBank && can('PAYOUT_MARK_BANK_RECEIVED') && (
                            <Button size="sm" variant="ghost" onClick={() => setReceipt(p)}>
                              Received from bank
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <Pagination page={q.data.meta.page} pageSize={q.data.meta.pageSize} total={q.data.meta.total} onPage={(p) => router.replace(`${pathname}?${new URLSearchParams({ ...(status ? { status } : {}), page: String(p) })}`)} />
        </>
      )}
      {editing && <StatusModal {...editing} onClose={() => setEditing(null)} />}
      {receipt && <ReceiptModal p={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function StatusModal({ p, to, onClose }: { p: PayoutRow; to: PayoutStatus; onClose: () => void }) {
  const qc = useQueryClient();
  const idem = useRef(newIdempotencyKey());
  const [reason, setReason] = useState('');
  const [paymentRef, setRef] = useState('');
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const kycBlocked = to === 'PAID' && p.kycStatus !== 'APPROVED';
  const m = useMutation({
    mutationFn: () => api.patch(`/payouts/${p.id}/status`, { status: to, version: p.version, reason, paymentRef: paymentRef || undefined, paidOn: to === 'PAID' ? paidOn : undefined }, { 'Idempotency-Key': idem.current }),
    onSuccess: () => {
      toast.success(`Payout marked ${PAYOUT_STATUS_LABELS[to]}`);
      qc.invalidateQueries({ queryKey: ['payouts'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${to === 'HOLD' ? 'Hold' : `Mark ${PAYOUT_STATUS_LABELS[to]}`} · ${formatINR(p.amount)}`}
      description={`${p.beneficiary?.name} · ${p.loanCase.caseNo} · ${p.loanCase.customer.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} disabled={reason.trim().length < 3 || kycBlocked || (to === 'PAID' && !paymentRef)} onClick={() => m.mutate()}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {kycBlocked && <p className="rounded-xl bg-brand-goldsoft px-3 py-2.5 text-sm font-medium text-amber-900">First payout KYC verification pending. Admin must approve {p.beneficiary?.name}’s KYC before this payout can be paid.</p>}
        {to === 'PAID' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment reference (UTR)" required htmlFor="utr">
              <Input id="utr" value={paymentRef} onChange={(e) => setRef(e.target.value)} />
            </Field>
            <Field label="Paid on" required htmlFor="po">
              <Input id="po" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Reason" required htmlFor="rsn" hint="Recorded in payout history and the audit log">
          <Textarea id="rsn" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={to === 'HOLD' ? 'For example: OTC pending with bank' : 'For example: Matched with bank MIS for September'} />
        </Field>
      </div>
    </Modal>
  );
}

function ReceiptModal({ p, onClose }: { p: PayoutRow; onClose: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/payouts/${p.id}/bank-receipt`, { version: p.version, amount, receivedOn: date, reason }),
    onSuccess: () => {
      toast.success('Marked as received from bank');
      qc.invalidateQueries({ queryKey: ['payouts'] });
      onClose();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Payout received from bank"
      description={`${p.loanCase.bank.name} · ${p.loanCase.caseNo} · A/c ${p.loanCase.loanAccountNo ?? '—'}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} disabled={!amount || reason.trim().length < 3} onClick={() => m.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount received" required htmlFor="ra">
          <Input id="ra" prefix="₹" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Received on" required htmlFor="rd">
          <Input id="rd" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Reference / remarks" required htmlFor="rr">
            <Textarea id="rr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Bank MIS month, credit reference" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}
