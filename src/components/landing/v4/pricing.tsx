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
import type { PublicPricing } from './pricing-tiers';

const INCLUDED = [
  'pricingIncludedAgents',
  'pricingIncludedSales',
  'pricingIncludedChannels',
  'pricingIncludedOperator',
  'pricingIncludedIntegrations',
  'pricingIncludedResults',
] as const;

// Con saldo, el consumo de IA se paga aparte: los agentes siguen incluidos.
const BALANCE_INCLUDED = ['pricingBalanceAgents', ...INCLUDED.slice(1)] as const;

const CONTACT_PRICE_FORMAT: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

// La cifra con su separador de miles: 500, 2000, 10.000, 10,000.
const VOLUME_COUNT = /\d(?:[\d.,]*\d)?/;

/** Resalta la cifra del cupo, o el fragmento que se indique. */
function VolumeLabel({
  text,
  mark = VOLUME_COUNT.exec(text)?.[0],
}: {
  text: string;
  mark?: string;
}) {
  const index = mark ? text.indexOf(mark) : -1;
  if (!mark || index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark className="sn-mark">{mark}</mark>
      {text.slice(index + mark.length)}
    </>
  );
}

/** Abre en el plan con saldo; doble clic en el título alterna con los planes por contactos. */
export function Pricing({ tiers, balanceMonthly }: PublicPricing) {
  const t = useT();
  const [contactPlans, setContactPlans] = useState(false);

  return (
    <section
      id="precios"
      className="sn-pricing-shell sn-full scroll-mt-24 px-5 py-16 lg:py-24"
    >
      <div className="mx-auto max-w-6xl">
        <Rise>
          <h2 className="sn-display mx-auto max-w-[14ch] text-center">
            <button
              type="button"
              onDoubleClick={() => setContactPlans((on) => !on)}
              aria-pressed={contactPlans}
              className="sn-pricing-switch"
            >
              {t('landingV4.pricingTitle')}
            </button>
          </h2>
        </Rise>

        <Rise delay={90} className="mt-10 lg:mt-14">
          <PricingCard
            tiers={tiers}
            balanceMonthly={balanceMonthly}
            balancePlan={!contactPlans}
          />
        </Rise>
      </div>
    </section>
  );
}

export function PricingCard({
  tiers,
  balanceMonthly,
  balancePlan,
}: PublicPricing & { balancePlan: boolean }) {
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
  const unlimited = t('landingV4.pricingBalanceUnlimited');

  return (
    <div className="sn-card sn-pricing-card mx-auto max-w-5xl p-3 sm:p-4">
      <div className="px-3 pt-8 pb-7 sm:px-7 sm:pt-9 sm:pb-8">
        {!balancePlan && (
          <>
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
          </>
        )}
        <p
          className={`sn-h3 text-center ${balancePlan ? '' : 'mt-7'}`}
          aria-live="polite"
        >
          {balancePlan ? (
            <VolumeLabel
              text={t('landingV4.pricingBalanceContacts', { unlimited })}
              mark={unlimited}
            />
          ) : (
            <VolumeLabel text={customerLabel} />
          )}
        </p>
      </div>

      <div className="grid overflow-hidden rounded-[22px] lg:grid-cols-[1.18fr_0.82fr]">
        <div className="flex min-w-0 flex-col justify-center bg-[var(--sn-sand)] p-6 sm:p-9 lg:p-11">
          {balancePlan ? (
            <>
              <PlanPrice monthly={balanceMonthly} contacts={null} />
              <div className="mt-6 border-t border-[var(--sn-line)] pt-5">
                <p className="font-[family-name:var(--font-editorial)] text-3xl tracking-[-0.03em]">
                  {t('landingV4.pricingBalancePlus')}
                </p>
                <p className="mt-3 text-sm text-[var(--sn-ink-2)]">
                  {t('landingV4.pricingBalanceTerms')}
                </p>
              </div>
            </>
          ) : tier.monthly === null ? (
            <>
              <p className="sn-h2">{t('landingV4.pricingCustomPrice')}</p>
              <p className="mt-5 max-w-sm text-sm leading-6 text-[var(--sn-ink-2)]">
                {t('landingV4.pricingCustomSetupTerms')}
              </p>
            </>
          ) : (
            <>
              <PlanPrice monthly={tier.monthly} contacts={tier.customers} />
              <p className="mt-5 text-xs leading-5 text-[var(--sn-ink-2)]">
                {t('landingV4.pricingUpgradeTerms')}
              </p>
            </>
          )}
        </div>

        <div className="border-t border-[var(--sn-line)] p-6 sm:p-9 lg:border-t-0 lg:border-l lg:p-11">
          <p className="sn-label">
            {t(
              balancePlan
                ? 'landingV4.pricingBalanceIncluded'
                : 'landingV4.pricingEverythingIncluded',
            )}
          </p>
          <ul className="mt-6 divide-y divide-[var(--sn-line)]">
            {(balancePlan ? BALANCE_INCLUDED : INCLUDED).map((key) => (
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

        </div>
      </div>
    </div>
  );
}

/** El primer mes con descuento y la mensualidad desde el segundo. */
function PlanPrice({
  monthly,
  contacts,
}: {
  monthly: number;
  contacts: number | null;
}) {
  const t = useT();
  const fmt = useFormat();
  const firstMonth = firstMonthCents(Math.round(monthly * 100)) / 100;
  // Sin cupo de contactos no hay precio por contacto que mostrar.
  const contactMath = (total: number) =>
    contacts !== null && (
      <p className="mt-3 text-sm tabular-nums text-[var(--sn-ink-2)]">
        {t('landingV4.pricingPerContactMath', {
          total: fmt.number(total),
          contacts: fmt.number(contacts),
          amount: fmt.number(total / contacts, CONTACT_PRICE_FORMAT),
        })}
      </p>
    );

  return (
    <>
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <p className="sn-label">{t('landingV4.pricingFirstMonth')}</p>
          <span className="sn-pricing-discount">
            {t('landingV4.pricingDiscountShort', {
              percent: FIRST_MONTH_DISCOUNT_PERCENT,
            })}
          </span>
        </div>
        <p className="sn-pricing-amount mt-2 font-[family-name:var(--font-editorial)] leading-none tracking-[-0.05em]">
          {fmt.money(firstMonth, 'USD')}
        </p>
        {contactMath(firstMonth)}
      </div>

      <div className="mt-6 border-t border-[var(--sn-line)] pt-5">
        <p className="text-sm text-[var(--sn-ink-2)]">
          {t('landingV4.pricingFromSecondMonth')}
        </p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="font-[family-name:var(--font-editorial)] text-3xl tracking-[-0.03em]">
            {fmt.money(monthly, 'USD')}
          </span>
          <span className="text-sm text-[var(--sn-ink-2)]">
            {t('landingV4.pricingPerMonth')}
          </span>
        </p>
        {contactMath(monthly)}
      </div>
    </>
  );
}
