'use client';
/** Change the payout % or amount on one case. Shown only where the API says canAdjust. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { formatINR } from '@/lib/format';
import { Button, cx, Field, Input, Modal, Textarea } from './ui';

export interface AdjustablePayout {
  id: string;
  version: number;
  amount: string;
  baseAmount: string;
  percentSnapshot: string;
  beneficiary: { name: string } | null;
  caseNo: string;
}

export function PayoutAdjustModal({ p, onClose }: { p: AdjustablePayout; onClose: () => void }) {
  const qc = useQueryClient();
  const base = Number(p.baseAmount);
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState(String(Number(p.percentSnapshot)));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(n) && n >= 0;
  const preview = !valid ? null : mode === 'percent' ? { percent: n, amount: Math.round(base * n) / 100 } : { percent: base ? Math.round((n / base) * 100000) / 1000 : 0, amount: n };

  const m = useMutation({
    mutationFn: () => api.patch(`/payouts/${p.id}/amount`, { version: p.version, reason, ...(mode === 'percent' ? { percent: n } : { amount: n }) }),
    onSuccess: () => {
      toast.success('Payout changed for this case');
      qc.invalidateQueries({ queryKey: ['payouts'] });
      qc.invalidateQueries({ queryKey: ['case'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e: ApiError) => (setErrors(e.fields), toast.error(e.message)),
  });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Change payout for ${p.beneficiary?.name ?? 'partner'}`}
      description={`${p.caseNo} only; their fixed % for other cases stays the same. A Team Partner's share comes out of the DSA's slab, so the DSA's payout on this case moves the other way. Handover amount ${formatINR(base, { whole: true })}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} disabled={!valid || reason.trim().length < 3} onClick={() => m.mutate()}>
            Save change
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex rounded-xl bg-ink-50 p-1 ring-1 ring-ink-200/70" role="radiogroup" aria-label="Change by">
          {(['percent', 'amount'] as const).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={mode === k}
              onClick={() => {
                setMode(k);
                setValue(k === 'percent' ? String(Number(p.percentSnapshot)) : String(Number(p.amount)));
              }}
              className={cx('flex-1 rounded-lg px-3 py-2 text-sm font-semibold', mode === k ? 'bg-white shadow-card' : 'text-ink-500')}
            >
              {k === 'percent' ? 'Payout %' : 'Payout amount'}
            </button>
          ))}
        </div>
        <Field label={mode === 'percent' ? 'New payout %' : 'New payout amount'} required htmlFor="adj" error={errors.percent ?? errors.amount}>
          <Input id="adj" inputMode="decimal" prefix={mode === 'amount' ? '₹' : undefined} value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-ink-50 p-3 text-sm">
          <div>
            <p className="text-xs text-ink-500">Now</p>
            <p className="font-semibold tabular-nums">
              {Number(p.percentSnapshot)}% · {formatINR(p.amount)}
            </p>
          </div>
          <div>
            <p className="text-xs text-ink-500">After change</p>
            <p className="font-semibold tabular-nums text-teal-800">{preview ? `${preview.percent}% · ${formatINR(preview.amount)}` : '—'}</p>
          </div>
        </div>
        <Field label="Reason" required htmlFor="adjr" hint="Recorded in payout history and the audit log" error={errors.reason}>
          <Textarea id="adjr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Special rate agreed for this customer" />
        </Field>
      </div>
    </Modal>
  );
}
