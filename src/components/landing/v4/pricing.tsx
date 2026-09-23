'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { useFormat } from '@/hooks/use-format';
import { useT } from '@/hooks/use-locale';
import {
  FIRST_MONTH_DISCOUNT_PERCENT,
  firstMonthCents,
} from '@/lib/billing/first-month-offer';
import { Rise } from './bits';
import type { PricingTier } from './pricing-tiers';

const INCLUDED = [
  'pricingIncludedAgents',
  'pricingIncludedSales',
  'pricingIncludedChannels',
  'pricingIncludedOperator',
  'pricingIncludedIntegrations',
  'pricingIncludedResults',
] as const;

export function Pricing({ tiers }: { tiers: PricingTier[] }) {
  const t = useT();
  const fmt = useFormat();
  const [tierIndex, setTierIndex] = useState(0);
  const tier = tiers[tierIndex];
  const progress =
    tiers.length > 1 ? (tierIndex / (tiers.length - 1)) * 100 : 0;
  const customerLabel =
    tier.customers === null
      ? t('landingV4.pricingCustomVolume')
      : t('landingV4.pricingUpToCustomers', {
          count: fmt.number(tier.customers),
        });

  return (
    <section
      id="precios"
      className="sn-pricing-shell sn-full scroll-mt-24 px-5 py-16 lg:py-24"
    >
      <div className="mx-auto max-w-6xl">
        <Rise>
          <h2 className="sn-display mx-auto max-w-[14ch] text-center">
            {t('landingV4.pricingTitleLead')}{' '}
            <span style={{ color: 'var(--sn-ink-2)' }}>
              {t('landingV4.pricingTitleMuted')}
            </span>
          </h2>
        </Rise>

        <Rise delay={90} className="mt-10 lg:mt-14">
          <div className="sn-card sn-pricing-card mx-auto max-w-5xl p-3 sm:p-4">
            <div className="px-3 pt-8 pb-7 sm:px-7 sm:pt-9 sm:pb-8">
              <input
                type="range"
                min={0}
                max={tiers.length - 1}
                step={1}
                value={tierIndex}
                onChange={(event) => setTierIndex(Number(event.target.value))}
                aria-label={t('landingV4.pricingVolumeLabel')}
                aria-valuetext={customerLabel}
                className="sn-pricing-range"
                style={{
                  background: `linear-gradient(to right, var(--sn-ink) ${progress}%, var(--sn-line) ${progress}%)`,
                }}
              />

              <div
                className="sn-pricing-tiers mt-5 grid grid-cols-5"
                aria-label={t('landingV4.pricingVolumeLabel')}
              >
                {tiers.map((option, index) => {
                  const label =
                    option.customers === null
                      ? t('landingV4.pricingTierMore')
                      : option.customers < 1_000
                        ? fmt.number(option.customers)
                        : `${fmt.number(option.customers / 1_000)}k`;
                  const selected = index === tierIndex;

                  return (
                    <button
                      key={option.customers ?? 'custom'}
                      type="button"
                      onClick={() => setTierIndex(index)}
                      aria-pressed={selected}
                      className={`sn-label min-h-11 px-1 normal-case! ${selected ? 'underline underline-offset-8' : ''}`}
                      aria-label={
                        option.customers === null
                          ? t('landingV4.pricingCustomVolume')
                          : t('landingV4.pricingUpToCustomers', {
                              count: fmt.number(option.customers),
                            })
                      }
                    >
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="sn-label mt-7 text-center" aria-live="polite">
                {customerLabel}
              </p>
            </div>

            <div className="grid overflow-hidden rounded-[22px] lg:grid-cols-[1.18fr_0.82fr]">
              <div className="flex min-w-0 flex-col justify-center bg-[var(--sn-sand)] p-6 sm:p-9 lg:p-11">
                {tier.monthly === null ? (
                  <>
                    <p className="sn-label">{customerLabel}</p>
                    <p className="sn-h2 mt-8">
                      {t('landingV4.pricingCustomPrice')}
                    </p>
                    <p className="mt-5 max-w-sm text-sm leading-6 text-[var(--sn-ink-2)]">
                      {t('landingV4.pricingCustomSetupTerms')}
                    </p>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="mb-4 flex flex-wrap items-center gap-3">
                        <p className="sn-label">
                          {t('landingV4.pricingFirstMonth')}
                        </p>
                        <span className="sn-pricing-discount">
                          {t('landingV4.pricingDiscountShort', {
                            percent: FIRST_MONTH_DISCOUNT_PERCENT,
                          })}
                        </span>
                      </div>
                      <p className="sn-pricing-amount mt-2 font-[family-name:var(--font-editorial)] leading-none tracking-[-0.05em]">
                        {fmt.money(
                          firstMonthCents(tier.monthly * 100) / 100,
                          'USD'
                        )}
                      </p>
                    </div>

                    <div className="mt-6 border-t border-[var(--sn-line)] pt-5">
                      <p className="text-sm text-[var(--sn-ink-2)]">
                        {t('landingV4.pricingFromSecondMonth')}
                      </p>
                      <p className="mt-1 flex items-baseline gap-2">
                        <span className="font-[family-name:var(--font-editorial)] text-3xl tracking-[-0.03em]">
                          {fmt.money(tier.monthly, 'USD')}
                        </span>
                        <span className="text-sm text-[var(--sn-ink-2)]">
                          {t('landingV4.pricingPerMonth')}
                        </span>
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-[var(--sn-line)] p-6 sm:p-9 lg:border-t-0 lg:border-l lg:p-11">
                <p className="sn-label">
                  {t('landingV4.pricingEverythingIncluded')}
                </p>
                <ul className="mt-6 divide-y divide-[var(--sn-line)]">
                  {INCLUDED.map((key) => (
                    <li
                      key={key}
                      className="flex items-start gap-3 py-3.5 text-[15px] leading-5 first:pt-0"
                    >
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--sn-sand)]">
                        <Check
                          className="size-3"
                          strokeWidth={2.5}
                          aria-hidden
                        />
                      </span>
                      <span>{t(`landingV4.${key}`)}</span>
                    </li>
                  ))}
                </ul>

                <details className="sn-pricing-details mt-5 border-t border-[var(--sn-line)] pt-5">
                  <summary>{t('landingV4.pricingDetailsSummary')}</summary>
                  <p className="mt-3 text-xs leading-5 text-[var(--sn-ink-2)]">
                    {t('landingV4.pricingDetailsNote')}
                  </p>
                </details>
              </div>
            </div>
          </div>
        </Rise>
      </div>
    </section>
  );
}
