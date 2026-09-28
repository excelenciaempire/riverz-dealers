'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFormat } from '@/hooks/use-format';
import { useT } from '@/hooks/use-locale';
import type { TopupHistoryRow } from '@/lib/wallet/topup-history';

export function WalletTopupHistory({
  currency,
  timezone,
  revision,
}: {
  currency: string;
  timezone: string;
  revision: number;
}) {
  const t = useT();
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    filas: TopupHistoryRow[];
    hayMas: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setFailed(false);
      try {
        const response = await fetch(`/api/wallet/recargas?pagina=${page}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('history_unavailable');
        const data = await response.json();
        if (!controller.signal.aborted) setResult(data);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [page, retry, revision]);
  return (
    <section
      className="border-border bg-card rounded-xl border"
      aria-busy={loading}
    >
      <h3 className="border-border border-b px-5 py-4 text-sm font-semibold">
        {t('settings.walletTopupHistory')}
      </h3>
      {failed ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 p-5"
        >
          <p className="text-sm">{t('settings.walletTopupHistoryFailed')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRetry((v) => v + 1)}
          >
            {t('settings.walletRetry')}
          </Button>
        </div>
      ) : loading && !result ? (
        <div className="flex justify-center p-8">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : result?.filas.length === 0 ? (
        <p className="text-muted-foreground p-5 text-sm">
          {t('settings.walletNoTopups')}
        </p>
      ) : (
        <WalletTopupHistoryTable
          rows={result?.filas ?? []}
          currency={currency}
          timezone={timezone}
        />
      )}
      {(page > 0 || result?.hayMas) && (
        <footer className="border-border flex justify-between border-t px-5 py-3">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('settings.walletPrev')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={loading || failed || !result?.hayMas}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('settings.walletNext')}
          </Button>
        </footer>
      )}
    </section>
  );
}

export function WalletTopupHistoryTable({
  rows,
  currency,
  timezone,
}: {
  rows: TopupHistoryRow[];
  currency: string;
  timezone: string;
}) {
  const t = useT();
  const fmt = useFormat();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="px-5 py-3 text-left">
              {t('settings.walletTopupDate')}
            </th>
            <th scope="col" className="px-5 py-3 text-left">
              {t('settings.walletTopupOrigin')}
            </th>
            <th scope="col" className="px-5 py-3 text-right">
              {t('settings.walletTopupAmount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-border border-t">
              <td className="px-5 py-3 whitespace-nowrap tabular-nums">
                <time dateTime={row.creadoEn}>
                  {fmt.dateTime(row.creadoEn, {
                    timeZone: timezone,
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZoneName: 'shortOffset',
                  })}
                </time>
              </td>
              <td className="px-5 py-3">
                {t(`settings.walletTopupOrigin_${row.origen}`)}
              </td>
              <td className="px-5 py-3 text-right whitespace-nowrap tabular-nums">
                +{fmt.currency(row.centavos / 100, currency.toUpperCase())}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
