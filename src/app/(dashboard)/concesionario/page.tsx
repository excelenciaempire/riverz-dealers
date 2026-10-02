import { Suspense } from 'react';
import { DealerWorkspace } from '@/components/dealers/dealer-workspace';
export default function DealerPage() {
  return (
    <Suspense>
      <DealerWorkspace />
    </Suspense>
  );
}
