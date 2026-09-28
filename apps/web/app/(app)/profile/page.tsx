'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ROLE_LABELS } from '@rupeemap/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, initials } from '@/lib/format';
import { useMe } from '@/lib/session';
import { PageHeader } from '@/components/shell';
import { Badge, Button, Card, DetailGrid, Field, Input } from '@/components/ui';

const KYC: Record<string, string> = { DOCUMENTS_PENDING: 'Documents pending', UPLOADED: 'Uploaded', UNDER_ADMIN_VERIFICATION: 'Under Admin verification', APPROVED: 'Approved', REJECTED: 'Rejected', RESUBMISSION_REQUIRED: 'Resubmission required' };

export default function ProfilePage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const change = useMutation({
    mutationFn: () => {
      if (pw !== pw2) throw new ApiError('VALIDATION_ERROR', 'Passwords do not match', 400, { fields: { pw2: 'Does not match' } });
      return api.post('/auth/password/change', { currentPassword: cur, newPassword: pw });
    },
    onSuccess: () => { toast.success('Password changed. Other devices were signed out.'); setCur(''); setPw(''); setPw2(''); setErrors({}); },
    onError: (e: ApiError) => { setErrors({ ...e.fields, ...(e.fields.newPassword ? { pw: e.fields.newPassword } : {}), ...(e.fields.password ? { pw: e.fields.password } : {}) }); toast.error(e.message); },
  });
  if (!me) return null;
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Profile" />
      <Card className="p-5">
        <div className="mb-5 flex items-center gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ink font-display text-lg font-bold text-white">{initials(me.name)}</span>
          <div>
            <p className="font-display text-xl font-bold">{me.name}</p>
            <p className="text-sm text-ink-500">{ROLE_LABELS[me.role]}{me.dsaCode ? ` · ${me.dsaCode}` : ''}</p>
          </div>
          <Badge tone="teal">{me.status === 'ACTIVE' ? 'Active' : me.status}</Badge>
        </div>
        <DetailGrid items={[
          ['Mobile', `+91 ${me.mobile}`],
          ['Email', me.email ?? '—'],
          ['Role', ROLE_LABELS[me.role]],
          ...(me.dsa ? [['DSA', `${me.dsa.name}`] as [string, string]] : []),
          ...(me.kycStatus ? [['First payout KYC', KYC[me.kycStatus] ?? me.kycStatus] as [string, string]] : []),
          ['Last sign-in', fmtDateTime(me.lastLoginAt)],
        ]} />
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 font-display font-bold">Change password</h2>
        <form className="grid gap-4 sm:max-w-sm" onSubmit={(e) => (e.preventDefault(), change.mutate())}>
          <Field label="Current password" htmlFor="c1" error={errors.currentPassword}><Input id="c1" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></Field>
          <Field label="New password" htmlFor="c2" error={errors.pw} hint="At least 8 characters with a letter and a number"><Input id="c2" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Confirm new password" htmlFor="c3" error={errors.pw2}><Input id="c3" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <Button loading={change.isPending} disabled={!cur || !pw}>Change password</Button>
        </form>
      </Card>
      <Button variant="secondary" className="w-full text-brand-red sm:w-auto" icon={<LogOut className="h-4 w-4" />} onClick={async () => { await api.post('/auth/logout').catch(() => undefined); qc.clear(); router.replace('/login'); }}>Log out</Button>
    </div>
  );
}
