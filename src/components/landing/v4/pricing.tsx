'use client';

import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { useFormat } from '@/hooks/use-format';
import { useT } from '@/hooks/use-locale';
import { Rise } from './bits';

const TIERS = [
  { customers: 500, monthly: 399 },
  { customers: 2_000, monthly: 999 },
  { customers: 5_000, monthly: 1999 },
  { customers: 10_000, monthly: 3499 },
  { customers: null, monthly: null },
] as const;

const INCLUDED = [
  'pricingIncludedAgents',
  'pricingIncludedSales',
  'pricingIncludedChannels',
  'pricingIncludedOperator',
  'pricingIncludedIntegrations',
  'pricingIncludedResults',
] as const;

export function Pricing() {
  const t = useT();
  const fmt = useFormat();
  const [tierIndex, setTierIndex] = useState(1);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const tier = TIERS[tierIndex];
  const progress = (tierIndex / (TIERS.length - 1)) * 100;
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
      <div className="mx-auto max-w-6xl text-center">
        <Rise>
          <h2 className="sn-display mx-auto max-w-[14ch]">
            {t('landingV4.pricingTitleLead')}{' '}
            <span style={{ color: 'var(--sn-ink-2)' }}>
              {t('landingV4.pricingTitleMuted')}
            </span>
          </h2>
        </Rise>

        <Rise delay={90} className="mt-10 lg:mt-14">
          <div className="sn-card mx-auto max-w-5xl px-5 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-12">
            <div className="mx-auto max-w-3xl">
              <input
                type="range"
                min={0}
                max={TIERS.length - 1}
                step={1}
                value={tierIndex}
                onChange={(event) => setTierIndex(Number(event.target.value))}
                aria-label={t('landingV4.pricingVolumeLabel')}
                aria-valuetext={customerLabel}
                className="sn-pricing-range"
                style={{
                  background: `linear-gradient(to right, var(--sn-ink) 0%, var(--sn-ink) ${progress}%, var(--sn-line) ${progress}%, var(--sn-line) 100%)`,
                }}
              />

              <div className="sn-pricing-tiers mt-3 grid grid-cols-5">
                {TIERS.map((option, index) => {
                  const label = option.customers === null
                    ? t('landingV4.pricingTierMore')
                    : option.customers < 1_000
                      ? fmt.number(option.customers)
                      : `${fmt.number(option.customers / 1_000)}k`;
                  return (
                    <button
                      key={option.customers ?? 'custom'}
                      type="button"
                      onClick={() => setTierIndex(index)}
                      aria-pressed={index === tierIndex}
                      className={`sn-label min-h-8 px-1 ${
                        index === tierIndex ? 'underline underline-offset-4' : ''
                      }`}
                      style={{ textTransform: 'none' }}
                      aria-label={
                        option.customers === null
                          ? t('landingV4.pricingCustomVolume')
                          : t('landingV4.pricingUpToCustomers', {
                              count: fmt.number(option.customers),
                            })
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="sn-label mt-8">{customerLabel}</p>

            {tier.monthly === null ? (
              <p className="sn-h2 mt-3">{t('landingV4.pricingCustomPrice')}</p>
            ) : (
              <div className="mt-2 flex flex-col items-center justify-center sm:flex-row sm:items-end sm:gap-x-2">
                <span className="sn-pricing-amount font-[family-name:var(--font-editorial)] leading-none tracking-[-0.04em]">
                  {fmt.money(tier.monthly, 'USD')}
                </span>
                <span className="mt-1 text-[15px] text-[var(--sn-ink-2)] sm:mb-2 sm:mt-0">
                  {t('landingV4.pricingPerMonth')}
                </span>
              </div>
            )}

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <a href="#acceso" className="sn-pill group">
                {t('landingV4.pricingCta')}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </a>
              <button
                type="button"
                onClick={() => setDetailsOpen((open) => !open)}
                aria-expanded={detailsOpen}
                aria-controls="pricing-details"
                className="inline-flex items-center justify-center rounded-full px-6 py-3.5 text-[15px] font-medium transition-colors"
                style={{ background: 'var(--sn-sand)', color: 'var(--sn-ink)' }}
              >
                {detailsOpen
                  ? t('landingV4.pricingHideDetails')
                  : t('landingV4.pricingShowDetails')}
              </button>
            </div>

            {detailsOpen && (
              <div
                id="pricing-details"
                className="mx-auto mt-8 max-w-3xl border-t pt-7 text-left"
                style={{ borderColor: 'var(--sn-line)' }}
              >
                <p className="sn-label text-center">
                  {t('landingV4.pricingEverythingIncluded')}
                </p>
                <ul className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                  {INCLUDED.map((key) => (
                    <li
                      key={key}
                      className="flex items-start gap-3 text-[15px] leading-6"
                    >
                      <Check className="mt-1 size-4 shrink-0" aria-hidden />
                      <span>{t(`landingV4.${key}`)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 text-center text-[13px] leading-5 text-[var(--sn-ink-2)]">
                  {t('landingV4.pricingDetailsNote')}
                </p>
              </div>
            )}
          </div>
        </Rise>
      </div>
    </section>
  );
}
