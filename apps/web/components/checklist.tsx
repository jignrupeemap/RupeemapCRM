'use client';
/** Document checklists: per-case progress and the "documents needed" finder. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleSlash, Copy, MessageCircle } from 'lucide-react';
import { toast } from 'sonner';
import { CHECKLIST_SECTION_LABELS, type ChecklistSection, CUSTOMER_PROFILES, CUSTOMER_PROFILE_LABELS, CUSTOMER_PROFILE_SHORT, type ChecklistItemStatus, type CustomerProfile } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { Badge, Card, cx, EmptyState, ErrorState, Skeleton } from './ui';

export interface ResolvedItem {
  itemId: string;
  name: string;
  required: boolean;
  hint: string | null;
  source: string;
  templateId: string;
  section: string;
}

interface CaseChecklist {
  items: (ResolvedItem & { status: ChecklistItemStatus; remarks: string | null; updatedByName: string | null; updatedAt: string | null })[];
  progress: { total: number; done: number; required: number; requiredDone: number };
  customerProfile: CustomerProfile | null;
  canUpdate: boolean;
}

/** The customer's profile on a case; changing it changes which income documents are asked for. */
function ProfilePicker({ caseId, value, canUpdate }: { caseId: string; value: CustomerProfile | null; canUpdate: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (customerProfile: CustomerProfile | null) => api.put(`/cases/${caseId}/profile`, { customerProfile }),
    onSuccess: () => {
      toast.success('Customer profile saved. Checklist updated.');
      qc.invalidateQueries({ queryKey: ['case', caseId] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">Customer profile</p>
          <p className="text-xs text-ink-500">{value ? CUSTOMER_PROFILE_LABELS[value] : 'Not set yet. Choose the profile to see the document list for this loan.'}</p>
        </div>
        <div role="radiogroup" aria-label="Customer profile" className="flex flex-wrap gap-1.5">
          {CUSTOMER_PROFILES.map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={value === x}
              disabled={!canUpdate || m.isPending}
              title={CUSTOMER_PROFILE_LABELS[x]}
              onClick={() => value !== x && m.mutate(x)}
              className={cx(
                'rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition disabled:cursor-not-allowed',
                value === x ? 'bg-teal-700 text-white ring-teal-700' : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-50 disabled:opacity-60',
              )}
            >
              {CUSTOMER_PROFILE_SHORT[x]}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

const OPTIONS: { v: ChecklistItemStatus; label: string; icon?: typeof Check }[] = [
  { v: 'PENDING', label: 'Pending' },
  { v: 'RECEIVED', label: 'Received', icon: Check },
  { v: 'NOT_APPLICABLE', label: 'N/A', icon: CircleSlash },
];

export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-ink-600">
          {done} of {total} · {pct}%
        </span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-ink-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cx('h-full rounded-full transition-all', pct === 100 ? 'bg-emerald-600' : 'bg-teal')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function pendingDocsMessage(customerName: string, items: { name: string; required: boolean }[]) {
  const lines = items.map((i, n) => `${n + 1}. ${i.name}${i.required ? '' : ' (if available)'}`);
  return `Dear ${customerName}, please share the following documents for your loan application:\n${lines.join('\n')}\n\nThank you,\nRupeemap`;
}

export function CaseChecklistTab({ caseId, customerName, customerMobile }: { caseId: string; customerName: string; customerMobile: string | null }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['case', caseId, 'checklist'], queryFn: () => api.get<CaseChecklist>(`/cases/${caseId}/checklist`) });
  const m = useMutation({
    mutationFn: (v: { itemId: string; status: ChecklistItemStatus }) => api.put(`/cases/${caseId}/checklist/${v.itemId}`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['case', caseId, 'checklist'] }),
    onError: (e: ApiError) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-64 rounded-2xl" />;
  if (q.isError)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  const d = q.data!;
  const picker = <ProfilePicker caseId={caseId} value={d.customerProfile} canUpdate={d.canUpdate} />;
  if (!d.items.length)
    return (
      <div className="space-y-4">
        {picker}
        <Card>
          <EmptyState title={d.customerProfile ? 'No checklist for this loan and profile yet' : 'Choose the customer profile above'} body={d.customerProfile ? 'Rupeemap can add one on the Checklist page. It will then appear on this case automatically.' : 'The document list depends on the loan (HL/LAP, Business, Used Car) and the customer profile.'} />
        </Card>
      </div>
    );
  const pending = d.items.filter((i) => i.status === 'PENDING');
  const msg = pendingDocsMessage(customerName, pending);

  return (
    <div className="space-y-4">
    {picker}
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="space-y-4 p-5 lg:order-2">
        <ProgressBar done={d.progress.requiredDone} total={d.progress.required} label="Required documents" />
        <ProgressBar done={d.progress.done} total={d.progress.total} label="All documents" />
        {pending.length > 0 && (
          <div className="space-y-2 border-t border-ink-100 pt-4">
            <p className="text-sm text-ink-600">Ask the customer for the {pending.length} pending documents:</p>
            <div className="grid grid-cols-2 gap-2">
              <a
                href={`https://wa.me/${customerMobile ? `91${customerMobile}` : ''}?text=${encodeURIComponent(msg)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-50 text-sm font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100"
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
              <button
                onClick={() => navigator.clipboard.writeText(msg).then(() => toast.success('List copied'))}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-white text-sm font-semibold ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
              >
                <Copy className="h-4 w-4" /> Copy list
              </button>
            </div>
          </div>
        )}
      </Card>
      <Card className="overflow-hidden lg:order-1 lg:col-span-2">
        <ul className="divide-y divide-ink-100">
          {d.items.map((i) => (
            <li key={i.itemId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {i.section && <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-400">{CHECKLIST_SECTION_LABELS[i.section as ChecklistSection] ?? i.section}</p>}
                <p className={cx('font-semibold', i.status === 'NOT_APPLICABLE' && 'text-ink-400 line-through')}>
                  {i.name} {i.required ? <Badge tone="red">Required</Badge> : <Badge>Optional</Badge>}
                </p>
                <p className="text-xs text-ink-500">
                  {i.hint ? `${i.hint} · ` : ''}
                  {i.updatedByName && i.updatedAt ? `Marked by ${i.updatedByName}, ${timeAgo(i.updatedAt)}` : i.source}
                </p>
              </div>
              <div className="flex shrink-0 rounded-xl bg-ink-50 p-1 ring-1 ring-ink-200/70" role="radiogroup" aria-label={`Status of ${i.name}`}>
                {OPTIONS.map((o) => (
                  <button
                    key={o.v}
                    role="radio"
                    aria-checked={i.status === o.v}
                    disabled={!d.canUpdate || m.isPending}
                    onClick={() => i.status !== o.v && m.mutate({ itemId: i.itemId, status: o.v })}
                    className={cx(
                      'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed',
                      i.status === o.v
                        ? o.v === 'RECEIVED'
                          ? 'bg-emerald-600 text-white'
                          : o.v === 'NOT_APPLICABLE'
                            ? 'bg-ink-600 text-white'
                            : 'bg-white text-ink shadow-card'
                        : 'text-ink-500 hover:text-ink',
                    )}
                  >
                    {o.icon && <o.icon className="h-3.5 w-3.5" />}
                    {o.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
    </div>
  );
}
