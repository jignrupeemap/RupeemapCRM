'use client';
import { PageHeader } from '@/components/shell';
import { TicketsView } from '@/components/tickets';

export default function Page() {
  return (
    <div>
      <PageHeader title="Raise Query" sub="Ask Rupeemap about a case, payout, recovery, bank, project or the app. Every reply is kept here." />
      <TicketsView kind="QUERY" />
    </div>
  );
}
