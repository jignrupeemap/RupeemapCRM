import { Clock3 } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { Card, EmptyState } from '@/components/ui';

export default function Page() {
  return (
    <div>
      <PageHeader title="Raise Query" />
      <Card>
        <EmptyState icon={<Clock3 className="h-6 w-6" />} title="Arriving in Phase 13" body="Raise case, payout, recovery, bank, project or technical queries and follow replies from Rupeemap." />
      </Card>
    </div>
  );
}
