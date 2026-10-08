'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, MessageCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { CUSTOMER_PROFILES, CUSTOMER_PROFILE_LABELS, CUSTOMER_PROFILE_SHORT, type CustomerProfile } from '@rupeemap/shared';
import { loanTypeName } from '@/lib/format';
import { useCan } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { pendingDocsMessage, type ResolvedItem } from '@/components/checklist';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, Tab, TabList, TabPanel, Tabs } from '@/components/ui';

interface Template {
  id: string;
  name: string;
  bankId: string | null;
  bankName: string | null;
  loanType: string | null;
  projectId: string | null;
  projectName: string | null;
  profile: CustomerProfile | null;
  product: string | null;
  active: boolean;
  items: { id: string; name: string; required: boolean; hint: string | null; active: boolean }[];
}

function useMasters() {
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string }[]>('/banks'), staleTime: 600_000 });
  const loanTypes = useQuery({ queryKey: ['loan-types'], queryFn: () => api.get<{ code: string; name: string }[]>('/loan-types'), staleTime: 600_000 });
  return { banks: banks.data ?? [], loanTypes: loanTypes.data ?? [] };
}

export default function ChecklistPage() {
  const can = useCan();
  const manage = can('CHECKLIST_MANAGE');
  return (
    <div>
      <PageHeader title="Checklist" sub="Pick the customer profile, tick the documents you need, and share the list on WhatsApp or copy it." />
      {manage ? (
        <Tabs defaultValue="finder">
          <TabList>
            <Tab value="finder">Documents needed</Tab>
            <Tab value="manage">Manage checklists</Tab>
          </TabList>
          <TabPanel value="finder" className="pt-4">
            <Finder manage />
          </TabPanel>
          <TabPanel value="manage" className="pt-4">
            <Manager />
          </TabPanel>
        </Tabs>
      ) : (
        <Finder />
      )}
    </div>
  );
}

function Finder({ manage = false }: { manage?: boolean }) {
  const { loanTypes } = useMasters();
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const templates = useQuery({ queryKey: ['checklists', 'manage'], queryFn: () => api.get<Template[]>('/checklists', { includeInactive: '1' }), enabled: manage });
  const [loanType, setLoanType] = useState('HOME_LOAN');
  const [profile, setProfile] = useState<CustomerProfile>('SALARIED');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [customer, setCustomer] = useState('');
  const q = useQuery({
    queryKey: ['checklist', 'resolve', loanType, profile],
    queryFn: () => api.get<ResolvedItem[]>('/checklists/resolve', { loanType, profile }),
    enabled: !!loanType,
  });
  const items = q.data ?? [];
  // A new profile or loan type starts with nothing ticked.
  useEffect(() => setPicked(new Set()), [loanType, profile]);
  const chosen = items.filter((i) => picked.has(i.itemId));
  const allPicked = items.length > 0 && chosen.length === items.length;
  const msg = pendingDocsMessage(customer.trim() || 'Customer', chosen);
  const sources = [...new Map(items.map((i) => [i.templateId, i.source])).entries()];
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const ownProfileList = templates.data?.find((t) => t.profile === profile && !t.bankId && !t.loanType && t.active);

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="h-fit space-y-4 p-5">
        <Field label="Customer profile" required htmlFor="cp" hint="Shows the documents Rupeemap has set for this profile">
          <div id="cp" role="radiogroup" aria-label="Customer profile" className="grid grid-cols-2 gap-2">
            {CUSTOMER_PROFILES.map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={profile === x}
                title={CUSTOMER_PROFILE_LABELS[x]}
                onClick={() => setProfile(x)}
                className={cx(
                  'rounded-xl px-3 py-2.5 text-left text-sm font-semibold ring-1 ring-inset transition',
                  profile === x ? 'bg-teal-700 text-white ring-teal-700' : 'bg-white text-ink-700 ring-ink-200 hover:bg-ink-50',
                )}
              >
                {CUSTOMER_PROFILE_SHORT[x]}
              </button>
            ))}
          </div>
        </Field>
        <p className="text-xs text-ink-500">{CUSTOMER_PROFILE_LABELS[profile]}</p>
        <Field label="Loan type" htmlFor="cl">
          <Select id="cl" value={loanType} onChange={(e) => setLoanType(e.target.value)}>
            {loanTypes.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Customer name" htmlFor="cn" hint="Optional. Used in the message you share.">
          <Input id="cn" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="e.g. Jay Patel" />
        </Field>
      </Card>
      <Card className="overflow-hidden lg:col-span-2">
        {q.isLoading ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !items.length ? (
          <EmptyState
            title={`No documents set for ${CUSTOMER_PROFILE_SHORT[profile]} yet`}
            body={manage ? 'Create the document list for this profile.' : 'Ask Rupeemap to add the document list for this profile.'}
            action={
              manage && (
                <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
                  Create {CUSTOMER_PROFILE_SHORT[profile]} checklist
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-teal-700"
                  checked={allPicked}
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.length > 0 && !allPicked;
                  }}
                  onChange={() => setPicked(allPicked ? new Set() : new Set(items.map((i) => i.itemId)))}
                  aria-label="Select all documents"
                />
                <span>
                  <span className="block text-sm font-semibold text-ink">Select all</span>
                  <span className="block text-xs text-ink-500">
                    {chosen.length} of {items.length} selected · {CUSTOMER_PROFILE_SHORT[profile]}
                  </span>
                </span>
              </label>
              <div className="flex gap-2">
                <a
                  href={chosen.length ? `https://wa.me/?text=${encodeURIComponent(msg)}` : undefined}
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
                  <MessageCircle className="h-4 w-4" /> Share on WhatsApp
                </a>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<Copy className="h-4 w-4" />}
                  disabled={!chosen.length}
                  onClick={() => navigator.clipboard.writeText(msg).then(() => toast.success(`${chosen.length} documents copied`))}
                >
                  Copy
                </Button>
              </div>
            </div>
            <ol className="divide-y divide-ink-100">
              {items.map((i, n) => (
                <li key={i.itemId}>
                  <label className={cx('flex cursor-pointer items-start gap-3 px-4 py-3 transition', picked.has(i.itemId) ? 'bg-teal-50/60' : 'hover:bg-ink-50')}>
                    <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-teal-700" checked={picked.has(i.itemId)} onChange={() => toggle(i.itemId)} aria-label={i.name} />
                    <span className="mt-0.5 w-5 shrink-0 text-right font-display text-sm font-bold tabular-nums text-ink-400">{n + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{i.name}</span>
                      {i.hint && <span className="block text-xs text-ink-500">{i.hint}</span>}
                    </span>
                    {i.required ? <Badge tone="red">Required</Badge> : <Badge>Optional</Badge>}
                  </label>
                </li>
              ))}
            </ol>
            {manage && (
              <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 bg-ink-50/60 px-4 py-3">
                <span className="text-xs font-semibold text-ink-600">Edit, add or remove documents:</span>
                {sources.map(([id, name]) => {
                  const t = templates.data?.find((x) => x.id === id);
                  return (
                    <Button key={id} size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} disabled={!t} onClick={() => t && setEditing(t)}>
                      {name}
                    </Button>
                  );
                })}
                {!ownProfileList && (
                  <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditing('new')}>
                    New {CUSTOMER_PROFILE_SHORT[profile]} list
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </Card>
      {editing && <TemplateModal template={editing === 'new' ? null : editing} preset={{ profile }} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Manager() {
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const list = useQuery({ queryKey: ['checklists', 'manage'], queryFn: () => api.get<Template[]>('/checklists', { includeInactive: '1' }) });
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
          New checklist
        </Button>
      </div>
      {list.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : !list.data?.length ? (
        <Card>
          <EmptyState title="No checklists yet" body="Create one for all loans (basic KYC), then add bank or loan-type specific ones. They combine automatically on each case." />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data.map((t) => (
            <Card key={t.id} className={cx('p-4', !t.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display font-bold">{t.name}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone={t.bankName ? 'dark' : 'neutral'}>{t.bankName ?? 'All banks'}</Badge>
                    <Badge tone={t.loanType ? 'teal' : 'neutral'}>{t.loanType ? loanTypeName(t.loanType) : 'All loan types'}</Badge>
                    <Badge tone={t.profile ? 'gold' : 'neutral'}>{t.profile ? (CUSTOMER_PROFILE_SHORT[t.profile] ?? t.profile) : 'All profiles'}</Badge>
                    {t.projectName && <Badge>{t.projectName}</Badge>}
                    {!t.active && <Badge tone="red">Inactive</Badge>}
                  </div>
                </div>
                <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(t)}>
                  Edit
                </Button>
              </div>
              <p className="mt-3 text-sm text-ink-600">
                {t.items.filter((i) => i.active).length} documents · {t.items.filter((i) => i.active && i.required).length} required
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-ink-500">
                {t.items
                  .filter((i) => i.active)
                  .map((i) => i.name)
                  .join(' · ')}
              </p>
            </Card>
          ))}
        </div>
      )}
      {editing && <TemplateModal template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

type DraftItem = { id?: string; name: string; required: boolean; hint: string };

function TemplateModal({ template, preset, onClose }: { template: Template | null; preset?: { profile?: CustomerProfile }; onClose: () => void }) {
  const qc = useQueryClient();
  const { banks, loanTypes } = useMasters();
  const [v, setV] = useState({
    name: template?.name ?? '',
    bankId: template?.bankId ?? '',
    loanType: template?.loanType ?? '',
    profile: (template?.profile ?? preset?.profile ?? '') as CustomerProfile | '',
    // Kept as-is for older checklists that were tied to a project; no longer chosen here.
    projectId: template?.projectId ?? '',
    active: template?.active ?? true,
  });
  const [items, setItems] = useState<DraftItem[]>(
    template?.items.filter((i) => i.active).map((i) => ({ id: i.id, name: i.name, required: i.required, hint: i.hint ?? '' })) ?? [{ name: '', required: true, hint: '' }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const done = (msg: string) => {
    toast.success(msg);
    qc.invalidateQueries({ queryKey: ['checklists'] });
    qc.invalidateQueries({ queryKey: ['checklist'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, items: items.filter((i) => i.name.trim()).map((i) => ({ ...i, active: true })) };
      return template ? api.patch(`/checklists/${template.id}`, body) : api.post('/checklists', body);
    },
    onSuccess: () => done(template ? 'Checklist updated' : 'Checklist created'),
    onError: (e: ApiError) => (setErrors(e.fields), toast.error(e.message)),
  });
  const del = useMutation({ mutationFn: () => api.del(`/checklists/${template!.id}`), onSuccess: () => done('Checklist deleted'), onError: (e: ApiError) => toast.error(e.message) });
  const setItem = (n: number, patch: Partial<DraftItem>) => setItems((xs) => xs.map((x, i) => (i === n ? { ...x, ...patch } : x)));
  const move = (n: number, d: -1 | 1) =>
    setItems((xs) => {
      const ys = [...xs];
      const t = n + d;
      if (t < 0 || t >= ys.length) return xs;
      [ys[n], ys[t]] = [ys[t], ys[n]];
      return ys;
    });

  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={template ? 'Edit checklist' : 'New checklist'}
      description="Leave bank, loan type or profile blank to apply it to all. Documents from matching checklists are combined on each case."
      footer={
        <>
          {template &&
            (confirmDelete ? (
              <Button variant="danger" className="sm:mr-auto" loading={del.isPending} onClick={() => del.mutate()}>
                Confirm delete
              </Button>
            ) : (
              <Button variant="ghost" className="text-brand-red sm:mr-auto" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            ))}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            Save checklist
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Checklist name" required htmlFor="tn" error={errors.name}>
            <Input id="tn" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. HDFC Home Loan: SENP" />
          </Field>
        </div>
        <Field label="Bank" htmlFor="tb">
          <Select id="tb" value={v.bankId} onChange={(e) => setV({ ...v, bankId: e.target.value })}>
            <option value="">All banks</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Loan type" htmlFor="tl">
          <Select id="tl" value={v.loanType} onChange={(e) => setV({ ...v, loanType: e.target.value })}>
            <option value="">All loan types</option>
            {loanTypes.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Customer profile" htmlFor="tp">
          <Select id="tp" value={v.profile} onChange={(e) => setV({ ...v, profile: e.target.value as CustomerProfile | '' })}>
            <option value="">All profiles</option>
            {CUSTOMER_PROFILES.map((x) => (
              <option key={x} value={x}>
                {CUSTOMER_PROFILE_LABELS[x]}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Active
        </label>
      </div>

      <fieldset className="mt-5">
        <legend className="mb-2 text-sm font-medium text-ink-700">
          Documents <span className="text-brand-red">*</span>
        </legend>
        {errors.items && <p className="mb-2 text-xs text-brand-red">{errors.items}</p>}
        <ul className="space-y-2">
          {items.map((i, n) => (
            <li key={n} className="rounded-xl border border-ink-200 p-2">
              <div className="flex items-center gap-2">
                <Input aria-label={`Document ${n + 1}`} value={i.name} onChange={(e) => setItem(n, { name: e.target.value })} placeholder="Document name" className="h-10" />
                <button
                  type="button"
                  aria-pressed={i.required}
                  onClick={() => setItem(n, { required: !i.required })}
                  className={cx('h-10 shrink-0 rounded-lg px-2.5 text-xs font-semibold ring-1 ring-inset', i.required ? 'bg-brand-redsoft text-red-800 ring-red-200' : 'text-ink-500 ring-ink-200')}
                >
                  {i.required ? 'Required' : 'Optional'}
                </button>
                <div className="flex shrink-0">
                  <button type="button" className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label="Move up" onClick={() => move(n, -1)}>
                    <ArrowUp className="h-4 w-4" />
                  </button>
                  <button type="button" className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label="Move down" onClick={() => move(n, 1)}>
                    <ArrowDown className="h-4 w-4" />
                  </button>
                  <button type="button" className="rounded-lg p-2 text-brand-red hover:bg-brand-redsoft" aria-label="Remove" onClick={() => setItems((xs) => xs.filter((_, k) => k !== n))}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <Input aria-label={`Hint for document ${n + 1}`} value={i.hint} onChange={(e) => setItem(n, { hint: e.target.value })} placeholder="Hint (optional), e.g. last 3 months" className="mt-2 h-9 text-sm" />
            </li>
          ))}
        </ul>
        <Button type="button" variant="secondary" size="sm" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => setItems((xs) => [...xs, { name: '', required: true, hint: '' }])}>
          Add document
        </Button>
      </fieldset>
    </Modal>
  );
}
