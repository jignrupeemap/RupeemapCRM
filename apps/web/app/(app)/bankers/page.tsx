'use client';
import { useQuery } from '@tanstack/react-query';
import { Copy, Mail, Phone } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell';
import { Badge, Card, EmptyState, Select, Skeleton } from '@/components/ui';

interface Banker { id: string; name: string; mobile: string | null; email: string | null; branch: string | null; city: string | null; product: string | null; designation: { name: string } | null; bank: { name: string } }

export default function BankersPage() {
  const [bankId, setBankId] = useState('');
  const banks = useQuery({ queryKey: ['banks'], queryFn: () => api.get<{ id: string; name: string }[]>('/banks'), staleTime: 3600_000 });
  const q = useQuery({ queryKey: ['bankers', bankId], queryFn: () => api.get<Banker[]>('/bankers', { bankId }) });
  const copy = async (b: Banker) => {
    const text = `${b.name}${b.designation ? `, ${b.designation.name}` : ''}\n${b.bank.name}${b.branch ? `, ${b.branch}` : ''}\n${b.mobile ? `Mobile: ${b.mobile}\n` : ''}${b.email ? `Email: ${b.email}` : ''}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Contact card copied');
    } catch {
      toast.error('Could not copy on this device');
    }
  };
  return (
    <div>
      <PageHeader title="Banker Directory" sub="Sales managers and senior bankers by bank. WhatsApp and email sharing for executives arrives in Phase 12." />
      <Select value={bankId} onChange={(e) => setBankId(e.target.value)} className="mb-4 sm:max-w-xs" aria-label="Bank">
        <option value="">All banks</option>
        {banks.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </Select>
      {q.isLoading ? <Skeleton className="h-48 rounded-2xl" /> : !q.data?.length ? <Card><EmptyState title="No bankers listed for this bank" /></Card> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((b) => (
            <Card key={b.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-semibold">{b.name}</p><p className="text-sm text-ink-500">{b.bank.name}{b.branch ? ` · ${b.branch}` : ''}</p></div>
                {b.designation && <Badge tone="dark">{b.designation.name}</Badge>}
              </div>
              <div className="mt-3 space-y-1 text-sm">
                {b.mobile && <p className="flex items-center gap-2 tabular-nums"><Phone className="h-3.5 w-3.5 text-ink-400" />{b.mobile}</p>}
                {b.email && <p className="flex items-center gap-2 break-all"><Mail className="h-3.5 w-3.5 text-ink-400" />{b.email}</p>}
                {b.product && <p className="text-xs text-ink-500">{b.product}{b.city ? ` · ${b.city}` : ''}</p>}
              </div>
              <button onClick={() => copy(b)} className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-teal-700"><Copy className="h-3.5 w-3.5" /> Copy contact card</button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
