import { Clock3 } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { Card, EmptyState } from '@/components/ui';

export default function Page() {
  return (
    <div>
      <PageHeader title="Need Assistance" />
      <Card>
        <EmptyState icon={<Clock3 className="h-6 w-6" />} title="Arriving in Phase 13" body="Ask for help on a specific case. Executives assign, reply and resolve with full history." />
      </Card>
    </div>
  );
}
