'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CASE_ACTIONS,
  DISBURSEMENT_TYPES,
  DISBURSEMENT_TYPE_LABELS,
  REJECT_REASONS,
  WITHDRAW_REASONS,
  formatINR,
  type CaseAction,
} from '@rupeemap/shared';
import { api, ApiError, newIdempotencyKey } from '@/lib/api';
import { Button, Field, Input, Modal, Select, Textarea } from './ui';

export interface CaseForActions {
  id: string;
  caseNo: string;
  version: number;
  status: string;
  sanctionAmount: string | null;
  disbursedTotal: string | null;
  disbursementType: string | null;
  loanAccountNo: string | null;
  salesManagerName: string | null;
  salesManagerEmail: string | null;
  salesManager: { name: string; email: string | null } | null;
  customer: { name: string };
}

const ACTION_STYLE: Partial<Record<CaseAction, 'primary' | 'teal' | 'secondary' | 'danger'>> = {
  SANCTION: 'teal',
  DISBURSE: 'teal',
  HANDOVER: 'teal',
  RESOLVE_QUERY: 'teal',
  RAISE_QUERY: 'secondary',
  REJECT: 'secondary',
  WITHDRAW: 'secondary',
  REOPEN: 'secondary',
};

export function CaseActionBar({ c, actions }: { c: CaseForActions; actions: CaseAction[] }) {
  const [open, setOpen] = useState<CaseAction | null>(null);
  if (!actions.length) return null;
  const primary = actions.filter((a) => ACTION_STYLE[a] === 'teal');
  const other = actions.filter((a) => ACTION_STYLE[a] !== 'teal');
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {primary.map((a) => (
          <Button key={a} variant="teal" onClick={() => setOpen(a)}>
            {a === 'DISBURSE' && c.status === 'DISBURSED' ? 'Add Disbursement' : CASE_ACTIONS[a].label}
          </Button>
        ))}
        {other.map((a) => (
          <Button key={a} variant="secondary" onClick={() => setOpen(a)} className={a === 'REJECT' ? 'text-brand-red' : undefined}>
            {CASE_ACTIONS[a].label}
          </Button>
        ))}
      </div>
      {open && <TransitionModal c={c} action={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function TransitionModal({ c, action, onClose }: { c: CaseForActions; action: CaseAction; onClose: () => void }) {
  const qc = useQueryClient();
  const idem = useRef(newIdempotencyKey());
  const [v, setV] = useState<Record<string, any>>(() => {
    if (action === 'HANDOVER')
      return {
        handoverAmount: c.disbursedTotal ?? '',
        otcPddCleared: undefined,
        loanAccountNo: c.loanAccountNo ?? '',
        salesManagerName: c.salesManagerName ?? c.salesManager?.name ?? '',
        salesManagerEmail: c.salesManagerEmail ?? c.salesManager?.email ?? '',
      };
    if (action === 'SANCTION') return { sanctionAmount: '' };
    if (action === 'DISBURSE') return { disbursedAmount: '', disbursementType: c.disbursementType === 'PART' ? 'PART_TO_FULL' : '' };
    return {};
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setErrors({}), [action]);
  const set = (k: string, val: any) => {
    setV((p) => ({ ...p, [k]: val }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const m = useMutation({
    mutationFn: (data: Record<string, any>) => api.post<{ status: string }>(`/cases/${c.id}/transitions`, { action, version: c.version, data }, { 'Idempotency-Key': idem.current }),
    onSuccess: (r) => {
      toast.success(action === 'HANDOVER' ? 'Handover recorded. Payout created as Pending.' : `Case moved to ${r.status.charAt(0) + r.status.slice(1).toLowerCase()}`);
      qc.invalidateQueries({ queryKey: ['case', c.id] });
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['payouts'] });
      onClose();
    },
    onError: (e: ApiError) => {
      if (e.code === 'CONFLICT') {
        qc.invalidateQueries({ queryKey: ['case', c.id] });
        onClose();
      }
      setErrors(e.fields);
      toast.error(e.message);
    },
  });

  const submit = () => {
    const r = CASE_ACTIONS[action].schema.safeParse(v);
    if (!r.success) {
      const errs: Record<string, string> = {};
      for (const i of r.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    m.mutate(r.data as Record<string, any>);
  };

  const remaining = c.sanctionAmount ? Number(c.sanctionAmount) - Number(c.disbursedTotal ?? 0) : null;
  const desc: Partial<Record<CaseAction, string>> = {
    SANCTION: 'Enter the amount sanctioned by the bank. It is stored with today’s date and your name.',
    DISBURSE: remaining !== null ? `Sanctioned ${formatINR(c.sanctionAmount)}. Already disbursed ${formatINR(c.disbursedTotal ?? 0)}.` : undefined,
    HANDOVER: 'On save, a Pending payout is created automatically using the partner’s payout percentage.',
    RAISE_QUERY: 'Every query is kept on the case history. It returns to the current stage when resolved.',
    RESOLVE_QUERY: 'The case goes back to the stage it was in before the query.',
    REJECT: 'A rejected case becomes read-only. Only Admin can reopen it.',
    WITHDRAW: 'A withdrawn case becomes read-only. Only Admin can reopen it.',
    REOPEN: 'The case returns to Login. The reason is recorded in the audit log.',
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${CASE_ACTIONS[action].label} · ${c.customer.name}`}
      description={desc[action]}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={action === 'REJECT' ? 'danger' : 'primary'} loading={m.isPending} onClick={submit}>
            {action === 'HANDOVER' ? 'Save Handover' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        {action === 'SANCTION' && (
          <Field label="Sanction loan amount" required htmlFor="sa" error={errors.sanctionAmount}>
            <Input id="sa" autoFocus inputMode="decimal" prefix="₹" value={v.sanctionAmount} onChange={(e) => set('sanctionAmount', e.target.value)} />
          </Field>
        )}
        {action === 'DISBURSE' && (
          <>
            <Field label="Disbursed amount (this tranche)" required htmlFor="da" error={errors.disbursedAmount} hint={remaining !== null ? `Up to ${formatINR(remaining)} remaining` : undefined}>
              <Input id="da" autoFocus inputMode="decimal" prefix="₹" value={v.disbursedAmount} onChange={(e) => set('disbursedAmount', e.target.value)} />
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink-700">
                Disbursed type <span className="text-brand-red">*</span>
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {DISBURSEMENT_TYPES.map((t) => (
                  <label key={t} className={`flex cursor-pointer items-center justify-center rounded-xl border px-2 py-2.5 text-center text-sm font-semibold ${v.disbursementType === t ? 'border-ink bg-ink text-white' : 'border-ink-200'}`}>
                    <input type="radio" name="dt" className="sr-only" checked={v.disbursementType === t} onChange={() => set('disbursementType', t)} />
                    {DISBURSEMENT_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
              {errors.disbursementType && <p className="mt-1.5 text-xs font-medium text-brand-red">{errors.disbursementType}</p>}
            </fieldset>
          </>
        )}
        {action === 'HANDOVER' && (
          <>
            <Field label="Handover amount" required htmlFor="ha" error={errors.handoverAmount}>
              <Input id="ha" autoFocus inputMode="decimal" prefix="₹" value={v.handoverAmount} onChange={(e) => set('handoverAmount', e.target.value)} />
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-ink-700">
                OTC / PDD cleared <span className="text-brand-red">*</span>
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {[
                  [true, 'Yes'],
                  [false, 'No'],
                ].map(([val, label]) => (
                  <label key={String(val)} className={`flex cursor-pointer items-center justify-center rounded-xl border py-2.5 text-sm font-semibold ${v.otcPddCleared === val ? 'border-ink bg-ink text-white' : 'border-ink-200'}`}>
                    <input type="radio" name="otc" className="sr-only" checked={v.otcPddCleared === val} onChange={() => set('otcPddCleared', val)} />
                    {label as string}
                  </label>
                ))}
              </div>
              {errors.otcPddCleared && <p className="mt-1.5 text-xs font-medium text-brand-red">{errors.otcPddCleared}</p>}
            </fieldset>
            <Field label="Loan account number" required htmlFor="lan" error={errors.loanAccountNo}>
              <Input id="lan" className="uppercase" value={v.loanAccountNo} onChange={(e) => set('loanAccountNo', e.target.value.toUpperCase())} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sales manager name" required htmlFor="smn" error={errors.salesManagerName}>
                <Input id="smn" value={v.salesManagerName} onChange={(e) => set('salesManagerName', e.target.value)} />
              </Field>
              <Field label="Sales manager email" required htmlFor="sme" error={errors.salesManagerEmail}>
                <Input id="sme" type="email" value={v.salesManagerEmail} onChange={(e) => set('salesManagerEmail', e.target.value)} />
              </Field>
            </div>
          </>
        )}
        {(action === 'REJECT' || action === 'WITHDRAW') && (
          <Field label={action === 'REJECT' ? 'Reject reason' : 'Withdrawal reason'} required htmlFor="rs" error={errors.reason}>
            <Select id="rs" value={v.reason ?? ''} onChange={(e) => set('reason', e.target.value)}>
              <option value="">Choose a reason</option>
              {(action === 'REJECT' ? REJECT_REASONS : WITHDRAW_REASONS).map((r) => <option key={r}>{r}</option>)}
            </Select>
          </Field>
        )}
        {action === 'REOPEN' && (
          <Field label="Reason for reopening" required htmlFor="ro" error={errors.reason}>
            <Textarea id="ro" value={v.reason ?? ''} onChange={(e) => set('reason', e.target.value)} />
          </Field>
        )}
        {action !== 'REOPEN' && (
          <Field
            label={action === 'RAISE_QUERY' ? 'Query remark' : action === 'RESOLVE_QUERY' ? 'How was it resolved?' : 'Remarks'}
            required={['RAISE_QUERY', 'RESOLVE_QUERY', 'REJECT', 'WITHDRAW'].includes(action)}
            htmlFor="rmk"
            error={errors.remarks}
          >
            <Textarea id="rmk" value={v.remarks ?? ''} onChange={(e) => set('remarks', e.target.value)} placeholder={action === 'RAISE_QUERY' ? 'For example: Bank needs last 6 months bank statement' : undefined} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
