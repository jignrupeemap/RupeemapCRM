'use client';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MEASUREMENT_UNITS, MEASUREMENT_UNIT_LABELS, PROJECT_TYPES, UNIT_TYPES, type MeasurementUnit } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { formatINRCompact } from '@/lib/format';
import { useCan } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, cx, EmptyState, Field, Input, Modal, Pagination, Select, Skeleton, Tab, TabList, TabPanel, Tabs } from '@/components/ui';
import { ProjectAnalytics } from '@/components/project-analytics';

interface Project {
  id: string;
  name: string;
  city: string;
  locality: string;
  state: string;
  reraNumber: string | null;
  projectType: string;
  unitTypes: string[];
  priceMin: string | null;
  priceMax: string | null;
  measurementUnit: MeasurementUnit | null;
  active: boolean;
}

const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

export default function ProjectsPage() {
  const can = useCan();
  const [view, setView] = useState('directory');
  return (
    <div>
      <PageHeader
        title="Project Master"
        sub="Approved projects to link with cases, and how each project is performing. Everyone can view; only Rupeemap can add or edit."
      />
      {can('REPORT_VIEW') ? (
        <Tabs value={view} onValueChange={setView}>
          <TabList>
            <Tab value="directory">Projects</Tab>
            <Tab value="analytics">Project-wise analysis</Tab>
          </TabList>
          <TabPanel value="directory" className="pt-4">
            <Directory />
          </TabPanel>
          <TabPanel value="analytics" className="pt-4">
            <ProjectAnalytics />
          </TabPanel>
        </Tabs>
      ) : (
        <Directory />
      )}
    </div>
  );
}

function Directory() {
  const can = useCan();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const manage = can('PROJECT_MANAGE');
  const list = useQuery({
    queryKey: ['projects', 'page', q, type, page],
    queryFn: () => api.page<Project>('/projects', { q, projectType: type, page, pageSize: 24, includeInactive: manage ? '1' : undefined }),
    placeholderData: keepPreviousData,
  });
  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search project, city, locality or RERA" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} className="sm:max-w-sm" aria-label="Search projects" />
        <Select value={type} onChange={(e) => (setType(e.target.value), setPage(1))} className="sm:max-w-[200px]" aria-label="Project type">
          <option value="">All types</option>
          {PROJECT_TYPES.map((t) => <option key={t} value={t}>{title(t)}</option>)}
        </Select>
        {manage && <Button className="sm:ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>Add project</Button>}
      </div>
      {list.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      ) : !list.data?.data.length ? (
        <Card><EmptyState title="No projects found" /></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.data.map((p) => (
              <Card key={p.id} className={cx('flex flex-col p-4', !p.active && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display font-bold leading-tight">{p.name}</p>
                    <p className="mt-1 flex items-center gap-1 text-sm text-ink-500"><MapPin className="h-3.5 w-3.5" />{[p.locality, p.city, p.state].filter(Boolean).join(', ')}</p>
                  </div>
                  <Badge tone={p.projectType === 'RESIDENTIAL' ? 'teal' : p.projectType === 'COMMERCIAL' ? 'gold' : 'neutral'}>{title(p.projectType)}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">{p.unitTypes.map((u) => <Badge key={u}>{title(u)}</Badge>)}</div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-ink-500">Market price</dt><dd className="font-semibold tabular-nums">{p.priceMin ? `${formatINRCompact(p.priceMin)} – ${formatINRCompact(p.priceMax)}` : '—'}</dd></div>
                  <div><dt className="text-xs text-ink-500">Measured on</dt><dd className="font-semibold">{p.measurementUnit ? MEASUREMENT_UNIT_LABELS[p.measurementUnit] : '—'}</dd></div>
                </dl>
                <p className="mt-3 break-all text-xs text-ink-500">RERA: {p.reraNumber ?? 'Not registered'}</p>
                {!p.active && <p className="mt-1 text-xs font-semibold text-brand-red">Inactive</p>}
                {manage && (
                  <div className="mt-auto pt-3">
                    <Button size="sm" variant="secondary" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(p)}>Edit</Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
          <Pagination page={list.data.meta.page} pageSize={list.data.meta.pageSize} total={list.data.meta.total} onPage={setPage} />
        </>
      )}
      {editing && <ProjectModal project={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ProjectModal({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const qc = useQueryClient();
  const can = useCan();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useMutation({
    mutationFn: () => api.del(`/projects/${project!.id}`),
    onSuccess: () => {
      toast.success('Project deleted. Existing cases keep their project link.');
      qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  const [v, setV] = useState({
    name: project?.name ?? '',
    city: project?.city ?? '',
    locality: project?.locality ?? '',
    state: project?.state ?? 'Gujarat',
    reraNumber: project?.reraNumber ?? '',
    projectType: project?.projectType ?? 'RESIDENTIAL',
    unitTypes: project?.unitTypes ?? ['FLAT'],
    priceMin: project?.priceMin ?? '',
    priceMax: project?.priceMax ?? '',
    measurementUnit: project?.measurementUnit ?? 'SBA',
    active: project?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => {
      const body = { ...v, priceMin: v.priceMin === '' ? undefined : v.priceMin, priceMax: v.priceMax === '' ? undefined : v.priceMax };
      return project ? api.patch(`/projects/${project.id}`, body) : api.post('/projects', body);
    },
    onSuccess: () => {
      toast.success(project ? 'Project updated' : 'Project added');
      qc.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: (e: ApiError) => (setErrors(e.fields), toast.error(e.message)),
  });
  const set = (k: string, val: any) => (setV((p) => ({ ...p, [k]: val })), setErrors((e) => ({ ...e, [k]: '' })));
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={project ? 'Edit project' : 'Add project'} wide footer={<>
        {project && can('PROJECT_DELETE') && (
          confirmDelete
            ? <Button variant="danger" className="sm:mr-auto" loading={del.isPending} onClick={() => del.mutate()}>Confirm delete</Button>
            : <Button variant="ghost" className="text-brand-red sm:mr-auto" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>Delete</Button>
        )}
        <Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save project</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Project name" required htmlFor="pn" error={errors.name}><Input id="pn" value={v.name} onChange={(e) => set('name', e.target.value)} /></Field></div>
        <Field label="City" required htmlFor="pc" error={errors.city}><Input id="pc" value={v.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="Locality" htmlFor="pl"><Input id="pl" value={v.locality} onChange={(e) => set('locality', e.target.value)} /></Field>
        <Field label="State" required htmlFor="ps" error={errors.state}><Input id="ps" value={v.state} onChange={(e) => set('state', e.target.value)} /></Field>
        <Field label="RERA number" htmlFor="pr" error={errors.reraNumber}><Input id="pr" value={v.reraNumber} onChange={(e) => set('reraNumber', e.target.value)} /></Field>
        <Field label="Project type" required htmlFor="pt"><Select id="pt" value={v.projectType} onChange={(e) => set('projectType', e.target.value)}>{PROJECT_TYPES.map((t) => <option key={t} value={t}>{title(t)}</option>)}</Select></Field>
        <Field label="Measurement basis" htmlFor="pm"><Select id="pm" value={v.measurementUnit} onChange={(e) => set('measurementUnit', e.target.value)}>{MEASUREMENT_UNITS.map((u) => <option key={u} value={u}>{MEASUREMENT_UNIT_LABELS[u]}</option>)}</Select></Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-700">Unit types <span className="text-brand-red">*</span></legend>
          <div className="flex flex-wrap gap-2">
            {UNIT_TYPES.map((u) => {
              const on = v.unitTypes.includes(u);
              return (
                <button type="button" key={u} aria-pressed={on} onClick={() => set('unitTypes', on ? v.unitTypes.filter((x) => x !== u) : [...v.unitTypes, u])} className={cx('rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset', on ? 'bg-ink text-white ring-ink' : 'ring-ink-200')}>{title(u)}</button>
              );
            })}
          </div>
          {errors.unitTypes && <p className="mt-1 text-xs text-brand-red">{errors.unitTypes}</p>}
        </fieldset>
        <Field label="Market price minimum" htmlFor="p1"><Input id="p1" prefix="₹" inputMode="decimal" value={v.priceMin} onChange={(e) => set('priceMin', e.target.value)} /></Field>
        <Field label="Market price maximum" htmlFor="p2" error={errors.priceMax}><Input id="p2" prefix="₹" inputMode="decimal" value={v.priceMax} onChange={(e) => set('priceMax', e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2"><input type="checkbox" className="h-4 w-4" checked={v.active} onChange={(e) => set('active', e.target.checked)} /> Active (shown when creating cases)</label>
      </div>
    </Modal>
  );
}
