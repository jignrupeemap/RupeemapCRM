import { Clock3 } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { Card, EmptyState } from '@/components/ui';

export default function Page() {
  return (
    <div>
      <PageHeader title="Audit Log" />
      <Card>
        <EmptyState icon={<Clock3 className="h-6 w-6" />} title="Arriving in Phase 17" body="Organisation-wide, tamper-evident audit log with filters by user, action and date. Case-level audit is already on each case." />
      </Card>
    </div>
  );
}
