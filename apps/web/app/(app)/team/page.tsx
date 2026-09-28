'use client';
import { PageHeader } from '@/components/shell';
import { PeopleList } from '@/components/people';

export default function TeamPage() {
  return (
    <div>
      <PageHeader title="Team Data" sub="Your Team Partners, their cases by stage and their payout percentage." />
      <PeopleList role="TEAM_PARTNER" title="Team Partner" />
    </div>
  );
}
