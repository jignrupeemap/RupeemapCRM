'use client';
import { PageHeader } from '@/components/shell';
import { TicketsView } from '@/components/tickets';

export default function Page() {
  return (
    <div>
      <PageHeader title="Need Assistance" sub="Help with a specific case: documents, bank login, sanction or disbursement delays. Rupeemap assigns it to an executive and replies here." />
      <TicketsView kind="ASSISTANCE" />
    </div>
  );
}
