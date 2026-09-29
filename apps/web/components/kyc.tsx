'use client';
/** First payout KYC: document cards, upload, submit and Admin decision. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, FileText, History, Upload, XCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { KYC_DOC_HINTS, KYC_DOC_LABELS, KYC_DOC_TYPES, KYC_STATUS_LABELS, type KycDocType, type KycStatus } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { Banner, Button, Card, cx, ErrorState, Field, Modal, Skeleton, Textarea } from './ui';

const TONE: Record<KycStatus, string> = {
  DOCUMENTS_PENDING: 'bg-brand-goldsoft text-amber-800 ring-amber-200',
  UPLOADED: 'bg-sky-50 text-sky-800 ring-sky-200',
  UNDER_ADMIN_VERIFICATION: 'bg-violet-50 text-violet-800 ring-violet-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  REJECTED: 'bg-brand-redsoft text-red-800 ring-red-200',
  RESUBMISSION_REQUIRED: 'bg-brand-redsoft text-red-800 ring-red-200',
};

export function KycChip({ status }: { status: KycStatus }) {
  return <span className={cx('inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', TONE[status])}>{KYC_STATUS_LABELS[status]}</span>;
}

interface KycDoc {
  id: string;
  type: KycDocType;
  version: number;
  current: boolean;
  uploadedByName: string;
  createdAt: string;
  file: { originalName: string; mime: string; sizeBytes: number };
}
interface KycDetail {
  userId: string;
  user: { id: string; name: string; mobile: string; role: string; status: string };
  status: KycStatus;
  gstApplicable: boolean;
  rejectionReason: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  required: KycDocType[];
  missing: KycDocType[];
  documents: KycDoc[];
  canUpload: boolean;
  canVerify: boolean;
}

const fileUrl = (id: string) => `/api/v1/kyc/documents/${id}/file`;
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function KycPanel({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const can = useCan();
  const q = useQuery({ queryKey: ['kyc', userId], queryFn: () => api.get<KycDetail>(`/kyc/${userId}`) });
  const [deciding, setDeciding] = useState<'APPROVE' | 'REJECT' | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['kyc'] });
    qc.invalidateQueries({ queryKey: ['users'] });
  };
  const gst = useMutation({
    mutationFn: (v: boolean) => api.put(`/kyc/${userId}/gst`, { gstApplicable: v }),
    onSuccess: refresh,
    onError: (e: ApiError) => toast.error(e.message),
  });
  const submit = useMutation({
    mutationFn: () => api.post(`/kyc/${userId}/submit`),
    onSuccess: () => (toast.success('Sent to Admin for verification'), refresh()),
    onError: (e: ApiError) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (q.isError)
    return (
      <Card>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Card>
    );
  const k = q.data!;
  const types = KYC_DOC_TYPES.filter((t) => t !== 'GST_CERTIFICATE' || k.gstApplicable);
  const done = k.required.length - k.missing.length;

  return (
    <div className="space-y-4">
      {k.status === 'RESUBMISSION_REQUIRED' && k.rejectionReason && (
        <Banner tone="red" title="Admin asked for new documents">
          {k.rejectionReason}
        </Banner>
      )}
      {k.status === 'APPROVED' && (
        <Banner tone="teal" title="KYC approved">
          Verified by {k.verifiedBy ?? 'Admin'} on {fmtDateTime(k.verifiedAt)}. Payouts can be released.
        </Banner>
      )}

      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <KycChip status={k.status} />
            <span className="text-sm tabular-nums text-ink-600">
              {done} of {k.required.length} required documents
            </span>
          </div>
          <div className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-ink-100">
            <div className={cx('h-full rounded-full', done === k.required.length ? 'bg-emerald-600' : 'bg-brand-gold')} style={{ width: `${(done / k.required.length) * 100}%` }} />
          </div>
          {k.canUpload && (
            <label className="mt-3 inline-flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="h-4 w-4" checked={k.gstApplicable} disabled={gst.isPending} onChange={(e) => gst.mutate(e.target.checked)} />
              Partner is GST registered (GST certificate required)
            </label>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {k.canUpload && k.status === 'UPLOADED' && (
            <Button variant="teal" loading={submit.isPending} onClick={() => submit.mutate()}>
              Send to Admin for verification
            </Button>
          )}
          {k.canVerify && (
            <>
              <Button variant="secondary" className="text-brand-red" icon={<XCircle className="h-4 w-4" />} onClick={() => setDeciding('REJECT')}>
                Ask for new documents
              </Button>
              <Button variant="teal" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setDeciding('APPROVE')}>
                Approve KYC
              </Button>
            </>
          )}
          {k.status === 'UNDER_ADMIN_VERIFICATION' && !k.canVerify && <p className="text-sm text-ink-500">Waiting for Admin to verify.</p>}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {types.map((t) => (
          <DocCard key={t} userId={userId} type={t} docs={k.documents.filter((d) => d.type === t)} canUpload={k.canUpload} onUploaded={refresh} />
        ))}
      </div>

      {deciding && can('KYC_VERIFY') && <DecisionModal userId={userId} name={k.user.name} decision={deciding} onClose={() => setDeciding(null)} onDone={refresh} />}
    </div>
  );
}

function DocCard({ userId, type, docs, canUpload, onUploaded }: { userId: string; type: KycDocType; docs: KycDoc[]; canUpload: boolean; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const current = docs.find((d) => d.current);
  const m = useMutation({
    mutationFn: (f: File) => api.upload<{ version: number }>(`/kyc/${userId}/documents/${type}`, f),
    onSuccess: (r) => (toast.success(`${KYC_DOC_LABELS[type]} uploaded (version ${r.version})`), onUploaded()),
    onError: (e: ApiError) => toast.error(e.message),
  });
  return (
    <Card className={cx('flex flex-col p-4', !current && 'border-dashed')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display font-bold">{KYC_DOC_LABELS[type]}</p>
          <p className="text-xs text-ink-500">{KYC_DOC_HINTS[type]}</p>
        </div>
        {current ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Uploaded" /> : <span className="shrink-0 text-xs font-semibold text-amber-700">Missing</span>}
      </div>
      {current ? (
        <a href={fileUrl(current.id)} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-3 rounded-xl bg-ink-50 p-3 hover:bg-ink-100">
          <FileText className="h-8 w-8 shrink-0 text-ink-400" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{current.file.originalName}</span>
            <span className="block text-xs text-ink-500">
              v{current.version} · {size(current.file.sizeBytes)} · {current.uploadedByName}, {fmtDateTime(current.createdAt)}
            </span>
          </span>
          <Eye className="h-4 w-4 shrink-0 text-ink-500" aria-label="View" />
        </a>
      ) : (
        <div className="mt-3 rounded-xl bg-ink-50 p-3 text-sm text-ink-500">Not uploaded yet</div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        {docs.length > 1 ? (
          <button className="flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            <History className="h-3.5 w-3.5" /> {docs.length - 1} older version{docs.length > 2 ? 's' : ''}
          </button>
        ) : (
          <span />
        )}
        {canUpload && (
          <>
            <input
              ref={input}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                if (f.size > 10 * 1024 * 1024) return void toast.error('File is larger than 10 MB');
                m.mutate(f);
              }}
            />
            <Button size="sm" variant={current ? 'secondary' : 'primary'} loading={m.isPending} icon={<Upload className="h-4 w-4" />} onClick={() => input.current?.click()}>
              {current ? 'Replace' : 'Upload'}
            </Button>
          </>
        )}
      </div>
      {showHistory && (
        <ul className="mt-2 space-y-1 border-t border-ink-100 pt-2">
          {docs
            .filter((d) => !d.current)
            .map((d) => (
              <li key={d.id}>
                <a href={fileUrl(d.id)} target="_blank" rel="noreferrer" className="flex justify-between gap-2 rounded-lg px-2 py-1 text-xs hover:bg-ink-50">
                  <span className="truncate">
                    v{d.version} · {d.file.originalName}
                  </span>
                  <span className="shrink-0 text-ink-500">{fmtDateTime(d.createdAt)}</span>
                </a>
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}

function DecisionModal({ userId, name, decision, onClose, onDone }: { userId: string; name: string; decision: 'APPROVE' | 'REJECT'; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const m = useMutation({
    mutationFn: () => api.post(`/users/${userId}/kyc`, { decision, reason: reason.trim() || undefined }),
    onSuccess: () => {
      toast.success(decision === 'APPROVE' ? `${name}'s KYC approved` : 'Sent back for new documents');
      onDone();
      onClose();
    },
    onError: (e: ApiError) => setError(e.fields.reason ?? e.message),
  });
  return (
    <Modal
      open
      onOpenChange={(v) => !v && onClose()}
      title={decision === 'APPROVE' ? `Approve ${name}'s KYC?` : 'Ask for new documents'}
      description={decision === 'APPROVE' ? 'Confirm you have checked every document. Their payouts can then be marked Paid.' : 'The Executive will see your reason and upload replacements.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={decision === 'APPROVE' ? 'teal' : 'danger'} loading={m.isPending} onClick={() => m.mutate()}>
            {decision === 'APPROVE' ? 'Approve KYC' : 'Send back'}
          </Button>
        </>
      }
    >
      <Field label={decision === 'APPROVE' ? 'Note (optional)' : 'What needs fixing?'} required={decision === 'REJECT'} error={error} htmlFor="kr">
        <Textarea id="kr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={decision === 'REJECT' ? 'e.g. Photo is blurred; cheque name does not match PAN' : ''} />
      </Field>
    </Modal>
  );
}
