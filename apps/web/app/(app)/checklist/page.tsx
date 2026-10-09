'use client';
/**
 * Checklist: pick the loan (HL/LAP, Business Loan, Used Car Loan) and the customer profile,
 * tick the documents to ask for, and share them on WhatsApp or copy them.
 * Admin edits each loan × profile list right here, section by section.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, MessageCircle, Pencil, Plus, Save, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CHECKLIST_SECTIONS,
  CHECKLIST_SECTION_LABELS,
  CUSTOMER_PROFILES,
  CUSTOMER_PROFILE_LABELS,
  CUSTOMER_PROFILE_SHORT,
  LOAN_GROUPS,
  LOAN_GROUP_LABELS,
  type ChecklistSection,
  type CustomerProfile,
  type LoanGroup,
} from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import type { ResolvedItem } from '@/components/checklist';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Input, Select, Skeleton } from '@/components/ui';

type Item = ResolvedItem & { section: ChecklistSection };

interface Template {
  id: string;
  name: string;
  loanGroup: LoanGroup | null;
  profile: CustomerProfile | null;
  active: boolean;
  items: { id: string; name: string; required: boolean; hint: string | null; section: ChecklistSection; active: boolean }[];
}

const sectionOrder = (s: string) => {
  const n = (CHECKLIST_SECTIONS as readonly string[]).indexOf(s);
  return n < 0 ? CHECKLIST_SECTIONS.length : n;
};

/** WhatsApp / copy text, grouped by section and numbered right through. */
function message(customer: string, loan: string, items: Item[]) {
  let n = 0;
  const parts: string[] = [];
  for (const sec of CHECKLIST_SECTIONS) {
    const docs = items.filter((i) => i.section === sec);
    if (!docs.length) continue;
    parts.push(`*${CHECKLIST_SECTION_LABELS[sec]}*\n${docs.map((d) => `${++n}. ${d.name}${d.required ? '' : ' (if available)'}`).join('\n')}`);
  }
  return `Dear ${customer}, please share the following documents for your ${loan} application:\n\n${parts.join('\n\n')}\n\nThank you,\nRupeemap`;
}

export default function ChecklistPage() {
  const can = useCan();
  const manage = can('CHECKLIST_MANAGE');
  const [group, setGroup] = useState<LoanGroup>('HL_LAP');
  const [profile, setProfile] = useState<CustomerProfile>('SALARIED');
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [group, profile]);

  return (
    <div className="space-y-4">
      <PageHeader title="Checklist" sub="Pick the loan and the customer profile, tick the documents you need, and share them on WhatsApp or copy them." />
      <div role="tablist" aria-label="Loan" className="grid grid-cols-3 gap-2 sm:max-w-xl">
        {LOAN_GROUPS.map((g) => (
          <button
            key={g}
            role="tab"
            aria-selected={group === g}
            onClick={() => setGroup(g)}
            className={cx(
              'rounded-2xl px-3 py-3 text-sm font-bold ring-1 ring-inset transition sm:text-base',
              group === g ? 'bg-brand-gradient text-white shadow-brand ring-transparent' : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-50',
            )}
          >
            {LOAN_GROUP_LABELS[g]}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Customer profile" className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-semibold text-ink-600">Profile:</span>
        {CUSTOMER_PROFILES.map((x) => (
          <button
            key={x}
            role="radio"
            aria-checked={profile === x}
            title={CUSTOMER_PROFILE_LABELS[x]}
            onClick={() => setProfile(x)}
            className={cx(
              'rounded-xl px-3.5 py-2 text-sm font-semibold ring-1 ring-inset transition',
              profile === x ? 'bg-teal-700 text-white ring-teal-700' : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-50',
            )}
          >
            {CUSTOMER_PROFILE_SHORT[x]}
          </button>
        ))}
        <span className="text-xs text-ink-500">{CUSTOMER_PROFILE_LABELS[profile]}</span>
      </div>
      {editing ? (
        <Editor group={group} profile={profile} onDone={() => setEditing(false)} />
      ) : (
        <Picker group={group} profile={profile} manage={manage} onEdit={() => setEditing(true)} />
      )}
    </div>
  );
}

function Picker({ group, profile, manage, onEdit }: { group: LoanGroup; profile: CustomerProfile; manage: boolean; onEdit: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [customer, setCustomer] = useState('');
  const q = useQuery({
    queryKey: ['checklist', 'resolve', group, profile],
    queryFn: () => api.get<Item[]>('/checklists/resolve', { loanGroup: group, profile }),
  });
  const items = useMemo(() => (q.data ?? []).slice().sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section)), [q.data]);
  useEffect(() => setPicked(new Set()), [group, profile]);
  const chosen = items.filter((i) => picked.has(i.itemId));
  const all = items.length > 0 && chosen.length === items.length;
  const text = message(customer.trim() || 'Customer', LOAN_GROUP_LABELS[group], chosen);
  const set = (ids: string[], on: boolean) =>
    setPicked((cur) => {
      const next = new Set(cur);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  if (q.isLoading) return <Skeleton className="h-72 rounded-2xl" />;
  if (q.isError)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  if (!items.length)
    return (
      <Card>
        <EmptyState
          title={`No ${LOAN_GROUP_LABELS[group]} documents set for ${CUSTOMER_PROFILE_SHORT[profile]} yet`}
          body={manage ? 'Add the documents for this loan and profile.' : 'Ask Rupeemap to add the documents for this loan and profile.'}
          action={
            manage && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={onEdit}>
                Add documents
              </Button>
            )
          }
        />
      </Card>
    );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-ink-100 p-4 lg:flex-row lg:items-center lg:justify-between">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="h-5 w-5 accent-teal-700"
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = chosen.length > 0 && !all;
            }}
            onChange={() => set(items.map((i) => i.itemId), !all)}
            aria-label="Select all documents"
          />
          <span>
            <span className="block text-sm font-semibold text-ink">Select all</span>
            <span className="block text-xs text-ink-500">
              {chosen.length} of {items.length} selected · {LOAN_GROUP_LABELS[group]} · {CUSTOMER_PROFILE_SHORT[profile]}
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer name (optional)" aria-label="Customer name" className="h-9 sm:w-52" />
          <a
            href={chosen.length ? `https://wa.me/?text=${encodeURIComponent(text)}` : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!chosen.length}
            onClick={(e) => {
              if (!chosen.length) {
                e.preventDefault();
                toast.error('Select at least one document');
              }
            }}
            className={cx(
              'inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 ring-inset',
              chosen.length ? 'bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100' : 'cursor-not-allowed bg-ink-50 text-ink-400 ring-ink-200',
            )}
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
          <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" />} disabled={!chosen.length} onClick={() => navigator.clipboard.writeText(text).then(() => toast.success(`${chosen.length} documents copied`))}>
            Copy
          </Button>
          {manage && (
            <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={onEdit}>
              Edit list
            </Button>
          )}
        </div>
      </div>
      {CHECKLIST_SECTIONS.map((sec) => {
        const docs = items.filter((i) => i.section === sec);
        if (!docs.length) return null;
        const secAll = docs.every((d) => picked.has(d.itemId));
        return (
          <section key={sec} aria-label={CHECKLIST_SECTION_LABELS[sec]}>
            <label className="flex cursor-pointer items-center gap-3 border-b border-ink-100 bg-ink-50/70 px-4 py-2">
              <input type="checkbox" className="h-4 w-4 accent-teal-700" checked={secAll} onChange={() => set(docs.map((d) => d.itemId), !secAll)} aria-label={`Select all ${CHECKLIST_SECTION_LABELS[sec]}`} />
              <span className="text-xs font-bold uppercase tracking-[0.06em] text-ink-600">{CHECKLIST_SECTION_LABELS[sec]}</span>
              <span className="text-xs text-ink-400">({docs.length})</span>
            </label>
            <ul className="divide-y divide-ink-100">
              {docs.map((d) => (
                <li key={d.itemId}>
                  <label className={cx('flex cursor-pointer items-start gap-3 px-4 py-3 transition', picked.has(d.itemId) ? 'bg-teal-50/60' : 'hover:bg-ink-50')}>
                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-teal-700" checked={picked.has(d.itemId)} onChange={() => set([d.itemId], !picked.has(d.itemId))} aria-label={d.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{d.name}</span>
                      {d.hint && <span className="block text-xs text-ink-500">{d.hint}</span>}
                    </span>
                    {d.required ? <Badge tone="red">Required</Badge> : <Badge>If available</Badge>}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </Card>
  );
}

type Draft = { id?: string; key: string; name: string; required: boolean; hint: string; section: ChecklistSection };
let draftKey = 0;

/** Admin: the document list for one loan × profile, edited section by section. */
function Editor({ group, profile, onDone }: { group: LoanGroup; profile: CustomerProfile; onDone: () => void }) {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['checklists', 'group', group, profile],
    queryFn: () => api.get<Template[]>('/checklists', { loanGroup: group, profile, includeInactive: '1' }),
  });
  const template = list.data?.find((t) => t.loanGroup === group && t.profile === profile) ?? null;
  const [items, setItems] = useState<Draft[] | null>(null);
  useEffect(() => {
    if (!list.data) return;
    setItems(
      (template?.items ?? [])
        .filter((i) => i.active)
        .map((i) => ({ id: i.id, key: i.id, name: i.name, required: i.required, hint: i.hint ?? '', section: i.section }))
        .sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section)),
    );
  }, [list.data, template]);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: `${LOAN_GROUP_LABELS[group]}: ${CUSTOMER_PROFILE_SHORT[profile]}`,
        loanGroup: group,
        profile,
        active: true,
        items: (items ?? [])
          .filter((i) => i.name.trim())
          .sort((a, b) => sectionOrder(a.section) - sectionOrder(b.section))
          .map(({ key: _key, ...i }) => ({ ...i, active: true })),
      };
      return template ? api.patch(`/checklists/${template.id}`, body) : api.post('/checklists', body);
    },
    onSuccess: () => {
      toast.success('Checklist saved');
      qc.invalidateQueries({ queryKey: ['checklists'] });
      qc.invalidateQueries({ queryKey: ['checklist'] });
      onDone();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  const update = (key: string, patch: Partial<Draft>) => setItems((xs) => xs!.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const move = (key: string, d: -1 | 1) =>
    setItems((xs) => {
      const ys = [...xs!];
      const n = ys.findIndex((y) => y.key === key);
      // Next item in the same section, up or down.
      let t = n + d;
      while (t >= 0 && t < ys.length && ys[t].section !== ys[n].section) t += d;
      if (t < 0 || t >= ys.length) return xs;
      [ys[n], ys[t]] = [ys[t], ys[n]];
      return ys;
    });
  const add = (section: ChecklistSection) => setItems((xs) => [...xs!, { key: `new-${++draftKey}`, name: '', required: true, hint: '', section }]);
  const actions = (
    <div className="flex gap-2">
      <Button variant="ghost" onClick={onDone}>
        Cancel
      </Button>
      <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!items?.some((i) => i.name.trim())} onClick={() => save.mutate()}>
        Save checklist
      </Button>
    </div>
  );

  if (list.isLoading || !items) return <Skeleton className="h-72 rounded-2xl" />;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-display font-bold">
            Edit: {LOAN_GROUP_LABELS[group]} · {CUSTOMER_PROFILE_SHORT[profile]}
          </p>
          <p className="text-xs text-ink-500">Add, rename, remove or reorder documents in each section. Removed documents stay on record for cases that already used them.</p>
        </div>
        {actions}
      </div>
      {CHECKLIST_SECTIONS.map((sec) => {
        const docs = items.filter((d) => d.section === sec);
        return (
          <section key={sec} className="border-b border-ink-100 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-600">{CHECKLIST_SECTION_LABELS[sec]}</p>
              <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => add(sec)}>
                Add document
              </Button>
            </div>
            {!docs.length && <p className="text-sm text-ink-400">No documents in this section.</p>}
            <ul className="space-y-2">
              {docs.map((d) => (
                <li key={d.key} className="rounded-xl border border-ink-200 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={d.name} onChange={(e) => update(d.key, { name: e.target.value })} placeholder="Document name" className="h-10 min-w-[12rem] flex-1" aria-label="Document name" autoFocus={!d.id && !d.name} />
                    <button
                      type="button"
                      aria-pressed={d.required}
                      onClick={() => update(d.key, { required: !d.required })}
                      className={cx('h-10 shrink-0 rounded-lg px-2.5 text-xs font-semibold ring-1 ring-inset', d.required ? 'bg-brand-redsoft text-red-800 ring-red-200' : 'text-ink-500 ring-ink-200')}
                    >
                      {d.required ? 'Required' : 'If available'}
                    </button>
                    <Select value={d.section} onChange={(e) => update(d.key, { section: e.target.value as ChecklistSection })} className="h-10 sm:w-48" aria-label="Section">
                      {CHECKLIST_SECTIONS.map((s) => (
                        <option key={s} value={s}>
                          {CHECKLIST_SECTION_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                    <div className="flex shrink-0">
                      <button type="button" className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label="Move up" onClick={() => move(d.key, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button type="button" className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label="Move down" onClick={() => move(d.key, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button type="button" className="rounded-lg p-2 text-brand-red hover:bg-brand-redsoft" aria-label="Remove" onClick={() => setItems((xs) => xs!.filter((x) => x.key !== d.key))}>
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <Input value={d.hint} onChange={(e) => update(d.key, { hint: e.target.value })} placeholder="Hint (optional), e.g. last 6 months" className="mt-2 h-9 text-sm" aria-label="Hint" />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <div className="flex justify-end p-4">{actions}</div>
    </Card>
  );
}
