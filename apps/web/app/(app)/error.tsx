'use client';
import { ErrorState } from '@/components/ui';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return <ErrorState error={{ message: 'This page ran into a problem. Your data is safe.' }} onRetry={reset} />;
}
