'use client';
/** Partner profile popup for Admin / Admin Executive: contact details and addresses, fillable when missing. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Home, Mail, MessageCircle, Pencil, Phone } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { ROLE_LABELS, type Role } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDate, initials } from '@/lib/format';
import { Badge, Button, ErrorState, Field, Input, Modal, Skeleton, Textarea } from './ui';

interface Card {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  role: Role;
  status: string;
  officeAddress: string | null;
  residenceAddress: string | null;
  lastLoginAt: string | null;
  joinedAt: string;
  dsaCode: string | null;
  firmName: string | null;
  dsa: { id: string; name: string; mobile: string; code: string } | null;
  canEdit: boolean;
}

const Missing = () => <span className="text-sm italic text-ink-400">Not added yet</span>;

export function PartnerCardModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['user-card', userId], queryFn: () => api.get<Card>(`/users/${userId}/card`) });
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ email: '', officeAddress: '', residenceAddress: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const c = q.data;
  const startEdit = () => {
    if (!c) return;
    setV({ email: c.email ?? '', officeAddress: c.officeAddress ?? '', residenceAddress: c.residenceAddress ?? '' });
    setEditing(true);
  };
  const save = useMutation({
    mutationFn: () => api.patch(`/users/${userId}/contact`, v),
    onSuccess: () => {
      toast.success('Contact details saved');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['user-card', userId] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e: ApiError) => (setErrors(e.fields ?? {}), toast.error(e.message)),
  });
  const missing = c ? [!c.email && 'email', !c.officeAddress && 'office address', !c.residenceAddress && 'residence address'].filter(Boolean) : [];

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={c?.name ?? 'Partner'}
      description={c ? `${ROLE_LABELS[c.role]}${c.dsaCode ? ` · ${c.dsaCode}` : ''}${c.dsa ? ` · Team of ${c.dsa.name}` : ''}` : undefined}
      footer={
        editing ? (
          <>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              Save details
            </Button>
          </>
        ) : (
          c?.canEdit && (
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={startEdit}>
              {missing.length ? 'Add missing details' : 'Edit details'}
            </Button>
          )
        )
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-56" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : c && editing ? (
        <div className="space-y-3">
          <Field label="Email" htmlFor="pc-email" error={errors.email}>
            <Input id="pc-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="name@example.com" />
          </Field>
          <Field label="Office address" htmlFor="pc-office" error={errors.officeAddress}>
            <Textarea id="pc-office" value={v.officeAddress} onChange={(e) => setV({ ...v, officeAddress: e.target.value })} maxLength={400} placeholder="Shop / office no., building, area, city, PIN" />
          </Field>
          <Field label="Residence address" htmlFor="pc-home" error={errors.residenceAddress}>
            <Textarea id="pc-home" value={v.residenceAddress} onChange={(e) => setV({ ...v, residenceAddress: e.target.value })} maxLength={400} placeholder="House / flat no., society, area, city, PIN" />
          </Field>
        </div>
      ) : (
        c && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient font-display text-base font-bold text-white">{initials(c.name)}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={c.role === 'DSA' ? 'dark' : 'neutral'}>{ROLE_LABELS[c.role]}</Badge>
                  {c.status !== 'ACTIVE' && <Badge tone="red">{c.status.replace('_', ' ').toLowerCase()}</Badge>}
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  Joined {fmtDate(c.joinedAt)} · Last sign-in {c.lastLoginAt ? fmtDate(c.lastLoginAt) : 'never'}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <a href={`tel:+91${c.mobile}`} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-white text-sm font-semibold ring-1 ring-inset ring-ink-200 hover:bg-ink-50">
                <Phone className="h-4 w-4" /> +91 {c.mobile}
              </a>
              <a href={`https://wa.me/91${c.mobile}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-50 text-sm font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            </div>
            <dl className="divide-y divide-ink-100 rounded-2xl ring-1 ring-ink-200/70">
              {[
                [<Mail key="m" className="h-4 w-4" />, 'Email', c.email ? <a href={`mailto:${c.email}`} className="text-sm font-medium text-teal-800 hover:underline">{c.email}</a> : <Missing />],
                [<Building2 key="o" className="h-4 w-4" />, 'Office address', c.officeAddress ? <span className="whitespace-pre-line text-sm">{c.officeAddress}</span> : <Missing />],
                [<Home key="h" className="h-4 w-4" />, 'Residence address', c.residenceAddress ? <span className="whitespace-pre-line text-sm">{c.residenceAddress}</span> : <Missing />],
              ].map(([icon, label, value]) => (
                <div key={label as string} className="flex gap-3 px-3 py-2.5">
                  <span className="mt-0.5 text-ink-400">{icon}</span>
                  <div className="min-w-0">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</dt>
                    <dd className="mt-0.5 break-words">{value}</dd>
                  </div>
                </div>
              ))}
            </dl>
            {c.dsa && (
              <p className="text-sm text-ink-600">
                Their DSA Partner: <span className="font-semibold text-ink">{c.dsa.name}</span> ({c.dsa.code}) ·{' '}
                <a href={`tel:+91${c.dsa.mobile}`} className="font-semibold text-teal-800 hover:underline">
                  +91 {c.dsa.mobile}
                </a>
              </p>
            )}
            <Link href={`/cases?${c.role === 'TEAM_PARTNER' ? 'teamPartnerId' : 'dsaId'}=${c.id}`} onClick={onClose} className="inline-block text-sm font-semibold text-teal-700 hover:underline">
              See all their cases
            </Link>
          </div>
        )
      )}
    </Modal>
  );
}
