'use client';

import { useState } from 'react';
import { useFormat } from '@/hooks/use-format';
import { useT } from '@/hooks/use-locale';
import type { BilledActivity } from '@/lib/wallet/activity';
import type { PorConcepto } from '@/lib/wallet/movimientos';
import { WalletDisclosure } from './wallet-disclosure';

export function WalletUsageBreakdown({
  concepts,
  activity,
  currency,
  timezone,
  name,
  channelName,
  initialView = 'service',
}: {
  concepts: PorConcepto[];
  activity?: BilledActivity;
  currency: string;
  timezone: string;
  name: (concept: string) => string;
  channelName: (channel: string) => string;
  initialView?: 'service' | 'channel';
}) {
  const t = useT();
  const fmt = useFormat();
  const [view, setView] = useState<string>(initialView);
  const money = (cents: number) =>
    fmt.currency(cents / 100, currency.toUpperCase());
  const total = concepts.reduce((sum, item) => sum + item.centavos, 0);
  const channels =
    activity?.byChannel.filter((item) => item.channel !== 'unattributed') ?? [];
  const missing = activity?.unrecorded;
  return (
    <WalletDisclosure
      title={t('settings.walletUsageDetails')}
      value={money(total)}
    >
      <div className="p-5">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            {t('settings.walletBreakdownView')}
          </span>
          <select
            className="border-input bg-background rounded-lg border px-3 py-2"
            value={view}
            onChange={(e) => setView(e.target.value)}
          >
            <option value="service">{t('settings.walletViewService')}</option>
            <option value="channel" disabled={!activity}>{t('settings.walletViewChannel')}</option>
          </select>
        </label>
        {!concepts.length ? (
          <p className="text-muted-foreground mt-4 text-sm">
            {t('settings.walletNoSpend')}
          </p>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th scope="col" className="py-2 text-left">
                      {t(
                        view === 'service'
                          ? 'settings.walletViewService'
                          : 'settings.walletActivityChannel'
                      )}
                    </th>
                    <th scope="col" className="px-3 text-right">
                      {t('settings.walletActivityCharges')}
                    </th>
                    <th scope="col" className="text-right">
                      {t('settings.walletActivityCharged')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(view === 'service'
                    ? concepts.map((item) => ({
                        key: item.concepto,
                        label: name(item.concepto),
                        charges: item.movimientos,
                        cents: item.centavos,
                      }))
                    : channels.map((item) => ({
                        key: item.channel,
                        label: channelName(item.channel),
                        charges: item.charges,
                        cents: item.chargedCentavos,
                      }))
                  ).map((item) => (
                    <tr key={item.key} className="border-border border-t">
                      <td className="py-3">{item.label}</td>
                      <td className="px-3 text-right tabular-nums">
                        {fmt.number(item.charges)}
                      </td>
                      <td className="text-right whitespace-nowrap tabular-nums">
                        {money(item.cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {view === 'channel' && missing && (
              <div className="bg-muted/40 mt-4 rounded-lg p-4">
                <div className="flex flex-wrap justify-between gap-3 text-sm">
                  <h4 className="font-medium">
                    {t('settings.walletHistoricalIncomplete')}
                  </h4>
                  <span className="tabular-nums">
                    {money(missing.chargedCentavos)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('settings.walletHistoricalIncluded')}
                </p>
                <p className="text-muted-foreground mt-2 text-xs">
                  {t('settings.walletChargedOperations', {
                    count: missing.charges,
                  })}{' '}
                  ·{' '}
                  {fmt.date(missing.firstAt, {
                    timeZone: timezone,
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}{' '}
                  –{' '}
                  {fmt.date(missing.lastAt, {
                    timeZone: timezone,
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
            )}
            <div className="border-border mt-4 flex justify-between border-t pt-3 text-sm font-semibold">
              <span>{t('settings.walletPeriodTotal')}</span>
              <span className="tabular-nums">{money(total)}</span>
            </div>
          </>
        )}
      </div>
    </WalletDisclosure>
  );
}
