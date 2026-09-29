'use client';
/** Admin: manage the dashboard hero slider (PART 12, 78). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GalleryHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { PageHeader } from '@/components/shell';
import { HeroSlider, type Slide } from '@/components/hero-slider';
import { Badge, Button, Card, cx, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui';

interface AdminSlide extends Slide {
  active: boolean;
  startsAt: string;
  endsAt: string | null;
  sortOrder: number;
  bankId: string | null;
  bankName: string | null;
  mediaName: string | null;
}

const KINDS: Record<string, string> = { BANK_OFFER: 'Bank offer', PRODUCT_OFFER: 'Product offer', CAMPAIGN: 'Campaign', ANNOUNCEMENT: 'Announcement' };
const THEMES: Record<string, string> = { teal: 'Teal', ink: 'Black', gold: 'Gold', red: 'Red' };

function state(s: AdminSlide): { label: string; tone: 'teal' | 'gold' | 'red' | 'neutral' } {
  const now = new Date();
  if (!s.active) return { label: 'Off', tone: 'neutral' };
  if (new Date(s.startsAt) > now) return { label: `Starts ${fmtDate(s.startsAt)}`, tone: 'gold' };
  if (s.endsAt && new Date(s.endsAt) <= now) return { label: 'Ended', tone: 'red' };
  return { label: 'Live', tone: 'teal' };
}

export default function SlidersPage() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['sliders', 'admin'], queryFn: () => api.get<AdminSlide[]>('/sliders') });
  const [editing, setEditing] = useState<AdminSlide | 'new' | null>(null);
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.post('/sliders/reorder', { ids }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['sliders'] }), toast.success('Order saved')),
    onError: (e: ApiError) => toast.error(e.message),
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = (list.data ?? []).map((s) => s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reorder.mutate(ids);
  };
  const live = (list.data ?? []).filter((s) => state(s).label === 'Live');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard slider"
        sub="Offers, campaigns and announcements at the top of every dashboard. Add a picture or a short MP4 video, schedule dates and set the order."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add slide
          </Button>
        }
      />
      {live.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">What partners see now</p>
          <HeroSlider slides={live} />
        </section>
      )}
      {list.isError ? (
        <Card>
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        </Card>
      ) : list.isLoading ? (
        <Skeleton className="h-48 rounded-2xl" />
      ) : !list.data?.length ? (
        <Card>
          <EmptyState icon={<GalleryHorizontal className="h-6 w-6" />} title="No slides yet" body="Add your first offer or announcement." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ol className="divide-y divide-ink-100">
            {list.data.map((s, i) => {
              const st = state(s);
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex flex-col">
                    <button className="rounded p-1 text-ink-500 hover:bg-ink-100 disabled:opacity-30" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={`Move ${s.title} up`}>
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button className="rounded p-1 text-ink-500 hover:bg-ink-100 disabled:opacity-30" disabled={i === list.data!.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={`Move ${s.title} down`}>
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                  <div className={cx('h-12 w-20 shrink-0 overflow-hidden rounded-lg', s.theme === 'gold' ? 'bg-[#f3d58c]' : s.theme === 'red' ? 'bg-brand-red' : s.theme === 'ink' ? 'bg-ink' : 'bg-teal-800')}>
                    {s.mediaType === 'IMAGE' && s.mediaUrl && <img src={s.mediaUrl} alt="" className="h-full w-full object-cover" />}
                    {s.mediaType === 'VIDEO' && <div className="flex h-full items-center justify-center text-xs font-semibold text-white">Video</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{s.title}</p>
                    <p className="truncate text-xs text-ink-500">
                      {KINDS[s.kind] ?? s.kind}
                      {s.bankName ? ` · ${s.bankName}` : ''}
                      {s.ctaLabel ? ` · button “${s.ctaLabel}”` : ''} · from {fmtDate(s.startsAt)}
                      {s.endsAt ? ` to ${fmtDate(s.endsAt)}` : ''}
                    </p>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
      {editing && <SlideModal slide={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SlideModal({ slide, onClose }: { slide: AdminSlide | null; onClose: () => void }) {
  const qc = useQueryClient();
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string }[]>('/banks'), staleTime: 600_000 });
  const [v, setV] = useState({
    kind: slide?.kind ?? 'BANK_OFFER',
    title: slide?.title ?? '',
    subtitle: slide?.subtitle ?? '',
    theme: slide?.theme ?? 'teal',
    ctaLabel: slide?.ctaLabel ?? '',
    ctaUrl: slide?.ctaUrl ?? '',
    bankId: slide?.bankId ?? '',
    startsAt: slide?.startsAt?.slice(0, 10) ?? '',
    endsAt: slide?.endsAt?.slice(0, 10) ?? '',
    active: slide?.active ?? true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [removeMedia, setRemoveMedia] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const done = (msg: string) => (toast.success(msg), qc.invalidateQueries({ queryKey: ['sliders'] }), onClose());
  const fields = () => ({
    ...v,
    active: String(v.active),
    removeMedia: String(removeMedia),
    startsAt: v.startsAt ? new Date(`${v.startsAt}T00:00:00`).toISOString() : '',
    endsAt: v.endsAt ? new Date(`${v.endsAt}T23:59:59`).toISOString() : '',
  });
  const save = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      for (const [k, val] of Object.entries(fields())) form.append(k, val);
      if (file) form.append('file', file);
      const res = await fetch(`/api/v1/sliders${slide ? `/${slide.id}` : ''}`, { method: slide ? 'PATCH' : 'POST', body: form, credentials: 'same-origin', headers: { 'x-requested-with': 'rupeemap' } });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new ApiError(json?.code ?? 'INTERNAL_ERROR', json?.message ?? 'Could not save the slide', res.status, json?.details);
      return json.data;
    },
    onSuccess: () => done(slide ? 'Slide updated' : 'Slide added'),
    onError: (e: ApiError) => (setErrors(e.fields ?? {}), toast.error(e.message)),
  });
  const del = useMutation({ mutationFn: () => api.del(`/sliders/${slide!.id}`), onSuccess: () => done('Slide deleted'), onError: (e: ApiError) => toast.error(e.message) });
  const set = (k: keyof typeof v, val: any) => (setV((x) => ({ ...x, [k]: val })), setErrors((e) => ({ ...e, [k]: '' })));
  const preview: Slide = { id: 'preview', kind: v.kind, title: v.title || 'Your headline', subtitle: v.subtitle, theme: v.theme, ctaLabel: v.ctaLabel, ctaUrl: v.ctaUrl, mediaType: file ? (file.type.startsWith('video') ? 'VIDEO' : 'IMAGE') : removeMedia ? 'NONE' : slide?.mediaType ?? 'NONE', mediaUrl: file ? URL.createObjectURL(file) : removeMedia ? null : slide?.mediaUrl };

  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={slide ? 'Edit slide' : 'Add slide'}
      footer={
        <>
          {slide &&
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
      <div className="space-y-4">
        <HeroSlider slides={[preview]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="sl-kind">
            <Select id="sl-kind" value={v.kind} onChange={(e) => set('kind', e.target.value)}>
              {Object.entries(KINDS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Colour" htmlFor="sl-theme">
            <Select id="sl-theme" value={v.theme} onChange={(e) => set('theme', e.target.value)}>
              {Object.entries(THEMES).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Headline" required htmlFor="sl-title" error={errors.title}>
              <Input id="sl-title" value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={90} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Text below" htmlFor="sl-sub">
              <Textarea id="sl-sub" value={v.subtitle} onChange={(e) => set('subtitle', e.target.value)} maxLength={200} className="min-h-[64px]" />
            </Field>
          </div>
          {v.kind === 'BANK_OFFER' && (
            <Field label="Bank" htmlFor="sl-bank">
              <Select id="sl-bank" value={v.bankId} onChange={(e) => set('bankId', e.target.value)}>
                <option value="">—</option>
                {banks.data?.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Picture or video" htmlFor="sl-file" hint="JPG, PNG or WEBP up to 10 MB, or MP4 up to 25 MB" error={errors.file}>
            <Input id="sl-file" type="file" accept=".jpg,.jpeg,.png,.webp,.mp4" onChange={(e) => (setFile(e.target.files?.[0] ?? null), setRemoveMedia(false))} className="pt-2" />
          </Field>
          {slide?.mediaName && !file && (
            <label className="flex items-center gap-2 self-end pb-3 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={removeMedia} onChange={(e) => setRemoveMedia(e.target.checked)} /> Remove {slide.mediaName}
            </label>
          )}
          <Field label="Button text" htmlFor="sl-cta" error={errors.ctaLabel}>
            <Input id="sl-cta" value={v.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)} placeholder="e.g. Add a case" maxLength={30} />
          </Field>
          <Field label="Button opens" htmlFor="sl-url" error={errors.ctaUrl} hint="A page like /cases/new, or an https:// link">
            <Input id="sl-url" value={v.ctaUrl} onChange={(e) => set('ctaUrl', e.target.value)} placeholder="/cases/new" />
          </Field>
          <Field label="Show from" htmlFor="sl-from">
            <Input id="sl-from" type="date" value={v.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
          </Field>
          <Field label="Show until" htmlFor="sl-to" error={errors.endsAt}>
            <Input id="sl-to" type="date" value={v.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" className="h-4 w-4" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Active
          </label>
        </div>
      </div>
    </Modal>
  );
}
