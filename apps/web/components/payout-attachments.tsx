'use client';
/** Banker confirmation mails kept against a payout. Admin / Admin Executive only; only Admin can remove one. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { Button, EmptyState, ErrorState, Field, Input, Modal, Skeleton, Textarea } from './ui';

interface Attachment {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  note: string | null;
  uploadedByName: string;
  createdAt: string;
  url: string;
  canDelete: boolean;
}

export const BANKER_MAIL_ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp';

/** Uploads one banker confirmation file to a payout. */
export function uploadBankerMail(payoutId: string, file: File, note?: string) {
  return api.form(`/payouts/${payoutId}/attachments`, note ? { note } : {}, file);
}

/** File chooser used in "Mark Confirmed" and in the attachments window. */
export function BankerMailPicker({ file, onFile, required }: { file: File | null; onFile: (f: File | null) => void; required?: boolean }) {
  return (
    <Field
      label="Banker confirmation mail (PDF / JPG / PNG)"
      required={required}
      htmlFor="bm-file"
      hint="Attach the bank's mail confirming all pending documents are cleared. Kept with this payout for future reference."
    >
      <Input
        id="bm-file"
        type="file"
        accept={BANKER_MAIL_ACCEPT}
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className="h-auto py-2 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-50 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-teal-800"
      />
      {file && (
        <p className="text-xs text-ink-600">
          {file.name} · {Math.ceil(file.size / 1024)} KB
        </p>
      )}
    </Field>
  );
}

export function PayoutAttachmentsModal({ payoutId, title, canAdd, onClose }: { payoutId: string; title: string; canAdd: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const key = ['payout-attachments', payoutId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Attachment[]>(`/payouts/${payoutId}/attachments`) });
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['payouts'] });
  };
  const add = useMutation({
    mutationFn: () => uploadBankerMail(payoutId, file!, note.trim() || undefined),
    onSuccess: () => {
      toast.success('Banker confirmation attached');
      setFile(null);
      setNote('');
      refresh();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.post(`/payouts/attachments/${removing!.id}/remove`, { reason }),
    onSuccess: () => {
      toast.success('Attachment removed (kept in the audit log)');
      setRemoving(null);
      setReason('');
      refresh();
    },
    onError: (e: ApiError) => toast.error(e.message),
  });

  return (
    <Modal open wide onOpenChange={(o) => !o && onClose()} title="Banker confirmations" description={title}>
      <div className="space-y-4">
        {q.isLoading ? (
          <Skeleton className="h-24" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState icon={<Paperclip className="h-6 w-6" />} title="No banker confirmation attached yet" body="Attach the bank's mail confirming document clearance." />
        ) : (
          <ul className="divide-y divide-ink-100 rounded-2xl ring-1 ring-ink-200/70">
            {q.data.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-3 py-3">
                <span className="mt-0.5 text-ink-400">{a.mime.startsWith('image/') ? <ImageIcon className="h-5 w-5" /> : <FileText className="h-5 w-5" />}</span>
                <div className="min-w-0 flex-1">
                  <a href={a.url} target="_blank" rel="noreferrer" className="block truncate font-semibold text-teal-800 hover:underline">
                    {a.name}
                  </a>
                  <p className="text-xs text-ink-500">
                    {Math.ceil(a.sizeBytes / 1024)} KB · added by {a.uploadedByName}, {fmtDateTime(a.createdAt)}
                  </p>
                  {a.note && <p className="mt-0.5 text-sm text-ink-700">{a.note}</p>}
                </div>
                {a.canDelete && (
                  <Button size="sm" variant="ghost" className="text-brand-red" icon={<Trash2 className="h-4 w-4" />} onClick={() => setRemoving(a)} aria-label={`Remove ${a.name}`}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {removing && (
          <div className="space-y-2 rounded-2xl bg-brand-redsoft p-4">
            <p className="text-sm font-semibold text-red-900">Remove “{removing.name}”? Only Admin can do this; it stays in the audit log.</p>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it being removed?" className="min-h-[64px] bg-white" aria-label="Reason" />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" loading={remove.isPending} disabled={reason.trim().length < 3} onClick={() => remove.mutate()}>
                Remove
              </Button>
            </div>
          </div>
        )}

        {canAdd && (
          <div className="space-y-3 rounded-2xl border border-ink-200/70 p-4">
            <BankerMailPicker file={file} onFile={setFile} />
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional), e.g. mail from HDFC RACPC, 3 Oct" maxLength={300} aria-label="Note" />
            <div className="flex justify-end">
              <Button size="sm" icon={<Upload className="h-4 w-4" />} loading={add.isPending} disabled={!file} onClick={() => add.mutate()}>
                Attach
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
