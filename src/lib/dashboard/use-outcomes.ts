'use client';

import { useEffect, useState } from 'react';
import type { OutcomeReport } from './outcomes';

export function useOutcomes(
  start: string | null,
  end: string | null,
  revision: number
) {
  const key = start && end ? `${start}/${end}/${revision}` : null;
  const [result, setResult] = useState<{
    key: string;
    data: OutcomeReport | null;
    error: boolean;
  } | null>(null);
  useEffect(() => {
    if (!start || !end || !key) return;
    const controller = new AbortController();
    void fetch(
      `/api/analytics/outcomes?${new URLSearchParams({ start, end })}`,
      { cache: 'no-store', signal: controller.signal }
    )
      .then(async (res) => {
        if (!res.ok) throw new Error('outcomes_unavailable');
        const data = (await res.json()) as OutcomeReport;
        if (!controller.signal.aborted) setResult({ key, data, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ key, data: null, error: true });
      });
    return () => controller.abort();
  }, [start, end, key]);
  return result?.key === key ? result : { data: null, error: false };
}
