'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { useCan } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, cx, EmptyState, Field, Input, Modal, Select, Skeleton, Textarea } from '@/components/ui';

interface Item {
  id: string;
  title: string;
  body: string;
  priority: string;
  caseId: string | null;
  caseNo: string | null;
  attachment: { id: string; originalName: string } | null;
  createdAt: string;
  readAt: string | null;
}
interface Sent {
  id: string;
  title: string;
  body: string;
  audience: string;
  priority: string;
  startsAt: string;
  expiresAt: string | null;
  createdAt: string;
  attachment: { id: string; originalName: string } | null;
  sentBy: string | null;
  recipients: number;
  read: number;
}
const AUDIENCE: Record<string, string> = { ALL: 'Everyone', DSA: 'All DSA Partners', TEAM_PARTNER: 'All Team Partners', EXECUTIVE: 'All Executives', USER: 'One person' };

export default function NotificationsPage() {
  const qc = useQueryClient();
  const can = useCan();
  const [compose, setCompose] = useState(false);
  const canSend = can('NOTIFICATION_SEND_BROADCAST') || can('NOTIFICATION_SEND_INDIVIDUAL');
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox');
  const sent = useQuery({ queryKey: ['notifications', 'sent'], queryFn: () => api.get<Sent[]>('/notifications/sent'), enabled: canSend && tab === 'sent' });
  const q = useQuery({ queryKey: ['notifications', 'list'], queryFn: () => api.get<{ unreadCount: number; items: Item[] }>('/notifications') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Notifications"
        sub={q.data ? `${q.data.unreadCount} unread` : ' '}
        actions={
          <>
            {!!q.data?.unreadCount && (
              <Button variant="secondary" size="sm" loading={readAll.isPending} onClick={() => readAll.mutate()}>
                Mark all read
              </Button>
            )}
            {canSend && (
              <Button size="sm" onClick={() => setCompose(true)}>
                Send notification
              </Button>
            )}
          </>
        }
      />
      {canSend && (
        <div className="mb-3 flex gap-1" role="tablist" aria-label="Notifications">
          {(['inbox', 'sent'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('rounded-xl px-3 py-2 text-sm font-semibold', tab === t ? 'bg-teal-700 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50')}>
              {t === 'inbox' ? 'My notifications' : 'Sent'}
            </button>
          ))}
        </div>
      )}
      {tab === 'sent' ? (
        sent.isLoading ? (
          <Skeleton className="h-64 rounded-2xl" />
        ) : !sent.data?.length ? (
          <Card>
            <EmptyState title="Nothing sent yet" />
          </Card>
        ) : (
          <Card className="divide-y divide-ink-100 overflow-hidden">
            {sent.data.map((n) => (
              <div key={n.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{n.title}</p>
                    {n.priority === 'HIGH' && <Badge tone="red">Important</Badge>}
                    {new Date(n.startsAt) > new Date() && <Badge tone="gold">Scheduled {fmtDateTime(n.startsAt)}</Badge>}
                    {n.expiresAt && new Date(n.expiresAt) < new Date() && <Badge>Expired</Badge>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{n.body}</p>
                  <p className="mt-1 text-xs text-ink-500">
                    {AUDIENCE[n.audience] ?? n.audience} · {fmtDateTime(n.createdAt)}
                    {n.sentBy ? ` · by ${n.sentBy}` : ''}
                    {n.attachment ? ` · 📎 ${n.attachment.originalName}` : ''}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-display text-lg font-bold tabular-nums">
                    {n.read}/{n.recipients}
                  </p>
                  <p className="text-xs text-ink-500">read</p>
                </div>
              </div>
            ))}
          </Card>
        )
      ) : q.isLoading ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : !q.data?.items.length ? (
        <Card>
          <EmptyState title="You're all caught up" body="Case updates, payout changes and announcements appear here." />
        </Card>
      ) : (
        <Card className="divide-y divide-ink-100 overflow-hidden">
          {q.data.items.map((n) => (
            <div key={n.id} className={cx('flex gap-3 p-4', !n.readAt && 'bg-teal-50/50')}>
              <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-teal')} aria-label={n.readAt ? 'Read' : 'Unread'} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{n.title}</p>
                  {n.priority === 'HIGH' && <Badge tone="red">Important</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-ink-600">{n.body}</p>
                <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-ink-500">
                  <time dateTime={n.createdAt} title={fmtDateTime(n.createdAt)}>
                    {timeAgo(n.createdAt)}
                  </time>
                  {n.caseId && (
                    <Link href={`/cases/${n.caseId}`} className="font-semibold text-teal-700" onClick={() => !n.readAt && read.mutate(n.id)}>
                      Open case{n.caseNo ? ` ${n.caseNo}` : ''}
                    </Link>
                  )}
                  {n.attachment && (
                    <a href={`/api/v1/notifications/${n.id}/attachment`} target="_blank" rel="noreferrer" className="font-semibold text-teal-700" onClick={() => !n.readAt && read.mutate(n.id)}>
                      📎 {n.attachment.originalName}
                    </a>
                  )}
                  {!n.readAt && (
                    <button className="font-semibold text-ink-600 hover:text-ink" onClick={() => read.mutate(n.id)}>
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
      {compose && <Compose onClose={() => setCompose(false)} />}
    </div>
  );
}

function Compose({ onClose }: { onClose: () => void }) {
  const can = useCan();
  const qc = useQueryClient();
  const [v, setV] = useState({ audience: can('NOTIFICATION_SEND_BROADCAST') ? 'ALL' : 'USER', userId: '', title: '', body: '', priority: 'NORMAL', startsAt: '', expiresAt: '' });
  const [file, setFile] = useState<File | null>(null);
  const users = useQuery({ queryKey: ['users', 'picker'], queryFn: () => api.page<{ id: string; name: string; role: string }>('/users', { pageSize: 100 }), enabled: v.audience === 'USER' });
  const m = useMutation({
    mutationFn: () =>
      api.form<{ recipients: number }>(
        '/notifications',
        {
          ...v,
          startsAt: v.startsAt ? new Date(`${v.startsAt}T00:00:00`).toISOString() : '',
          expiresAt: v.expiresAt ? new Date(`${v.expiresAt}T23:59:59`).toISOString() : '',
        },
        file,
      ),
    onSuccess: (r) => {
      toast.success(`Sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'}`);
      qc.invalidateQueries({ queryKey: ['notifications'] });
      onClose();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Send notification"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={m.isPending} onClick={() => m.mutate()}>
            Send
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Send to" htmlFor="au">
            <Select id="au" value={v.audience} onChange={(e) => set('audience', e.target.value)}>
              {can('NOTIFICATION_SEND_BROADCAST') && (
                <>
                  <option value="ALL">Everyone</option>
                  <option value="DSA">All DSA Partners</option>
                  <option value="TEAM_PARTNER">All Team Partners</option>
                  <option value="EXECUTIVE">All Executives</option>
                </>
              )}
              {can('NOTIFICATION_SEND_INDIVIDUAL') && <option value="USER">One person</option>}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="pr">
            <Select id="pr" value={v.priority} onChange={(e) => set('priority', e.target.value)}>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">Important</option>
              <option value="LOW">Low</option>
            </Select>
          </Field>
        </div>
        {v.audience === 'USER' && (
          <Field label="Person" htmlFor="us">
            <Select id="us" value={v.userId} onChange={(e) => set('userId', e.target.value)}>
              <option value="">Choose</option>
              {users.data?.data.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Title" required htmlFor="ti">
          <Input id="ti" value={v.title} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Message" required htmlFor="bd">
          <Textarea id="bd" value={v.body} onChange={(e) => set('body', e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Show from" htmlFor="st" hint="Optional. Blank sends now.">
            <Input id="st" type="date" value={v.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
          </Field>
          <Field label="Expires on" htmlFor="ex" hint="Optional. Hidden after this date.">
            <Input id="ex" type="date" value={v.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} />
          </Field>
        </div>
        <Field label="Attachment (optional)" htmlFor="at" hint="PDF or image, up to 10 MB">
          <Input id="at" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="pt-2" />
        </Field>
      </div>
    </Modal>
  );
}
