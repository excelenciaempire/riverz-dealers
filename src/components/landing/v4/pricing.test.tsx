import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { formatMoney, formatNumber } from '@/lib/i18n/format';
import { translate, type TVars } from '@/lib/i18n/translate';

const current = vi.hoisted(() => ({ locale: 'es' as 'es' | 'en' }));
vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({ locale: current.locale }),
  useT: () => (key: string, vars?: TVars) =>
    translate(current.locale, key, vars),
}));

import { Pricing, PricingCard } from './pricing';
import { Faq } from './faq';
import { PRICING_TIERS } from './pricing-tiers';

describe.each(['es', 'en'] as const)('pricing in %s', (locale) => {
  const t = (key: string, vars?: TVars) =>
    translate(locale, `landingV4.${key}`, vars);
  const money = (value: number) => formatMoney(value, locale, 'USD');
  it('renders only the FAQ answers for the selected pricing model', () => {
    current.locale = locale;
    for (const balancePlan of [true, false, true]) {
      const html = renderToStaticMarkup(<Faq balancePlan={balancePlan} />);
      expect(html).toContain(t('faqMetaChargesQuestion'));
      expect(html).toContain(t('faqMetaChargesAnswer'));
      expect(html).toContain(
        'https://whatsappbusiness.com/products/platform-pricing/'
      );
      if (balancePlan) {
        expect(html).toContain(t('faqBalanceBudgetQuestion'));
        expect(html).toContain(t('faqBalanceBudgetAnswer'));
      } else {
        expect(html).not.toContain(t('faqBalanceBudgetQuestion'));
        expect(html).not.toContain(t('faqBalanceBudgetAnswer'));
      }
      expect(html).toContain(
        t(balancePlan ? 'faqBalanceIncludedAnswer' : 'faqIncludedAnswer')
      );
      expect(html).not.toContain(
        t(balancePlan ? 'faqIncludedAnswer' : 'faqBalanceIncludedAnswer')
      );
      expect(html).toContain(
        t(balancePlan ? 'faqBalanceCountingQuestion' : 'faqCountingQuestion')
      );
      expect(html).not.toContain(
        t(balancePlan ? 'faqGrowthAnswer' : 'faqBalanceGrowthAnswer')
      );
      expect(html).not.toContain('landingV4.');
    }
    const page = renderToStaticMarkup(
      <Pricing tiers={PRICING_TIERS} balanceMonthly={399} withFaq />
    );
    expect(page).toContain(t('faqBalanceIncludedAnswer'));
  });
  const perContact = (value: number) =>
    formatNumber(value, locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  it('opens on the balance plan, with the title as the switch', () => {
    current.locale = locale;
    const html = renderToStaticMarkup(
      <Pricing tiers={PRICING_TIERS} balanceMonthly={399} />
    );

    expect(html).toMatch(
      new RegExp(
        `<h2[^>]*><button[^>]*aria-pressed="false"[^>]*>${t('pricingTitle')}</button></h2>`
      )
    );
    expect(html).not.toContain('type="range"');
    expect(html).toContain(t('pricingBalancePlus'));
  });

  it('shows the contact plans with a per-contact price', () => {
    current.locale = locale;
    const html = renderToStaticMarkup(
      <PricingCard
        tiers={PRICING_TIERS}
        balanceMonthly={399}
        balancePlan={false}
      />
    );

    expect(html).toContain('type="range"');
    expect(html).toContain(money(259));
    expect(html).toContain(money(399));
    expect(html).toContain(
      t('pricingPerContactMath', {
        total: '259',
        contacts: '500',
        amount: perContact(0.518),
      })
    );
    expect(html).toContain(t('pricingEverythingIncluded'));
    expect(html).toContain(t('pricingIncludedAgents'));
    expect(html).not.toContain(t('pricingBalancePlus'));
  });

  it('shows a single plan plus the balance the customer tops up', () => {
    current.locale = locale;
    const html = renderToStaticMarkup(
      <PricingCard tiers={PRICING_TIERS} balanceMonthly={399} balancePlan />
    );

    expect(html).not.toContain('type="range"');
    expect(html).toContain(
      `<mark class="sn-mark">${t('pricingBalanceUnlimited')}</mark>`
    );
    expect(html).toContain(money(259));
    expect(html).toContain(money(399));
    expect(html).not.toContain('÷');
    expect(html).toContain(t('pricingBalancePlus'));
    expect(html).toContain(t('pricingBalanceTerms'));
    expect(html).toContain(t('pricingBalanceIncluded'));
    expect(html).toContain(t('pricingBalanceAgents'));
    expect(html).not.toContain(t('pricingIncludedAgents'));
    expect(html).not.toContain(t('pricingUpgradeTerms'));
    expect(html).not.toContain('landingV4.');
    expect(html).not.toContain('�');
  });
});

it('prices the balance plan from the plan Checkout charges', () => {
  current.locale = 'en';
  const html = renderToStaticMarkup(
    <PricingCard tiers={PRICING_TIERS} balanceMonthly={449} balancePlan />
  );

  expect(html).toContain('$291');
  expect(html).toContain('$449');
});
