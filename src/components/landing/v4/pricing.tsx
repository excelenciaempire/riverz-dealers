'use client';

import { useState } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
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
          <div className="sn-card mx-auto max-w-5xl p-3 sm:p-4">
            <div className="px-2 pt-4 pb-3 sm:px-4 sm:pt-5 sm:pb-4">
              <div className="mb-4 flex items-end justify-between gap-4">
                <p className="sn-label">{t('landingV4.pricingVolumeLabel')}</p>
                <p
                  className="hidden text-sm text-[var(--sn-ink-2)] sm:block"
                  aria-live="polite"
                >
                  {customerLabel}
                </p>
              </div>

              <div
                className="sn-pricing-tiers grid grid-cols-5 gap-1.5"
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
                      className="sn-pricing-tier"
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
              <p className="mt-3 text-center text-xs text-[var(--sn-ink-2)] sm:hidden">
                {customerLabel}
              </p>
            </div>

            <div className="grid overflow-hidden rounded-[22px] lg:grid-cols-[1.18fr_0.82fr]">
              <div className="sn-pricing-plan relative flex min-h-[430px] flex-col p-6 sm:p-9 lg:p-11">
                {tier.monthly === null ? (
                  <>
                    <p className="sn-label relative z-10 text-[var(--sn-card)]/70!">
                      {customerLabel}
                    </p>
                    <p className="sn-pricing-amount relative z-10 mt-8 font-[family-name:var(--font-editorial)] leading-none tracking-[-0.04em] text-[var(--sn-card)]">
                      {t('landingV4.pricingCustomPrice')}
                    </p>
                    <p className="relative z-10 mt-5 max-w-sm text-sm leading-6 text-[var(--sn-card)]/72">
                      {t('landingV4.pricingCustomSetupTerms')}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="relative z-10 flex flex-wrap gap-2">
                      <span className="sn-pricing-badge">
                        {t('landingV4.pricingOfferBadge', {
                          percent: FIRST_MONTH_DISCOUNT_PERCENT,
                        })}
                      </span>
                      <span className="sn-pricing-badge sn-pricing-badge-muted">
                        {t('landingV4.pricingFreeSetup')}
                      </span>
                    </div>

                    <div className="relative z-10 mt-8">
                      <p className="sn-label text-[var(--sn-card)]/70!">
                        {t('landingV4.pricingFirstMonth')}
                      </p>
                      <p className="sn-pricing-amount mt-2 font-[family-name:var(--font-editorial)] leading-none tracking-[-0.05em] text-[var(--sn-card)]">
                        {fmt.money(
                          firstMonthCents(tier.monthly * 100) / 100,
                          'USD'
                        )}
                      </p>
                    </div>

                    <div className="relative z-10 mt-6 border-t border-white/15 pt-5 text-[var(--sn-card)]">
                      <p className="text-sm text-[var(--sn-card)]/65">
                        {t('landingV4.pricingFromSecondMonth')}
                      </p>
                      <p className="mt-1 flex items-baseline gap-2">
                        <span className="font-[family-name:var(--font-editorial)] text-3xl tracking-[-0.03em]">
                          {fmt.money(tier.monthly, 'USD')}
                        </span>
                        <span className="text-sm text-[var(--sn-card)]/65">
                          {t('landingV4.pricingPerMonth')}
                        </span>
                      </p>
                    </div>
                  </>
                )}

                <div className="relative z-10 mt-auto pt-8">
                  {tier.monthly !== null && (
                    <p className="mb-5 flex items-start gap-2.5 text-sm leading-5 text-[var(--sn-card)]/72">
                      <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>{t('landingV4.pricingSetupTerms')}</span>
                    </p>
                  )}
                  <a href="#acceso" className="sn-pricing-cta group">
                    <span>{t('landingV4.pricingCta')}</span>
                    <ArrowUpRight
                      className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                      aria-hidden
                    />
                  </a>
                </div>
              </div>

              <div className="bg-[var(--sn-sand)] p-6 sm:p-9 lg:p-11">
                <p className="sn-label">
                  {t('landingV4.pricingEverythingIncluded')}
                </p>
                <ul className="mt-6 divide-y divide-[var(--sn-line)]">
                  {INCLUDED.map((key) => (
                    <li
                      key={key}
                      className="flex items-start gap-3 py-3.5 text-[15px] leading-5 first:pt-0"
                    >
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--sn-accent)]">
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
