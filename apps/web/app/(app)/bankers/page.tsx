'use client';
/** Banker Directory (PART 42–44): contacts by bank and designation; staff add, edit and share them. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookUser, Mail, MessageCircle, Pencil, Phone, Plus, Share2, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton } from '@/components/ui';

interface Designation {
  id: string;
  name: string;
  level: number;
}
interface Banker {
  id: string;
  bankId: string;
  designationId: string | null;
  name: string;
  mobile: string | null;
  email: string | null;
  branch: string | null;
  city: string | null;
  region: string | null;
  product: string | null;
  active: boolean;
  visibleToPartners: boolean;
  designation: Designation | null;
  bank: { id: string; name: string };
}

export default function BankersPage() {
  const can = useCan();
  const manage = can('BANKER_MANAGE');
  const share = can('BANKER_SHARE');
  const [bankId, setBankId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<Banker | 'new' | null>(null);
  const [sharing, setSharing] = useState(false);
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string }[]>('/banks'), staleTime: 600_000 });
  const designations = useQuery({ queryKey: ['banker-designations'], queryFn: () => api.get<Designation[]>('/banker-designations'), staleTime: 600_000 });
  const list = useQuery({
    queryKey: ['bankers', bankId, designationId, q],
    queryFn: () => api.get<Banker[]>('/bankers', { bankId, designationId, q, includeInactive: manage ? '1' : undefined }),
    placeholderData: keepPreviousData,
  });
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectDesignation = () => {
    // Select every listed banker of the chosen designation (share by designation).
    const ids = (list.data ?? []).filter((b) => b.active).map((b) => b.id);
    setSelected((s) => [...new Set([...s, ...ids])]);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Banker Directory"
        sub={share ? 'Sales managers and senior bankers by bank. Select one or more to share as a contact card on WhatsApp or email.' : 'Sales managers and senior bankers by bank.'}
        actions={
          manage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add banker
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search name, branch, city or product" value={q} onChange={(e) => setQ(e.target.value)} className="sm:max-w-xs" aria-label="Search bankers" />
        <Select value={bankId} onChange={(e) => setBankId(e.target.value)} className="sm:max-w-[220px]" aria-label="Bank">
          <option value="">All banks</option>
          {banks.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        <Select value={designationId} onChange={(e) => setDesignationId(e.target.value)} className="sm:max-w-[220px]" aria-label="Designation">
          <option value="">All designations</option>
          {designations.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        {share && list.data && list.data.length > 0 && (bankId || designationId) && (
          <Button variant="secondary" onClick={selectDesignation}>
            Select all listed
          </Button>
        )}
      </div>

      {share && selected.length > 0 && (
        <div className="sticky top-20 z-10 flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-pop">
          <span className="text-sm font-semibold">
            {selected.length} banker{selected.length > 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-2">
            <button onClick={() => setSelected([])} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-white/80 hover:bg-white/10">
              <X className="h-4 w-4" /> Clear
            </button>
            <button onClick={() => setSharing(true)} className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-ink-100">
              <Share2 className="h-4 w-4" /> Share
            </button>
          </div>
        </div>
      )}

      {list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : list.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState icon={<BookUser className="h-6 w-6" />} title="No bankers found" />
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((b) => {
            const on = selected.includes(b.id);
            return (
              <Card key={b.id} className={cx('flex flex-col p-4 transition', on && 'ring-2 ring-teal', !b.active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">{b.name}</p>
                    <p className="text-sm text-ink-500">
                      {b.bank.name}
                      {b.branch ? ` · ${b.branch}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    {b.designation && <Badge tone="dark">{b.designation.name}</Badge>}
                    {share && b.active && <input type="checkbox" checked={on} onChange={() => toggle(b.id)} className="mt-0.5 h-4 w-4" aria-label={`Select ${b.name}`} />}
                  </div>
                </div>
                <div className="mt-3 space-y-1 text-sm">
                  {b.mobile && (
                    <a href={`tel:+91${b.mobile}`} className="flex items-center gap-2 tabular-nums hover:underline">
                      <Phone className="h-3.5 w-3.5 text-ink-400" />
                      +91 {b.mobile}
                    </a>
                  )}
                  {b.email && (
                    <a href={`mailto:${b.email}`} className="flex items-center gap-2 break-all hover:underline">
                      <Mail className="h-3.5 w-3.5 text-ink-400" />
                      {b.email}
                    </a>
                  )}
                  {(b.product || b.city) && <p className="text-xs text-ink-500">{[b.product, b.city, b.region].filter(Boolean).join(' · ')}</p>}
                </div>
                {manage && (
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    <span className="flex gap-1">
                      {!b.visibleToPartners && <Badge>Staff only</Badge>}
                      {!b.active && <Badge tone="red">Inactive</Badge>}
                    </span>
                    <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(b)}>
                      Edit
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {editing && <BankerModal banker={editing === 'new' ? null : editing} banks={banks.data ?? []} designations={designations.data ?? []} onClose={() => setEditing(null)} />}
      {sharing && <ShareModal ids={selected} onClose={() => setSharing(false)} onShared={() => setSelected([])} />}
    </div>
  );
}

function ShareModal({ ids, onClose, onShared }: { ids: string[]; onClose: () => void; onShared: () => void }) {
  const [channel, setChannel] = useState<'WHATSAPP' | 'EMAIL'>('WHATSAPP');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<{ text: string; url: string }>('/bankers/share', { ids, channel, to }),
    onSuccess: (r) => {
      setPreview(r.text);
      window.open(r.url, '_blank', 'noopener');
      onShared();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Share ${ids.length} banker contact${ids.length > 1 ? 's' : ''}`}
      description="Opens WhatsApp or your email app with a ready contact card. The share is recorded in the audit log."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button loading={m.isPending} icon={channel === 'WHATSAPP' ? <MessageCircle className="h-4 w-4" /> : <Mail className="h-4 w-4" />} onClick={() => m.mutate()}>
            {channel === 'WHATSAPP' ? 'Open WhatsApp' : 'Open email'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex rounded-xl bg-ink-50 p-1 ring-1 ring-ink-200/70" role="radiogroup" aria-label="Share via">
          {(['WHATSAPP', 'EMAIL'] as const).map((c) => (
            <button key={c} role="radio" aria-checked={channel === c} onClick={() => (setChannel(c), setTo(''))} className={cx('flex-1 rounded-lg px-3 py-2 text-sm font-semibold', channel === c ? 'bg-white shadow-card' : 'text-ink-500')}>
              {c === 'WHATSAPP' ? 'WhatsApp' : 'Email'}
            </button>
          ))}
        </div>
        <Field label={channel === 'WHATSAPP' ? 'Send to mobile (optional)' : 'Send to email (optional)'} htmlFor="sh-to" hint="Leave blank to choose the contact in WhatsApp or your email app">
          <Input id="sh-to" value={to} inputMode={channel === 'WHATSAPP' ? 'numeric' : 'email'} onChange={(e) => setTo(e.target.value)} placeholder={channel === 'WHATSAPP' ? '98XXXXXXXX' : 'name@example.com'} />
        </Field>
        {preview && <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-ink-50 p-3 text-xs text-ink-700">{preview}</pre>}
      </div>
    </Modal>
  );
}

function BankerModal({ banker, banks, designations, onClose }: { banker: Banker | null; banks: { id: string; name: string }[]; designations: Designation[]; onClose: () => void }) {
  const qc = useQueryClient();
  const can = useCan();
  const [v, setV] = useState({
    bankId: banker?.bankId ?? '',
    designationId: banker?.designationId ?? '',
    name: banker?.name ?? '',
    mobile: banker?.mobile ?? '',
    email: banker?.email ?? '',
    branch: banker?.branch ?? '',
    city: banker?.city ?? '',
    region: banker?.region ?? '',
    product: banker?.product ?? '',
    active: banker?.active ?? true,
    visibleToPartners: banker?.visibleToPartners ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newDesignation, setNewDesignation] = useState('');
  const done = (msg: string) => (toast.success(msg), qc.invalidateQueries({ queryKey: ['bankers'] }), onClose());
  const save = useMutation({
    mutationFn: () => (banker ? api.patch(`/bankers/${banker.id}`, v) : api.post('/bankers', v)),
    onSuccess: () => done(banker ? 'Banker updated' : 'Banker added'),
    onError: (e: ApiError) => (setErrors(e.fields), toast.error(e.message)),
  });
  const del = useMutation({ mutationFn: () => api.del(`/bankers/${banker!.id}`), onSuccess: () => done('Banker removed'), onError: (e: ApiError) => toast.error(e.message) });
  const addDesignation = useMutation({
    mutationFn: () => api.post<Designation>('/banker-designations', { name: newDesignation, level: designations.length }),
    onSuccess: (d) => (qc.invalidateQueries({ queryKey: ['banker-designations'] }), set('designationId', d.id), setNewDesignation(''), toast.success(`Designation "${d.name}" added`)),
    onError: (e: ApiError) => toast.error(e.message),
  });
  const set = (k: keyof typeof v, val: any) => (setV((x) => ({ ...x, [k]: val })), setErrors((e) => ({ ...e, [k]: '' })));
  const text = (k: keyof typeof v, label: string, required = false) => (
    <Field label={label} required={required} htmlFor={`bk-${k}`} error={errors[k]}>
      <Input id={`bk-${k}`} value={v[k] as string} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={banker ? 'Edit banker' : 'Add banker'}
      footer={
        <>
          {banker &&
            can('BANKER_DELETE') &&
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
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bank" required htmlFor="bk-bank" error={errors.bankId}>
          <Select id="bk-bank" value={v.bankId} onChange={(e) => set('bankId', e.target.value)}>
            <option value="">Choose bank</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Designation" htmlFor="bk-des">
          <Select id="bk-des" value={v.designationId} onChange={(e) => set('designationId', e.target.value)}>
            <option value="">—</option>
            {designations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        {text('name', 'Name', true)}
        {text('mobile', 'Mobile')}
        {text('email', 'Email')}
        {text('branch', 'Branch')}
        {text('city', 'City')}
        {text('region', 'Region')}
        {text('product', 'Product')}
        <div className="flex items-end gap-2">
          <Field label="New designation (optional)" htmlFor="bk-newdes" hint="Designations are unlimited, e.g. Cluster Head">
            <Input id="bk-newdes" value={newDesignation} onChange={(e) => setNewDesignation(e.target.value)} />
          </Field>
          <Button variant="secondary" disabled={newDesignation.trim().length < 2} loading={addDesignation.isPending} onClick={() => addDesignation.mutate()} className="mb-[22px]">
            Add
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Active
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4" checked={v.visibleToPartners} onChange={(e) => set('visibleToPartners', e.target.checked)} /> DSA and Team Partners can see this banker
        </label>
      </div>
    </Modal>
  );
}
