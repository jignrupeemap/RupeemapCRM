import { Clock3 } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { Card, EmptyState } from '@/components/ui';

export default function Page() {
  return (
    <div>
      <PageHeader title="Checklist" />
      <Card>
        <EmptyState icon={<Clock3 className="h-6 w-6" />} title="Arriving in Phase 8" body="Configurable document checklists by bank, loan type and project, with completion progress on each case." />
      </Card>
    </div>
  );
}
