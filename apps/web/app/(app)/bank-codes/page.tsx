import { Clock3 } from 'lucide-react';
import { PageHeader } from '@/components/shell';
import { Card, EmptyState } from '@/components/ui';

export default function Page() {
  return (
    <div>
      <PageHeader title="Bankwise Code" />
      <Card>
        <EmptyState icon={<Clock3 className="h-6 w-6" />} title="Arriving in Phase 12" body="Search bank codes by bank, product, city and branch, with effective and expiry dates." />
      </Card>
    </div>
  );
}
