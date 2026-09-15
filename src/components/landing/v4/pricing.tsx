'use client';

import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { useFormat } from '@/hooks/use-format';
import { useT } from '@/hooks/use-locale';
import { Label, Rise } from './bits';

const TIERS = [
  { customers: 500, monthly: 399, sixMonths: 1995 },
  { customers: 2_000, monthly: 999, sixMonths: 4995 },
  { customers: 5_000, monthly: 1999, sixMonths: 9995 },
  { customers: 10_000, monthly: 3499, sixMonths: 17_495 },
  { customers: null, monthly: null, sixMonths: null },
] as const;

const INCLUDED = [
  'pricingIncludedAgents',
  'pricingIncludedSales',
  'pricingIncludedChannels',
  'pricingIncludedOperator',
  'pricingIncludedIntegrations',
  'pricingIncludedResults',
] as const;

type Term = 3 | 6;

export function Pricing() {
  const t = useT();
  const fmt = useFormat();
  const [tierIndex, setTierIndex] = useState(1);
  const [term, setTerm] = useState<Term>(6);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const tier = TIERS[tierIndex];
  const progress = (tierIndex / (TIERS.length - 1)) * 100;
  const total =
    tier.monthly === null
      ? null
      : term === 6
        ? tier.sixMonths
        : tier.monthly * term;
  const monthlyEquivalent = total === null ? null : Math.round(total / term);
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
          <Label>{t('landingV4.pricingLabel')}</Label>
          <h2 className="sn-display mx-auto mt-5 max-w-[14ch]">
            {t('landingV4.pricingTitleLead')}{' '}
            <span style={{ color: 'var(--sn-muted)' }}>
              {t('landingV4.pricingTitleMuted')}
            </span>
          </h2>
        </Rise>

        <Rise delay={90} className="mt-10 lg:mt-14">
          <div className="sn-card mx-auto max-w-5xl px-5 py-8 sm:px-10 sm:py-10 lg:px-14 lg:py-12">
            <div
              aria-hidden
              className="mx-auto flex size-16 items-center justify-center rounded-2xl text-[28px] font-semibold tracking-[-0.08em] sm:size-20 sm:text-[34px]"
              style={{ background: 'var(--sn-accent)', color: 'var(--sn-ink)' }}
            >
              r.
            </div>

            <div className="mx-auto mt-8 max-w-3xl sm:mt-10">
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

              <div className="mt-3 grid grid-cols-5">
                {TIERS.map((option, index) => {
                  const label =
                    option.customers === null
                      ? t('landingV4.pricingTierMore')
                      : fmt.number(option.customers, { notation: 'compact' });
                  return (
                    <button
                      key={option.customers ?? 'custom'}
                      type="button"
                      onClick={() => setTierIndex(index)}
                      className={`sn-label min-h-8 px-1 transition-opacity ${
                        index === tierIndex
                          ? 'opacity-100'
                          : 'opacity-45 hover:opacity-75'
                      }`}
                      style={
                        index === tierIndex
                          ? { color: 'var(--sn-ink)' }
                          : undefined
                      }
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

            <div
              className="mx-auto mt-7 inline-flex rounded-full p-1"
              role="group"
              aria-label={t('landingV4.pricingTermLabel')}
              style={{ background: 'var(--sn-sand)' }}
            >
              {([6, 3] as const).map((months) => (
                <button
                  key={months}
                  type="button"
                  onClick={() => setTerm(months)}
                  aria-pressed={term === months}
                  className="rounded-full px-4 py-2 text-[13px] font-medium transition-colors sm:px-5"
                  style={
                    term === months
                      ? { background: 'var(--sn-ink)', color: 'var(--sn-card)' }
                      : { color: 'var(--sn-muted)' }
                  }
                >
                  {months === 6
                    ? t('landingV4.pricingSixMonths')
                    : t('landingV4.pricingThreeMonths')}
                </button>
              ))}
            </div>

            <p className="sn-label mt-8">{customerLabel}</p>

            {monthlyEquivalent === null || total === null ? (
              <p className="sn-h2 mt-3">{t('landingV4.pricingCustomPrice')}</p>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-end justify-center gap-x-2">
                  <span className="font-[family-name:var(--font-editorial)] text-[56px] leading-none tracking-[-0.04em] sm:text-[76px]">
                    {fmt.money(monthlyEquivalent, 'USD')}
                  </span>
                  <span className="mb-1.5 text-[15px] text-[var(--sn-muted)] sm:mb-2">
                    {t('landingV4.pricingPerMonth')}
                  </span>
                </div>
                <p className="mt-3 text-[14px] text-[var(--sn-muted)]">
                  {term === 6
                    ? t('landingV4.pricingBilledSix', {
                        total: fmt.money(total, 'USD'),
                      })
                    : t('landingV4.pricingBilledThree', {
                        total: fmt.money(total, 'USD'),
                      })}
                </p>
              </>
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
                <p className="mt-6 text-center text-[13px] leading-5 text-[var(--sn-muted)]">
                  {t('landingV4.pricingDetailsNote')}
                </p>
              </div>
            )}

            <p className="mt-8 text-[14px] text-[var(--sn-muted)]">
              {t('landingV4.pricingGrowthNote')}
            </p>
          </div>
        </Rise>
      </div>
    </section>
  );
}
