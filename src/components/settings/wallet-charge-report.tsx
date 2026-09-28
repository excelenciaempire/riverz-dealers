'use client';

import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { movementContext, movementReason } from '@/lib/wallet/movement-context';
import type { ChargeExplanation } from '@/lib/wallet/explanation';
import type { ServiceActivity } from '@/lib/wallet/service-activity';

export function WalletChargeReport({
  explanation,
  activity,
  currency,
  timezone,
  name,
  channelName,
  onInspect,
}: {
  explanation: ChargeExplanation;
  activity?: ServiceActivity;
  currency: string;
  timezone: string;
  name: (concept: string) => string;
  channelName: (channel: string) => string;
  onInspect: (concept: string, channel: string, purpose: string) => void;
}) {
  const t = useT();
  const fmt = useFormat();
  const money = (cents: number) =>
    fmt.currency(cents / 100, currency.toUpperCase());
  const date = (at: string) =>
    fmt.dateTime(at, {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  const columns =
    'grid grid-cols-[minmax(12rem,2fr)_repeat(4,minmax(6rem,1fr))] items-center gap-3';
  const sentChannels = new Set(
    explanation.sources.map((s) => s.channel).filter(Boolean)
  );
  const unbilled =
    activity?.byChannel.filter((s) => !sentChannels.has(s.channel)) ?? [];
  return (
    <section className="border-border bg-card rounded-xl border p-5">
      <h3 className="text-sm font-semibold">
        {t('settings.walletChargeJustification')}
      </h3>
      <p className="text-muted-foreground mt-1 text-xs">
        {t('settings.walletChargeJustificationNote')}
      </p>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[720px]">
          <div className={`${columns} text-muted-foreground py-2 text-xs`}>
            <span>{t('settings.walletChannelOrService')}</span>
            <span className="text-right">{t('settings.walletServiceAi')}</span>
            <span className="text-right">
              {t('settings.walletServiceComments')}
            </span>
            <span className="text-right">
              {t('settings.walletActivityCharges')}
            </span>
            <span className="text-right">
              {t('settings.walletActivityCharged')}
            </span>
          </div>
          {explanation.sources.map((source) => {
            const delivered = source.channel
              ? activity?.byChannel.find((c) => c.channel === source.channel)
              : undefined;
            const label = source.channel
              ? channelName(source.channel)
              : name(source.services[0].concepto);
            return (
              <details
                key={source.channel ?? `service:${source.services[0].concepto}`}
                className="group border-border border-t"
              >
                <summary
                  className={`${columns} cursor-pointer list-none py-3 text-sm`}
                >
                  <span className="flex items-center gap-2">
                    <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
                    {label}
                  </span>
                  <span className="text-right tabular-nums">
                    {source.channel
                      ? fmt.number(delivered?.aiMessages ?? 0)
                      : '—'}
                  </span>
                  <span className="text-right tabular-nums">
                    {source.channel
                      ? fmt.number(delivered?.comments ?? 0)
                      : '—'}
                  </span>
                  <span className="text-right tabular-nums">
                    {fmt.number(source.charges)}
                  </span>
                  <span className="text-right tabular-nums">
                    {money(source.chargedCentavos)}
                  </span>
                </summary>
                <div className="bg-muted/30 mb-3 rounded-lg p-4">
                  {!source.channel && (
                    <p className="text-muted-foreground mb-3 text-xs">
                      {t('settings.walletServiceRecordedOnly')}
                    </p>
                  )}
                  {source.services.map((service) => (
                    <div
                      key={`${service.concepto}:${service.purpose}`}
                      className="border-border flex flex-wrap items-start justify-between gap-4 border-b py-3 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {name(service.concepto)}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {movementContext({ para: service.purpose }, t) ??
                            movementReason(service.concepto, t) ??
                            t('settings.walletRecordedServiceWork', {
                              service: name(service.concepto),
                            })}
                        </p>
                        <p className="text-muted-foreground mt-2 text-xs">
                          {t('settings.walletChargedOperations', {
                            count: service.charges,
                          })}
                          {service.tokens > 0 && (
                            <>
                              {' '}
                              ·{' '}
                              {t('settings.walletProcessedTokens', {
                                n: fmt.number(service.tokens),
                              })}
                            </>
                          )}
                          {service.seconds > 0 && (
                            <>
                              {' '}
                              ·{' '}
                              {t('settings.walletMeasuredSeconds', {
                                n: fmt.number(service.seconds),
                              })}
                            </>
                          )}
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {date(service.firstAt)}
                          {service.firstAt !== service.lastAt && (
                            <> – {date(service.lastAt)}</>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm tabular-nums">
                          {money(service.chargedCentavos)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            onInspect(
                              service.concepto,
                              source.channel ?? 'unattributed',
                              service.purpose ?? '__none__'
                            )
                          }
                        >
                          {t('settings.walletInspectCharges')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            );
          })}
          {unbilled.map((channel) => (
            <div
              key={channel.channel}
              className={`${columns} border-border border-t py-3 text-sm`}
            >
              <span>{channelName(channel.channel)}</span>
              <span className="text-right tabular-nums">
                {fmt.number(channel.aiMessages)}
              </span>
              <span className="text-right tabular-nums">
                {fmt.number(channel.comments)}
              </span>
              <span className="text-right tabular-nums">0</span>
              <span className="text-right tabular-nums">{money(0)}</span>
            </div>
          ))}
          <div
            className={`${columns} border-border border-t py-3 text-sm font-semibold`}
          >
            <span>{t('settings.walletActivityTotal')}</span>
            <span className="text-right tabular-nums">
              {fmt.number(activity?.aiMessages ?? 0)}
            </span>
            <span className="text-right tabular-nums">
              {fmt.number(activity?.comments ?? 0)}
            </span>
            <span className="text-right tabular-nums">
              {fmt.number(explanation.charges)}
            </span>
            <span className="text-right tabular-nums">
              {money(explanation.chargedCentavos)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
