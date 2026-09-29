'use client';
/** Bankwise Codes (PART 41): partners search current codes; Rupeemap staff manage them. */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Hash, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useCan } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui';

interface Code {
  id: string;
  bankId: string;
  bank: { id: string; name: string; shortName: string | null };
  product: string;
  code: string;
  city: string | null;
  region: string | null;
  branch: string | null;
  effectiveFrom: string | null;
  expiresOn: string | null;
  active: boolean;
  remarks: string | null;
  visibleToPartners: boolean;
}

const expired = (c: Code) => !c.active || (!!c.expiresOn && new Date(c.expiresOn) < new Date(new Date().toDateString()));

export default function BankCodesPage() {
  const can = useCan();
  const manage = can('BANK_CODE_MANAGE');
  const [q, setQ] = useState('');
  const [bankId, setBankId] = useState('');
  const [show, setShow] = useState('current');
  const [editing, setEditing] = useState<Code | 'new' | null>(null);
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string }[]>('/banks'), staleTime: 600_000 });
  const list = useQuery({ queryKey: ['bank-codes', q, bankId, show], queryFn: () => api.get<Code[]>('/bank-codes', { q, bankId, show }), placeholderData: keepPreviousData });
  const copy = (c: Code) =>
    navigator.clipboard
      .writeText(c.code)
      .then(() => toast.success(`Copied ${c.code}`))
      .catch(() => toast.error('Could not copy on this device'));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bankwise Code"
        sub={manage ? 'DSA codes by bank, product and location. Choose which codes partners can see.' : 'Rupeemap codes to quote at each bank, by product and location. Tap a code to copy it.'}
        actions={
          manage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
              Add code
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search code, product, city or branch" value={q} onChange={(e) => setQ(e.target.value)} className="sm:max-w-sm" aria-label="Search codes" />
        <Select value={bankId} onChange={(e) => setBankId(e.target.value)} className="sm:max-w-[220px]" aria-label="Bank">
          <option value="">All banks</option>
          {banks.data?.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
        {manage && (
          <Select value={show} onChange={(e) => setShow(e.target.value)} className="sm:max-w-[200px]" aria-label="Show">
            <option value="current">Current codes</option>
            <option value="expired">Expired or inactive</option>
            <option value="all">All codes</option>
          </Select>
        )}
      </div>

      {list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : list.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState icon={<Hash className="h-6 w-6" />} title="No codes found" body={manage ? 'Add the codes Rupeemap holds with each bank.' : 'Ask Rupeemap if you need a code for this bank.'} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-ink-100">
            {list.data.map((c) => (
              <li key={c.id} className={cx('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center', expired(c) && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {c.bank.name} <span className="font-normal text-ink-500">· {c.product}</span>
                  </p>
                  <p className="text-xs text-ink-500">
                    {[c.branch, c.city, c.region].filter(Boolean).join(', ') || 'All locations'}
                    {c.expiresOn ? ` · valid till ${fmtDate(c.expiresOn)}` : ''}
                    {c.remarks ? ` · ${c.remarks}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {manage && !c.visibleToPartners && <Badge>Staff only</Badge>}
                  {expired(c) && <Badge tone="red">{c.active ? 'Expired' : 'Inactive'}</Badge>}
                  <button onClick={() => copy(c)} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 font-mono text-sm font-semibold text-white hover:bg-ink-800" title="Copy code">
                    {c.code} <Copy className="h-3.5 w-3.5 opacity-70" />
                  </button>
                  {manage && (
                    <button onClick={() => setEditing(c)} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100" aria-label={`Edit ${c.code}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <CodeModal code={editing === 'new' ? null : editing} banks={banks.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CodeModal({ code, banks, onClose }: { code: Code | null; banks: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({
    bankId: code?.bankId ?? '',
    product: code?.product ?? 'Home Loan',
    code: code?.code ?? '',
    city: code?.city ?? '',
    region: code?.region ?? '',
    branch: code?.branch ?? '',
    effectiveFrom: code?.effectiveFrom?.slice(0, 10) ?? '',
    expiresOn: code?.expiresOn?.slice(0, 10) ?? '',
    remarks: code?.remarks ?? '',
    active: code?.active ?? true,
    visibleToPartners: code?.visibleToPartners ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const done = (msg: string) => (toast.success(msg), qc.invalidateQueries({ queryKey: ['bank-codes'] }), onClose());
  const save = useMutation({
    mutationFn: () => (code ? api.patch(`/bank-codes/${code.id}`, v) : api.post('/bank-codes', v)),
    onSuccess: () => done(code ? 'Code updated' : 'Code added'),
    onError: (e: ApiError) => (setErrors(e.fields), toast.error(e.message)),
  });
  const del = useMutation({ mutationFn: () => api.del(`/bank-codes/${code!.id}`), onSuccess: () => done('Code deleted'), onError: (e: ApiError) => toast.error(e.message) });
  const set = (k: keyof typeof v, val: any) => (setV((x) => ({ ...x, [k]: val })), setErrors((e) => ({ ...e, [k]: '' })));
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={code ? 'Edit bank code' : 'Add bank code'}
      footer={
        <>
          {code &&
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
        <Field label="Bank" required htmlFor="bc-bank" error={errors.bankId}>
          <Select id="bc-bank" value={v.bankId} onChange={(e) => set('bankId', e.target.value)}>
            <option value="">Choose bank</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Product" required htmlFor="bc-product" error={errors.product}>
          <Input id="bc-product" value={v.product} onChange={(e) => set('product', e.target.value)} />
        </Field>
        <Field label="Code" required htmlFor="bc-code" error={errors.code}>
          <Input id="bc-code" className="font-mono" value={v.code} onChange={(e) => set('code', e.target.value)} />
        </Field>
        <Field label="Branch" htmlFor="bc-branch">
          <Input id="bc-branch" value={v.branch} onChange={(e) => set('branch', e.target.value)} />
        </Field>
        <Field label="City" htmlFor="bc-city">
          <Input id="bc-city" value={v.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Region" htmlFor="bc-region">
          <Input id="bc-region" value={v.region} onChange={(e) => set('region', e.target.value)} />
        </Field>
        <Field label="Effective from" htmlFor="bc-from">
          <Input id="bc-from" type="date" value={v.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
        </Field>
        <Field label="Valid till" htmlFor="bc-to" error={errors.expiresOn}>
          <Input id="bc-to" type="date" value={v.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Remarks" htmlFor="bc-rem">
            <Textarea id="bc-rem" value={v.remarks} onChange={(e) => set('remarks', e.target.value)} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Active
        </label>
        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" className="h-4 w-4" checked={v.visibleToPartners} onChange={(e) => set('visibleToPartners', e.target.checked)} /> DSA and Team Partners can see this code
        </label>
      </div>
    </Modal>
  );
}
