import { Suspense } from 'react';
import { DealerWorkspace } from '@/components/dealers/dealer-workspace';
export default function DealerDemoPage() {
  return (
    <main className="bg-background min-h-screen">
      <Suspense>
        <DealerWorkspace demo />
      </Suspense>
    </main>
  );
}
