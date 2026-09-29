'use client';
/** Raise Query and Need Assistance: list, raise, and a conversation view with staff handling. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HelpCircle, LifeBuoy, Lock, Paperclip, Plus, Send } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ASSISTANCE_TYPES,
  QUERY_CATEGORIES,
  ROLE_LABELS,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_STATUS_LABELS,
  type Role,
  type TicketKind,
  type TicketPriority,
  type TicketStatus,
} from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Pagination, Select, Skeleton, Textarea } from './ui';

interface TicketRow {
  id: string;
  ticketNo: string;
  kind: TicketKind;
  category: string;
  subject: string;
  priority: TicketPriority;
  status: TicketStatus;
  version: number;
  lastActivityAt: string;
  createdAt: string;
  createdBy: { id: string; name: string; role: Role } | null;
  assignedTo: { id: string; name: string } | null;
  loanCase: { id: string; caseNo: string; customer: { name: string } } | null;
  messageCount: number;
}
interface TicketDetail extends Omit<TicketRow, 'loanCase'> {
  loanCase: { id: string; caseNo: string; status: string; customer: { name: string }; bank: { name: string } } | null;
  messages: { id: string; authorId: string; authorName: string; authorRole: Role; body: string; internal: boolean; event: string | null; createdAt: string; document: { id: string; originalName: string } | null }[];
  canHandle: boolean;
  canReply: boolean;
}

const STATUS_TONE: Record<TicketStatus, string> = {
  OPEN: 'bg-brand-goldsoft text-amber-800 ring-amber-200',
  ASSIGNED: 'bg-sky-50 text-sky-800 ring-sky-200',
  IN_PROGRESS: 'bg-violet-50 text-violet-800 ring-violet-200',
  WAITING: 'bg-orange-50 text-orange-800 ring-orange-200',
  RESOLVED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  CLOSED: 'bg-ink-100 text-ink-600 ring-ink-200',
};

export function TicketStatusChip({ status, forStaff }: { status: TicketStatus; forStaff?: boolean }) {
  const label = status === 'WAITING' && forStaff ? 'Waiting for partner' : TICKET_STATUS_LABELS[status];
  return <span className={cx('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', STATUS_TONE[status])}>{label}</span>;
}

const FILTERS: { key: string; label: string; status: string; mine?: boolean }[] = [
  { key: 'active', label: 'Active', status: 'OPEN,ASSIGNED,IN_PROGRESS,WAITING' },
  { key: 'mine', label: 'Assigned to me', status: 'OPEN,ASSIGNED,IN_PROGRESS,WAITING', mine: true },
  { key: 'resolved', label: 'Resolved', status: 'RESOLVED' },
  { key: 'closed', label: 'Closed', status: 'CLOSED' },
  { key: 'all', label: 'All', status: '' },
];

export function TicketsView({ kind, caseId, embedded }: { kind: TicketKind; caseId?: string; embedded?: boolean }) {
  const can = useCan();
  const { data: me } = useMe();
  const staff = me?.role === 'ADMIN' || me?.role === 'EXECUTIVE';
  const [filter, setFilter] = useState(embedded ? 'all' : 'active');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);
  const f = FILTERS.find((x) => x.key === filter)!;
  const list = useQuery({
    queryKey: ['tickets', kind, caseId, filter, q, page],
    queryFn: () => api.page<TicketRow>('/tickets', { kind, caseId, status: f.status, mine: f.mine ? '1' : undefined, q, page }),
    placeholderData: keepPreviousData,
  });
  const counts: Record<string, number> = list.data?.meta.counts ?? {};
  const canRaise = can(kind === 'QUERY' ? 'QUERY_CREATE' : 'SUPPORT_CREATE');
  const Icon = kind === 'QUERY' ? HelpCircle : LifeBuoy;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {!embedded ? (
          <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Status">
            {FILTERS.filter((x) => staff || !x.mine).map((x) => {
              const n = x.status ? x.status.split(',').reduce((a, s) => a + (counts[s] ?? 0), 0) : undefined;
              return (
                <button key={x.key} role="tab" aria-selected={filter === x.key} onClick={() => (setFilter(x.key), setPage(1))} className={cx('shrink-0 rounded-xl px-3 py-2 text-sm font-semibold', filter === x.key ? 'bg-teal-700 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50')}>
                  {x.label}
                  {n !== undefined && !x.mine && n > 0 && <span className="ml-1.5 tabular-nums opacity-70">{n}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          {!embedded && <Input placeholder="Search ID, subject or case" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="sm:w-64" aria-label="Search" />}
          {canRaise && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setRaising(true)} className="shrink-0">
              {kind === 'QUERY' ? 'Raise query' : 'Need assistance'}
            </Button>
          )}
        </div>
      </div>

      {list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : list.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !list.data?.data.length ? (
        <Card>
          <EmptyState
            icon={<Icon className="h-6 w-6" />}
            title={kind === 'QUERY' ? 'No queries here' : 'No assistance requests here'}
            body={canRaise ? (kind === 'QUERY' ? 'Ask Rupeemap anything about a case, payout, bank or the app.' : 'Stuck on a case? Tell Rupeemap what you need and track the reply here.') : undefined}
          />
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-ink-100">
              {list.data.data.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setOpen(t.id)} className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-ink-50 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{t.subject}</span>
                        {(t.priority === 'HIGH' || t.priority === 'URGENT') && <Badge tone="red">{t.priority === 'URGENT' ? 'Urgent' : 'High'}</Badge>}
                      </div>
                      <p className="truncate text-xs text-ink-500">
                        {t.ticketNo} · {TICKET_CATEGORY_LABELS[t.category] ?? t.category}
                        {t.loanCase ? ` · ${t.loanCase.caseNo} ${t.loanCase.customer.name}` : ''}
                        {t.createdBy && (staff || t.createdBy.id !== me?.id) ? ` · by ${t.createdBy.name}` : ''}
                        {t.assignedTo && staff ? ` · with ${t.assignedTo.name}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
                      <TicketStatusChip status={t.status} forStaff={staff} />
                      <span className="text-xs text-ink-500">{timeAgo(t.lastActivityAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Pagination page={list.data.meta.page} pageSize={list.data.meta.pageSize} total={list.data.meta.total} onPage={setPage} />
        </>
      )}
      {raising && <RaiseModal kind={kind} caseId={caseId} onClose={() => setRaising(false)} onCreated={(id) => setOpen(id)} />}
      {open && <TicketModal id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RaiseModal({ kind, caseId, onClose, onCreated }: { kind: TicketKind; caseId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ category: kind === 'QUERY' ? (caseId ? 'CASE' : 'GENERAL') : 'DOCUMENTS', caseId: caseId ?? '', subject: '', description: '', priority: 'NORMAL' as TicketPriority });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cases = useQuery({
    queryKey: ['cases', 'picker'],
    queryFn: () => api.page<{ id: string; caseNo: string; customer: { name: string } }>('/cases', { pageSize: 100 }),
    enabled: !caseId,
    staleTime: 60_000,
  });
  const m = useMutation({
    mutationFn: () => api.post<{ id: string; ticketNo: string }>('/tickets', { kind, ...v }),
    onSuccess: (t) => {
      toast.success(`${t.ticketNo} sent to Rupeemap`);
      qc.invalidateQueries({ queryKey: ['tickets'] });
      onClose();
      onCreated(t.id);
    },
    onError: (e: ApiError) => (setErrors(e.fields), toast.error(e.message)),
  });
  const set = (k: keyof typeof v, val: string) => (setV((x) => ({ ...x, [k]: val })), setErrors((e) => ({ ...e, [k]: '' })));
  const categories = kind === 'QUERY' ? QUERY_CATEGORIES : ASSISTANCE_TYPES;
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={kind === 'QUERY' ? 'Raise a query' : 'Need assistance for a case'}
      description="Rupeemap replies here, and you'll get a notification."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} icon={<Send className="h-4 w-4" />} onClick={() => m.mutate()}>
            Send
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={kind === 'QUERY' ? 'Category' : 'Problem type'} required htmlFor="tk-cat">
          <Select id="tk-cat" value={v.category} onChange={(e) => set('category', e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {TICKET_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Priority" htmlFor="tk-pri">
          <Select id="tk-pri" value={v.priority} onChange={(e) => set('priority', e.target.value)}>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0) + p.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        {!caseId && (
          <div className="sm:col-span-2">
            <Field label={kind === 'ASSISTANCE' ? 'Case' : 'Case (optional)'} required={kind === 'ASSISTANCE'} htmlFor="tk-case" error={errors.caseId}>
              <Select id="tk-case" value={v.caseId} onChange={(e) => set('caseId', e.target.value)}>
                <option value="">{kind === 'ASSISTANCE' ? 'Choose the case' : 'Not about one case'}</option>
                {cases.data?.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.caseNo} · {c.customer.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label="Subject" required htmlFor="tk-sub" error={errors.subject}>
            <Input id="tk-sub" value={v.subject} onChange={(e) => set('subject', e.target.value)} placeholder={kind === 'QUERY' ? 'e.g. Payout not received for LDSA-2026-000011' : 'e.g. Bank asking for extra ITR'} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Details" required htmlFor="tk-desc" error={errors.description} hint="You can attach a file in the next step">
            <Textarea id="tk-desc" value={v.description} onChange={(e) => set('description', e.target.value)} className="min-h-[120px]" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function TicketModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['ticket', id], queryFn: () => api.get<TicketDetail>(`/tickets/${id}`), refetchInterval: 30_000 });
  const staffList = useQuery({
    queryKey: ['staff-list'],
    queryFn: () => api.page<{ id: string; name: string; role: Role; status: string }>('/users', { pageSize: 100 }),
    enabled: !!q.data?.canHandle,
    staleTime: 300_000,
  });
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = () => (qc.invalidateQueries({ queryKey: ['ticket', id] }), qc.invalidateQueries({ queryKey: ['tickets'] }));
  const send = useMutation({
    mutationFn: () => api.form(`/tickets/${id}/messages`, { body, internal: String(internal) }, file),
    onSuccess: () => (setBody(''), setFile(null), setInternal(false), refresh()),
    onError: (e: ApiError) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/tickets/${id}`, { version: q.data!.version, ...patch }),
    onSuccess: () => (toast.success('Ticket updated'), refresh()),
    onError: (e: ApiError) => toast.error(e.message),
  });
  const t = q.data;
  const staffUsers = (staffList.data?.data ?? []).filter((u) => (u.role === 'ADMIN' || u.role === 'EXECUTIVE') && u.status === 'ACTIVE');

  return (
    <Modal open wide onOpenChange={(o) => !o && onClose()} title={t ? t.subject : 'Loading'} description={t ? `${t.ticketNo} · ${TICKET_CATEGORY_LABELS[t.category] ?? t.category} · raised by ${t.createdBy?.name ?? '—'} ${timeAgo(t.createdAt)}` : undefined}>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !t ? (
        <Skeleton className="h-72" />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <TicketStatusChip status={t.status} forStaff={t.canHandle} />
            {(t.priority === 'HIGH' || t.priority === 'URGENT') && <Badge tone="red">{t.priority === 'URGENT' ? 'Urgent' : 'High'}</Badge>}
            {t.loanCase && (
              <Link href={`/cases/${t.loanCase.id}`} className="text-sm font-semibold text-teal-700 hover:underline">
                {t.loanCase.caseNo} · {t.loanCase.customer.name} · {t.loanCase.bank.name}
              </Link>
            )}
          </div>

          {t.canHandle && t.status !== 'CLOSED' && (
            <div className="grid gap-2 rounded-2xl bg-ink-50 p-3 sm:grid-cols-[1fr_auto]">
              <Select aria-label="Assign to" value={t.assignedTo?.id ?? ''} onChange={(e) => e.target.value && update.mutate({ assignedToId: e.target.value })}>
                <option value="">{t.assignedTo ? `Assigned to ${t.assignedTo.name}` : 'Assign to…'}</option>
                {staffUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({ROLE_LABELS[u.role]})
                  </option>
                ))}
              </Select>
              <div className="flex flex-wrap gap-1.5">
                {(['IN_PROGRESS', 'RESOLVED', 'CLOSED'] as TicketStatus[])
                  .filter((s) => s !== t.status)
                  .map((s) => (
                    <Button key={s} size="sm" variant={s === 'RESOLVED' ? 'teal' : 'secondary'} loading={update.isPending} onClick={() => update.mutate({ status: s })}>
                      {s === 'IN_PROGRESS' ? 'In progress' : s === 'RESOLVED' ? 'Mark resolved' : 'Close'}
                    </Button>
                  ))}
              </div>
            </div>
          )}
          {!t.canHandle && t.status === 'RESOLVED' && t.createdBy?.id === me?.id && (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-900">
              <span>Rupeemap marked this resolved. Reply below if you still need help, or close it.</span>
              <Button size="sm" variant="secondary" loading={update.isPending} onClick={() => update.mutate({ status: 'CLOSED' })}>
                Close
              </Button>
            </div>
          )}

          <ol className="max-h-[45vh] space-y-3 overflow-y-auto pr-1">
            {t.messages.map((m) =>
              m.event ? (
                <li key={m.id} className="text-center text-xs text-ink-500">
                  {m.authorName} {m.body} · {fmtDateTime(m.createdAt)}
                </li>
              ) : (
                <li key={m.id} className={cx('flex', m.authorId === me?.id ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cx(
                      'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm',
                      m.internal ? 'border border-dashed border-amber-300 bg-brand-goldsoft text-amber-950' : m.authorId === me?.id ? 'bg-teal-700 text-white' : 'bg-ink-100 text-ink',
                    )}
                  >
                    <p className={cx('mb-0.5 text-xs font-semibold', m.authorId === me?.id && !m.internal ? 'text-white/70' : 'text-ink-500')}>
                      {m.internal && <Lock className="mr-1 inline h-3 w-3" />}
                      {m.authorName} · {ROLE_LABELS[m.authorRole]}
                      {m.internal ? ' · internal note' : ''}
                    </p>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    {m.document && (
                      <a href={`/api/v1/tickets/messages/${m.id}/file`} target="_blank" rel="noreferrer" className={cx('mt-1.5 flex items-center gap-1 text-xs font-semibold underline', m.authorId === me?.id && !m.internal ? 'text-white' : 'text-teal-800')}>
                        <Paperclip className="h-3 w-3" /> {m.document.originalName}
                      </a>
                    )}
                    <p className={cx('mt-1 text-[11px]', m.authorId === me?.id && !m.internal ? 'text-white/60' : 'text-ink-400')}>{fmtDateTime(m.createdAt)}</p>
                  </div>
                </li>
              ),
            )}
          </ol>

          {t.canReply ? (
            <div className="space-y-2 border-t border-ink-100 pt-3">
              <Textarea aria-label="Your message" value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? 'Internal note for Rupeemap staff only' : 'Write a reply'} className={cx(internal && 'border-amber-300 bg-brand-goldsoft')} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <input ref={fileInput} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                  <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1 text-sm font-semibold text-ink-600 hover:text-ink">
                    <Paperclip className="h-4 w-4" /> {file ? file.name : 'Attach file'}
                  </button>
                  {t.canHandle && (
                    <label className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
                      <input type="checkbox" className="h-4 w-4" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note
                    </label>
                  )}
                </div>
                <Button size="sm" loading={send.isPending} disabled={!body.trim()} icon={<Send className="h-4 w-4" />} onClick={() => send.mutate()}>
                  {internal ? 'Add note' : 'Send'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="rounded-xl bg-ink-50 p-3 text-sm text-ink-500">This ticket is closed.{t.canHandle ? '' : ' Raise a new one if you still need help.'}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

