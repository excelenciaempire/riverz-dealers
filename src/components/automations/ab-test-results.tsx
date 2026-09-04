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
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void fetch(`/api/automations/${automationId}/ab-tests/${stepId}`, {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.variants) {
          setFailed(false);
          setVariants(data.variants);
        } else setFailed(true);
      })
      .catch(() => setFailed(true));
  }, [automationId, stepId]);
  if (!variants) {
    return (
      <div className="border-border text-muted-foreground mt-3 rounded-md border px-3 py-2 text-xs">
        {failed
          ? t('automations.abMetricsUnavailable')
          : t('automations.abMetricsLoading')}
      </div>
    );
  }
  return (
    <section className="border-border mt-3 rounded-md border p-3 text-xs">
      <h3 className="text-foreground mb-2 text-sm font-medium">
        {t('automations.abResults')}
      </h3>
      {(['a', 'b'] as const).map((id) => {
        const v = variants[id];
        return (
          <div
            key={id}
            className="border-border text-foreground flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t py-2 first:border-t-0 first:pt-0"
          >
            <strong>{id.toUpperCase()}</strong>
            <span>{`${t('automations.abSent')}: ${fmt.number(v.sent)}`}</span>
            <span>{`${t('automations.abReplies')}: ${fmt.number(v.responses)}`}</span>
            <span>{`${t('automations.abRate')}: ${v.response_rate === null ? '—' : `${Math.round(v.response_rate * 100)}%`}`}</span>
            <span>{`${t('automations.abOrders')}: ${fmt.number(v.orders)}`}</span>
            <span>{`${t('automations.abRevenue')}: ${fmt.number(v.revenue)}`}</span>
          </div>
        );
      })}
    </section>
  );
}
