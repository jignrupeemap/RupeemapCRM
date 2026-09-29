'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CircleDot, Clock3, FileText, Lock, PencilLine } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  CASE_STATUS_LABELS,
  DISBURSEMENT_TYPE_LABELS,
  MEASUREMENT_UNIT_LABELS,
  ROLE_LABELS,
  type CaseAction,
  type CaseStatus,
  type DisbursementType,
  type MeasurementUnit,
  type PayoutStatus,
  type Role,
} from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtDateTime, formatINR, formatINRCompact, loanTypeName } from '@/lib/format';
import { useMe } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { CaseActionBar } from '@/components/case-actions';
import { CaseChecklistTab } from '@/components/checklist';
import { PayoutAdjustModal } from '@/components/payout-adjust';
import { CaseInsuranceTab } from '@/components/insurance';
import { RecoveryList } from '@/components/recovery';
import { TicketsView } from '@/components/tickets';
import { Badge, Banner, Button, Card, cx, DetailGrid, EmptyState, ErrorState, Field, Input, Modal, PayoutChip, Select, Skeleton, StatusChip, Tab, TabList, TabPanel, Tabs, Textarea } from '@/components/ui';

interface CaseDetail {
  id: string;
  caseNo: string;
  version: number;
  status: CaseStatus;
  statusBeforeQuery: CaseStatus | null;
  loanType: string;
  appliedAmount: string;
  coApplicantName: string | null;
  sanctionAmount: string | null;
  sanctionDate: string | null;
  disbursedTotal: string | null;
  disbursementType: DisbursementType | null;
  disbursedDate: string | null;
  handoverAmount: string | null;
  otcPddCleared: boolean | null;
  loanAccountNo: string | null;
  handoverDate: string | null;
  salesManagerName: string | null;
  salesManagerEmail: string | null;
  createdAt: string;
  createdRole: Role;
  updatedAt: string;
  daysInStage: number;
  customer: { name: string; mobile: string | null; pan: string | null };
  bank: { id: string; name: string };
  project: { name: string; city: string; locality: string; state: string; reraNumber: string | null; projectType: string; unitTypes: string[]; priceMin: string | null; priceMax: string | null; measurementUnit: MeasurementUnit | null } | null;
  salesManager: { name: string; email: string | null; mobile: string | null; branch: string | null; designation: { name: string } | null } | null;
  dsa: { name: string } | null;
  teamPartner: { name: string } | null;
  createdBy: { name: string } | null;
  stageHistory: { id: string; action: string; fromStatus: CaseStatus | null; toStatus: CaseStatus; data: any; remarks: string | null; changedByName: string; changedRole: Role; changedAt: string }[];
  disbursements: { id: string; amount: string; type: DisbursementType; disbursedOn: string }[];
  remarks: { id: string; kind: string; body: string; createdByName: string; createdRole: Role; createdAt: string }[];
  payouts: {
    id: string;
    beneficiary: { name: string } | null;
    beneficiaryRole: Role;
    baseAmount: string;
    percentSnapshot: string;
    amount: string;
    status: PayoutStatus;
    receivedFromBank: boolean;
    paidOn: string | null;
    paymentRef: string | null;
    remarks: string | null;
    kycStatus: string | null;
    version: number;
    canAdjust: boolean;
    history: { id: string; prevStatus: PayoutStatus | null; newStatus: PayoutStatus | null; prevAmount: string | null; newAmount: string | null; reason: string; changedByName: string; changedAt: string }[];
  }[];
  allowedActions: CaseAction[];
  canCorrect: boolean;
  audit: { id: string; action: string; actor: string | null; actorRole: Role | null; before: any; after: any; at: string; ip: string | null }[];
}

const MAIN_PATH: CaseStatus[] = ['LOGIN', 'SANCTION', 'DISBURSED', 'HANDOVER'];

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['case', id], queryFn: () => api.get<CaseDetail>(`/cases/${id}`) });

  if (q.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const c = q.data!;
  const queries = c.remarks.filter((r) => r.kind === 'QUERY' || r.kind === 'QUERY_RESOLUTION');
  const closed = c.status === 'REJECT' || c.status === 'WITHDRAW';

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: '/cases', label: 'All Cases' }}
        title={c.customer.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink-700">{c.caseNo}</span>
            <span>·</span>
            <span>{loanTypeName(c.loanType)}</span>
            <span>·</span>
            <span>{c.bank.name}</span>
          </span>
        }
        actions={<StatusChip status={c.status} className="px-3 py-1 text-sm" />}
      />

      <StageTrack c={c} />

      {c.status === 'QUERY' && (
        <Banner tone="gold" title="Case is in Query">
          {queries.find((r) => r.kind === 'QUERY')?.body} · returns to {CASE_STATUS_LABELS[c.statusBeforeQuery ?? 'LOGIN']} when resolved
        </Banner>
      )}
      {closed && (
        <Banner tone="red" title={`Case ${c.status === 'REJECT' ? 'rejected' : 'withdrawn'}`}>
          {c.stageHistory.at(-1)?.remarks}
        </Banner>
      )}

      {(c.allowedActions.length > 0 || c.canCorrect) && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-600">
            <span className="font-semibold text-ink">Next step.</span> {c.daysInStage === 0 ? 'Moved to this stage today.' : `${c.daysInStage} ${c.daysInStage === 1 ? 'day' : 'days'} in ${CASE_STATUS_LABELS[c.status]}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <CaseActionBar c={c as any} actions={c.allowedActions} />
            {c.canCorrect && <CorrectionButton c={c} />}
          </div>
        </Card>
      )}

      <Tabs defaultValue="overview">
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="customer">Customer</Tab>
          <Tab value="loan">Loan</Tab>
          <Tab value="bank">Bank</Tab>
          <Tab value="project">Project</Tab>
          <Tab value="timeline" count={c.stageHistory.length}>Timeline</Tab>
          <Tab value="payout" count={c.payouts.length}>Payout</Tab>
          <Tab value="queries" count={queries.length}>Queries</Tab>
          <Tab value="remarks" count={c.remarks.length}>Remarks</Tab>
          <Tab value="documents">Documents</Tab>
          <Tab value="checklist">Checklist</Tab>
          <Tab value="insurance">Insurance</Tab>
          <Tab value="recovery">Recovery</Tab>
          <Tab value="assistance">Assistance</Tab>
          {me?.permissions.includes('AUDIT_VIEW') && <Tab value="audit">Audit</Tab>}
        </TabList>

        <div className="pt-5">
          <TabPanel value="overview">
            <div className="grid gap-5 lg:grid-cols-3">
              <Card className="p-5 lg:col-span-2">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Money label="Applied" v={c.appliedAmount} />
                  <Money label="Sanctioned" v={c.sanctionAmount} />
                  <Money label="Disbursed" v={c.disbursedTotal} />
                  <Money label="Handover" v={c.handoverAmount} strong />
                </div>
                <div className="mt-6 border-t border-ink-100 pt-5">
                  <DetailGrid
                    items={[
                      ['Loan account', c.loanAccountNo],
                      ['Project', c.project?.name],
                      ['Sales manager', c.salesManager?.name ?? c.salesManagerName],
                      ['DSA', c.dsa?.name],
                      ['Team Partner', c.teamPartner?.name ?? '—'],
                      ['Created', `${fmtDateTime(c.createdAt)} by ${c.createdBy?.name} (${ROLE_LABELS[c.createdRole]})`],
                    ]}
                  />
                </div>
              </Card>
              <Card className="p-5">
                <h3 className="mb-3 font-display font-bold">Latest activity</h3>
                <Timeline items={c.stageHistory.slice(-4).reverse()} compact />
              </Card>
            </div>
          </TabPanel>

          <TabPanel value="customer">
            <Card className="p-5">
              <DetailGrid items={[['Customer name', c.customer.name], ['Mobile', c.customer.mobile ? `+91 ${c.customer.mobile}` : '—'], ['PAN', c.customer.pan ?? '—'], ['Co-applicant', c.coApplicantName ?? '—']]} />
            </Card>
          </TabPanel>

          <TabPanel value="loan">
            <Card className="p-5">
              <DetailGrid
                items={[
                  ['Loan type', loanTypeName(c.loanType)],
                  ['Applied amount', formatINR(c.appliedAmount)],
                  ['Sanction amount', formatINR(c.sanctionAmount)],
                  ['Sanction date', fmtDate(c.sanctionDate)],
                  ['Disbursed (total)', formatINR(c.disbursedTotal)],
                  ['Disbursed type', c.disbursementType ? DISBURSEMENT_TYPE_LABELS[c.disbursementType] : '—'],
                  ['Handover amount', formatINR(c.handoverAmount)],
                  ['Handover date', fmtDate(c.handoverDate)],
                  ['OTC / PDD cleared', c.otcPddCleared === null ? '—' : c.otcPddCleared ? 'Yes' : 'No'],
                  ['Loan account number', c.loanAccountNo],
                ]}
              />
              {c.disbursements.length > 0 && (
                <div className="mt-6 border-t border-ink-100 pt-5">
                  <h3 className="mb-2 text-sm font-bold">Disbursement tranches</h3>
                  <ul className="divide-y divide-ink-100 text-sm">
                    {c.disbursements.map((d, i) => (
                      <li key={d.id} className="flex justify-between py-2">
                        <span>
                          {i + 1}. {DISBURSEMENT_TYPE_LABELS[d.type]} · {fmtDate(d.disbursedOn)}
                        </span>
                        <span className="font-semibold tabular-nums">{formatINR(d.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </TabPanel>

          <TabPanel value="bank">
            <Card className="p-5">
              <DetailGrid
                items={[
                  ['Bank / NBFC', c.bank.name],
                  ['Sales manager', c.salesManager?.name ?? c.salesManagerName ?? '—'],
                  ['Designation', c.salesManager?.designation?.name ?? '—'],
                  ['Sales manager email', c.salesManagerEmail ?? c.salesManager?.email ?? '—'],
                  ['Sales manager mobile', c.salesManager?.mobile ?? '—'],
                  ['Branch', c.salesManager?.branch ?? '—'],
                ]}
              />
            </Card>
          </TabPanel>

          <TabPanel value="project">
            <Card className="p-5">
              {c.project ? (
                <DetailGrid
                  items={[
                    ['Project', c.project.name],
                    ['Location', [c.project.locality, c.project.city, c.project.state].filter(Boolean).join(', ')],
                    ['RERA number', c.project.reraNumber ?? '—'],
                    ['Project type', c.project.projectType.charAt(0) + c.project.projectType.slice(1).toLowerCase()],
                    ['Unit types', c.project.unitTypes.map((u) => u.charAt(0) + u.slice(1).toLowerCase()).join(', ')],
                    [
                      'Market price',
                      c.project.priceMin ? `${formatINRCompact(c.project.priceMin)} – ${formatINRCompact(c.project.priceMax)}${c.project.measurementUnit ? ` (${MEASUREMENT_UNIT_LABELS[c.project.measurementUnit]})` : ''}` : '—',
                    ],
                  ]}
                />
              ) : (
                <EmptyState title="No project linked" body="This case is not linked to a Project Master entry (for example a resale or self-construction)." />
              )}
            </Card>
          </TabPanel>

          <TabPanel value="timeline">
            <Card className="p-5">
              <Timeline items={c.stageHistory} />
            </Card>
          </TabPanel>

          <TabPanel value="payout">
            <PayoutTab c={c} />
          </TabPanel>

          <TabPanel value="queries">
            <Card className="p-5">
              {queries.length ? <RemarkList items={queries} /> : <EmptyState title="No queries on this case" body="Queries raised from the status bar appear here with their resolution." />}
            </Card>
          </TabPanel>

          <TabPanel value="remarks">
            <RemarksTab c={c} disabled={closed} />
          </TabPanel>

          <TabPanel value="assistance">
            <TicketsView kind="ASSISTANCE" caseId={c.id} embedded />
          </TabPanel>

          <TabPanel value="recovery">
            <RecoveryList caseId={c.id} />
          </TabPanel>

          <TabPanel value="insurance">
            <CaseInsuranceTab caseId={c.id} closed={closed} />
          </TabPanel>

          <TabPanel value="checklist">
            <CaseChecklistTab caseId={c.id} customerName={c.customer.name} customerMobile={c.customer.mobile} />
          </TabPanel>

          {[
            ['documents', 'Case documents', 'Uploading customer documents to a case is coming next. For now, track which documents you have in the Checklist tab.'],
          ].map(([v, t, b]) => (
            <TabPanel key={v} value={v}>
              <Card>
                <EmptyState icon={<Clock3 className="h-6 w-6" />} title={t} body={b} />
              </Card>
            </TabPanel>
          ))}

          <TabPanel value="audit">
            <Card className="overflow-hidden">
              <ul className="divide-y divide-ink-100 text-sm">
                {c.audit.map((a) => (
                  <li key={a.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">{a.action.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (x) => x.toUpperCase())}</span>
                      <span className="text-xs text-ink-500">{fmtDateTime(a.at)}</span>
                    </div>
                    <p className="text-xs text-ink-500">
                      {a.actor ?? 'System'}
                      {a.actorRole ? ` · ${ROLE_LABELS[a.actorRole]}` : ''}
                      {a.ip ? ` · IP ${a.ip}` : ''}
                    </p>
                    <AuditDiff before={a.before} after={a.after} />
                  </li>
                ))}
              </ul>
            </Card>
          </TabPanel>
        </div>
      </Tabs>
    </div>
  );
}

function Money({ label, v, strong }: { label: string; v: string | null; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={cx('mt-1 font-display text-lg font-bold tabular-nums', v ? (strong ? 'text-teal-700' : 'text-ink') : 'text-ink-300')}>{v ? formatINR(v, { whole: true }) : '—'}</p>
    </div>
  );
}

/** Login → Sanction → Disbursed → Handover → Payout, with the current step highlighted. */
function StageTrack({ c }: { c: CaseDetail }) {
  const reached = new Set(c.stageHistory.map((h) => h.toStatus));
  const current = c.status === 'QUERY' ? c.statusBeforeQuery ?? 'LOGIN' : c.status;
  const dateOf = (s: CaseStatus) => c.stageHistory.filter((h) => h.toStatus === s).at(-1)?.changedAt;
  const payout = c.payouts[0];
  const steps = [...MAIN_PATH.map((s) => ({ key: s, label: CASE_STATUS_LABELS[s], done: reached.has(s), date: dateOf(s) })), { key: 'PAYOUT', label: 'Payout', done: !!payout, date: payout ? undefined : undefined }];
  return (
    <Card className="overflow-x-auto p-4">
      <ol className="flex min-w-[520px] items-center">
        {steps.map((s, i) => {
          const isCurrent = s.key === current || (s.key === 'PAYOUT' && c.status === 'HANDOVER');
          return (
            <li key={s.key} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1.5 text-center">
                <span
                  className={cx(
                    'flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold',
                    s.done ? 'border-teal bg-teal text-white' : isCurrent ? 'border-ink bg-white text-ink' : 'border-ink-200 bg-white text-ink-300',
                    (c.status === 'REJECT' || c.status === 'WITHDRAW') && !s.done && 'opacity-50',
                  )}
                >
                  {s.done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                <span className={cx('text-xs font-semibold', s.done || isCurrent ? 'text-ink' : 'text-ink-400')}>{s.label}</span>
                <span className="h-4 text-[11px] text-ink-500">{s.key === 'PAYOUT' && payout ? <PayoutChip status={payout.status} /> : s.date ? fmtDate(s.date) : ''}</span>
              </div>
              {i < steps.length - 1 && <span className={cx('mx-2 mb-8 h-0.5 flex-1 rounded', s.done && steps[i + 1].done ? 'bg-teal' : 'bg-ink-200')} />}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function describe(h: CaseDetail['stageHistory'][number]) {
  const d = h.data ?? {};
  switch (h.action) {
    case 'CREATE':
      return `Case logged for ${formatINR(d.appliedAmount, { whole: true })} with ${d.bank}${d.project ? ` · ${d.project}` : ''}`;
    case 'SANCTION':
      return `Sanctioned ${formatINR(d.sanctionAmount)}`;
    case 'DISBURSE':
      return `Disbursed ${formatINR(d.disbursedAmount)} · ${DISBURSEMENT_TYPE_LABELS[d.disbursementType as DisbursementType] ?? ''}`;
    case 'HANDOVER':
      return `Handover ${formatINR(d.handoverAmount)} · A/c ${d.loanAccountNo} · OTC/PDD ${d.otcPddCleared ? 'cleared' : 'pending'}`;
    case 'RAISE_QUERY':
      return 'Query raised';
    case 'RESOLVE_QUERY':
      return `Query resolved, back to ${CASE_STATUS_LABELS[h.toStatus]}`;
    case 'REJECT':
      return 'Rejected';
    case 'WITHDRAW':
      return 'Withdrawn';
    case 'REOPEN':
      return 'Reopened to Login';
    default:
      return h.action;
  }
}

function Timeline({ items, compact }: { items: CaseDetail['stageHistory']; compact?: boolean }) {
  if (!items.length) return <EmptyState title="No activity yet" />;
  return (
    <ol className="relative space-y-5 border-l-2 border-ink-100 pl-6">
      {items.map((h) => (
        <li key={h.id} className="relative">
          <span className={cx('absolute -left-[33px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full ring-4 ring-white', ['REJECT', 'WITHDRAW'].includes(h.toStatus) ? 'bg-brand-red' : h.toStatus === 'QUERY' ? 'bg-brand-gold' : 'bg-teal')}>
            <CircleDot className="h-3 w-3 text-white" />
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={h.toStatus} />
            <span className="text-xs text-ink-500">{fmtDateTime(h.changedAt)}</span>
          </div>
          <p className="mt-1 text-sm font-medium text-ink">{describe(h)}</p>
          {h.remarks && !compact && <p className="mt-0.5 text-sm text-ink-600">“{h.remarks}”</p>}
          <p className="mt-0.5 text-xs text-ink-500">
            {h.changedByName} · {ROLE_LABELS[h.changedRole]}
          </p>
        </li>
      ))}
    </ol>
  );
}

function RemarkList({ items }: { items: CaseDetail['remarks'] }) {
  const label: Record<string, [string, 'gold' | 'teal' | 'neutral' | 'red' | 'dark']> = {
    QUERY: ['Query', 'gold'],
    QUERY_RESOLUTION: ['Resolved', 'teal'],
    NOTE: ['Note', 'neutral'],
    BANK: ['Bank remark', 'dark'],
    CORRECTION: ['Correction', 'red'],
  };
  return (
    <ul className="space-y-4">
      {items.map((r) => (
        <li key={r.id} className="flex gap-3">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={label[r.kind]?.[1] ?? 'neutral'}>{label[r.kind]?.[0] ?? r.kind}</Badge>
              <span className="text-xs text-ink-500">
                {r.createdByName} · {ROLE_LABELS[r.createdRole]} · {fmtDateTime(r.createdAt)}
              </span>
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">{r.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RemarksTab({ c, disabled }: { c: CaseDetail; disabled: boolean }) {
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/cases/${c.id}/remarks`, { body }),
    onSuccess: () => {
      setBody('');
      toast.success('Remark added');
      qc.invalidateQueries({ queryKey: ['case', c.id] });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  return (
    <Card className="space-y-5 p-5">
      {!disabled && (
        <form onSubmit={(e) => (e.preventDefault(), body.trim() && m.mutate())} className="space-y-2">
          <Textarea aria-label="New remark" placeholder="Add a remark. Remarks cannot be edited or deleted later." value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex justify-end">
            <Button size="sm" loading={m.isPending} disabled={!body.trim()}>
              Add remark
            </Button>
          </div>
        </form>
      )}
      {c.remarks.length ? <RemarkList items={c.remarks} /> : <EmptyState title="No remarks yet" />}
    </Card>
  );
}

function PayoutTab({ c }: { c: CaseDetail }) {
  const [adjusting, setAdjusting] = useState<CaseDetail['payouts'][number] | null>(null);
  if (!c.payouts.length)
    return (
      <Card>
        <EmptyState icon={<Lock className="h-6 w-6" />} title="No payout yet" body="A Pending payout is created automatically when the case reaches Handover." />
      </Card>
    );
  return (
    <div className="space-y-4">
      {c.payouts.map((p) => (
        <Card key={p.id} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm text-ink-500">
                {ROLE_LABELS[p.beneficiaryRole]} · {p.beneficiary?.name}
              </p>
              <p className="font-display text-2xl font-bold tabular-nums">{formatINR(p.amount)}</p>
              <p className="text-sm text-ink-600">
                {Number(p.percentSnapshot)}% of handover {formatINR(p.baseAmount, { whole: true })}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <PayoutChip status={p.status} />
              {p.receivedFromBank && <Badge tone="teal">Received from bank</Badge>}
              {p.canAdjust && (
                <Button size="sm" variant="secondary" icon={<PencilLine className="h-3.5 w-3.5" />} onClick={() => setAdjusting(p)}>
                  Change % / amount
                </Button>
              )}
            </div>
          </div>
          {p.kycStatus !== 'APPROVED' && p.status !== 'PAID' && (
            <p className="mt-3 rounded-xl bg-brand-goldsoft px-3 py-2 text-sm font-medium text-amber-900">First payout KYC verification pending. This payout cannot be marked Paid until Admin approves KYC.</p>
          )}
          {p.remarks && <p className="mt-3 text-sm text-ink-600">Remarks: {p.remarks}</p>}
          {p.paymentRef && (
            <p className="mt-1 text-sm text-ink-600">
              Paid {fmtDate(p.paidOn)} · UTR {p.paymentRef}
            </p>
          )}
          <details className="mt-4 border-t border-ink-100 pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink-700">History ({p.history.length})</summary>
            <ul className="mt-2 space-y-2 text-sm">
              {p.history.map((h) => (
                <li key={h.id} className="text-ink-600">
                  <span className="font-medium text-ink">{h.prevStatus && h.newStatus !== h.prevStatus ? `${h.prevStatus} → ${h.newStatus}` : h.newStatus}</span>
                  {h.prevAmount && h.newAmount && h.prevAmount !== h.newAmount ? ` · ${formatINR(h.prevAmount)} → ${formatINR(h.newAmount)}` : ''} · {h.reason} · {h.changedByName}, {fmtDateTime(h.changedAt)}
                </li>
              ))}
            </ul>
          </details>
        </Card>
      ))}
      <p className="text-xs text-ink-500">Payout status can only be changed by Rupeemap Admin or authorised executives, from the Payout screen.</p>
      {adjusting && <PayoutAdjustModal p={{ ...adjusting, caseNo: c.caseNo }} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

function AuditDiff({ before, after }: { before: any; after: any }) {
  if (!after && !before) return null;
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !['version', 'id', 'updatedAt', 'createdAt'].includes(k)).slice(0, 8);
  const changed = keys.filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
  if (!changed.length) return null;
  const show = (v: any) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v));
  return (
    <ul className="mt-1.5 space-y-0.5 text-xs">
      {changed.map((k) => (
        <li key={k} className="break-words text-ink-600">
          <span className="font-mono text-ink-500">{k}</span>: {before ? <span className="line-through opacity-60">{show(before[k])}</span> : null} {show(after?.[k])}
        </li>
      ))}
    </ul>
  );
}

function CorrectionButton({ c }: { c: CaseDetail }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState('handoverAmount');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/cases/${c.id}/corrections`, { field, value, reason, version: c.version }),
    onSuccess: () => {
      toast.success('Amount corrected and recorded in the audit log');
      qc.invalidateQueries({ queryKey: ['case', c.id] });
      setOpen(false);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  const options = [
    ['appliedAmount', 'Applied amount', c.appliedAmount],
    ['sanctionAmount', 'Sanction amount', c.sanctionAmount],
    ['disbursedTotal', 'Disbursed amount', c.disbursedTotal],
    ['handoverAmount', 'Handover amount', c.handoverAmount],
  ].filter(([, , v]) => v) as [string, string, string][];
  return (
    <>
      <Button variant="secondary" icon={<PencilLine className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Correct amount
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Correct an amount"
        description="Financial corrections need a reason and are recorded with before and after values. A corrected handover amount updates unpaid payouts at their saved percentage."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={m.isPending} disabled={!value || reason.trim().length < 3} onClick={() => m.mutate()}>
              Save correction
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Amount to correct" htmlFor="cf">
            <Select id="cf" value={field} onChange={(e) => setField(e.target.value)}>
              {options.map(([k, l, v]) => (
                <option key={k} value={k}>
                  {l} (now {formatINR(v)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Correct amount" htmlFor="cv" required>
            <Input id="cv" inputMode="decimal" prefix="₹" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          <Field label="Reason" htmlFor="cr" required>
            <Textarea id="cr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: bank disbursement letter shows ₹40,00,000" />
          </Field>
        </div>
      </Modal>
    </>
  );
}
