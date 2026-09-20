'use client';
import { useEffect, useState } from 'react';
import type { Cortes } from './cortes';
export function useCortes(
  start: string | null,
  end: string | null,
  revision = 0
) {
  const key = start + '/' + end + '/' + revision;
  const [result, setResult] = useState<{
    key: string;
    data: Cortes | null;
  } | null>(null);
  useEffect(() => {
    if (!start || !end) return;
    const controller = new AbortController();
    void fetch('/api/analytics/cortes?' + new URLSearchParams({ start, end }), {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('cortes_unavailable');
        const data = (await res.json()) as Cortes;
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, data: null });
      });
    return () => controller.abort();
  }, [start, end, key]);
  return result?.key === key ? result.data : null;
}
