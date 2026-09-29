'use client';
/** A partner's fixed payout, and how the DSA slab is shared with Team Partners. */
import { ShieldCheck } from 'lucide-react';
import { PAYOUT_LIMITS, ROLE_LABELS, type Role } from '@rupeemap/shared';
import { fmtDate } from '@/lib/format';
import { useMe } from '@/lib/session';
import { Badge, Card } from './ui';

export function PayoutSlabCard() {
  const { data: me } = useMe();
  if (!me || (me.role !== 'DSA' && me.role !== 'TEAM_PARTNER')) return null;
  const s = me.payoutSlab;
  const special = !!s && s.percent > PAYOUT_LIMITS.STANDARD_MAX;
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-goldsoft text-amber-800">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{me.role === 'DSA' ? 'Your payout slab per case' : 'Your payout per case'}</p>
          {s ? (
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-display text-2xl font-bold tabular-nums">{s.percent}%</span>
              {special && <Badge tone="dark">Special slab set by Admin</Badge>}
              <span className="text-xs text-ink-500">
                of handover amount · set by {s.setByName ?? 'Rupeemap'}
                {s.setByRole ? ` (${ROLE_LABELS[s.setByRole as Role]})` : ''} · from {fmtDate(s.effectiveFrom)}
              </span>
            </p>
          ) : (
            <p className="font-semibold text-brand-red">Not set yet. {me.role === 'DSA' ? 'Rupeemap will set it.' : 'Your DSA will set it.'}</p>
          )}
        </div>
      </div>
      {me.role === 'DSA' && (
        <p className="max-w-md text-sm text-ink-600">
          This is the total payout on each case. When a Team Partner logs a case, their share comes out of it and you keep the rest (for example 0.90% slab, 0.50% to the Team Partner, 0.40% to you).
        </p>
      )}
    </Card>
  );
}
