'use client';

import { useEffect, useState } from 'react';
import { useFormat } from '@/hooks/use-format';
import { useT } from '@/hooks/use-locale';

type Variant = {
  sent: number;
  responses: number;
  response_rate: number | null;
  orders: number;
  revenue: number;
};

export function AbTestResults({
  automationId,
  stepId,
}: {
  automationId: string;
  stepId: string;
}) {
  const t = useT();
  const fmt = useFormat();
  const [variants, setVariants] = useState<{ a: Variant; b: Variant } | null>(
    null
  );
  useEffect(() => {
    void fetch(`/api/automations/${automationId}/ab-tests/${stepId}`, {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data?.variants && setVariants(data.variants))
      .catch(() => undefined);
  }, [automationId, stepId]);
  if (!variants) return null;
  const columns = ['grid-cols-6', 'gap-1'];
  return (
    <div className="border-border mt-3 overflow-hidden rounded-md border text-xs">
      <div
        className={`${columns.join(' ')} bg-muted/40 text-muted-foreground px-2 py-1.5 font-medium`}
      >
        <span>{t('automations.abResults')}</span>
        <span>{t('automations.abSent')}</span>
        <span>{t('automations.abReplies')}</span>
        <span>{t('automations.abRate')}</span>
        <span>{t('automations.abOrders')}</span>
        <span>{t('automations.abRevenue')}</span>
      </div>
      {(['a', 'b'] as const).map((id) => {
        const v = variants[id];
        return (
          <div
            key={id}
            className={`${columns.join(' ')} border-border text-foreground border-t px-2 py-1.5`}
          >
            <span>{id.toUpperCase()}</span>
            <span>{fmt.number(v.sent)}</span>
            <span>{fmt.number(v.responses)}</span>
            <span>
              {v.response_rate === null
                ? '—'
                : `${Math.round(v.response_rate * 100)}%`}
            </span>
            <span>{fmt.number(v.orders)}</span>
            <span>{fmt.number(v.revenue)}</span>
          </div>
        );
      })}
    </div>
  );
}
