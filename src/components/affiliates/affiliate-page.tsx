'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  PhoneCall,
  Repeat2,
  Send,
  WalletCards,
} from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { useLocale, useT } from '@/hooks/use-locale';
import { Label, LocaleSwitch, Rise } from '@/components/landing/v4/bits';
import '@/components/landing/v4/editorial.css';
import './affiliates.css';

export function AffiliatePage() {
  const t = useT();

  return (
    <div className="sn affiliate min-h-screen">
      <header className="px-3 pt-3">
        <nav className="aff-nav mx-auto flex max-w-6xl items-center justify-between gap-5 rounded-full px-5 py-3">
          <Link
            href="/"
            className="text-[19px] font-semibold tracking-[-0.02em] lowercase"
          >
            riverz
          </Link>
          <div className="flex items-center gap-4 sm:gap-6">
            <Link
              href="/"
              className="sn-label hidden hover:opacity-70 sm:block"
            >
              {t('affiliates.navHome')}
            </Link>
            <LocaleSwitch />
            <a href="#solicitud" className="sn-pill aff-nav-cta">
              {t('affiliates.navApply')}
            </a>
          </div>
        </nav>
      </header>

      <main>
        <section
          className="aff-hero mx-auto max-w-6xl px-5"
          aria-labelledby="affiliate-title"
        >
          <div className="aff-hero-copy">
            <Rise>
              <Label>{t('affiliates.eyebrow')}</Label>
              <h1 id="affiliate-title" className="sn-display mt-5">
                {t('affiliates.heroTitle')}{' '}
                <span>{t('affiliates.heroTitleAccent')}</span>
              </h1>
              <p className="sn-body mt-6 max-w-[48ch]">
                {t('affiliates.heroBody')}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a href="#solicitud" className="sn-pill group">
                  {t('affiliates.heroCta')}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a href="#como-funciona" className="sn-pill aff-pill-outline">
                  {t('affiliates.heroSecondary')}
                </a>
              </div>
            </Rise>
          </div>
          <div className="aff-hero-art">
            <Image
              src="/afiliados/hero.webp"
              alt=""
              fill
              priority
              sizes="(min-width: 900px) 58vw, 100vw"
              className="object-cover"
            />
            <div className="aff-rate-card">
              <span>{t('affiliates.recurringLabel')}</span>
              <strong>{t('affiliates.recurringValue')}</strong>
              <small>{t('affiliates.recurringNote')}</small>
            </div>
          </div>
        </section>

        <Calculator />

        <section
          id="como-funciona"
          className="mx-auto max-w-6xl scroll-mt-8 px-5 py-20 lg:py-28"
        >
          <Rise>
            <Label>{t('affiliates.howEyebrow')}</Label>
            <h2 className="sn-h2 mt-4 max-w-[18ch]">
              {t('affiliates.howTitle')}
            </h2>
          </Rise>
          <div className="aff-steps mt-12">
            {[
              [Send, 'affiliates.stepOneTitle', 'affiliates.stepOneBody'],
              [PhoneCall, 'affiliates.stepTwoTitle', 'affiliates.stepTwoBody'],
              [
                Repeat2,
                'affiliates.stepThreeTitle',
                'affiliates.stepThreeBody',
              ],
            ].map(([Icon, title, body], index) => {
              const StepIcon = Icon as typeof Send;
              return (
                <Rise key={String(title)} delay={index * 80}>
                  <article className="aff-step">
                    <div className="aff-step-icon">
                      <StepIcon className="size-5" />
                    </div>
                    <span className="sn-label">0{index + 1}</span>
                    <h3>{t(String(title))}</h3>
                    <p>{t(String(body))}</p>
                  </article>
                </Rise>
              );
            })}
          </div>
        </section>

        <section className="aff-clarity">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-20 lg:grid-cols-2 lg:py-24">
            <div>
              <h2 className="sn-h2 max-w-[15ch]">
                {t('affiliates.includedTitle')}
              </h2>
              <ul className="mt-8 space-y-4">
                {[
                  'includedOne',
                  'includedTwo',
                  'includedThree',
                  'includedFour',
                ].map((key) => (
                  <li key={key} className="flex items-start gap-3">
                    <span className="aff-check">
                      <Check className="size-4" />
                    </span>
                    <span>{t(`affiliates.${key}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="aff-rule-card">
              <WalletCards className="size-7" />
              <h3>{t('affiliates.clarityTitle')}</h3>
              <p>{t('affiliates.clarityBody')}</p>
            </div>
          </div>
        </section>

        <Application />

        <section className="mx-auto max-w-4xl px-5 py-20 lg:py-24">
          <h2 className="sn-h2 text-center">{t('affiliates.faqTitle')}</h2>
          <div className="aff-faq mt-10">
            {[1, 2, 3, 4].map((n) => (
              <details key={n}>
                <summary>
                  {t(
                    `affiliates.faq${['One', 'Two', 'Three', 'Four'][n - 1]}Q`
                  )}
                </summary>
                <p>
                  {t(
                    `affiliates.faq${['One', 'Two', 'Three', 'Four'][n - 1]}A`
                  )}
                </p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-5 pb-10">
        <div
          className="flex flex-col gap-4 border-t pt-7 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderColor: 'var(--sn-line)' }}
        >
          <span className="text-[17px] font-semibold lowercase">riverz</span>
          <div className="sn-label flex flex-wrap gap-6">
            <Link href="/terminos">{t('landing.footerTerms')}</Link>
            <Link href="/privacidad">{t('landing.footerPrivacy')}</Link>
            <span>© {new Date().getFullYear()} riverz</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Calculator() {
  const t = useT();
  const { locale } = useLocale();
  const [referrals, setReferrals] = useState(5);
  const [monthlyPlan, setMonthlyPlan] = useState(399);
  const monthly = referrals * monthlyPlan * 0.35;
  const money = useMemo(
    () =>
      new Intl.NumberFormat(locale === 'es' ? 'es-CO' : 'en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }),
    [locale]
  );

  return (
    <section className="mx-auto max-w-6xl px-5 py-16 lg:py-20">
      <div className="aff-calculator">
        <div>
          <Label>{t('affiliates.calculatorEyebrow')}</Label>
          <h2 className="sn-h2 mt-4 max-w-[14ch]">
            {t('affiliates.calculatorTitle')}
          </h2>
          <p className="sn-body mt-4 max-w-[40ch]">
            {t('affiliates.calculatorBody')}
          </p>
        </div>
        <div className="aff-calc-controls">
          <label>
            <span>{t('affiliates.calculatorReferrals')}</span>
            <strong>{referrals}</strong>
            <input
              type="range"
              min="1"
              max="30"
              value={referrals}
              onChange={(event) => setReferrals(Number(event.target.value))}
            />
          </label>
          <label>
            <span>{t('affiliates.calculatorPlan')}</span>
            <strong>{money.format(monthlyPlan)}</strong>
            <input
              type="range"
              min="49"
              max="999"
              step="25"
              value={monthlyPlan}
              onChange={(event) => setMonthlyPlan(Number(event.target.value))}
            />
          </label>
          <div className="aff-calc-result">
            <span>{t('affiliates.calculatorMonthly')}</span>
            <strong>{money.format(monthly)}</strong>
            <small>
              {t('affiliates.calculatorYearly')}: {money.format(monthly * 12)}
            </small>
          </div>
        </div>
      </div>
    </section>
  );
}

function Application() {
  const t = useT();
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('sending');
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch('/api/affiliates/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      setError(payload.error ?? t('affiliates.formError'));
      setState('idle');
      return;
    }
    setState('done');
  }

  return (
    <section
      id="solicitud"
      className="mx-auto max-w-6xl scroll-mt-8 px-5 py-20 lg:py-28"
    >
      <div className="aff-application">
        <div>
          <Label>{t('affiliates.applyEyebrow')}</Label>
          <h2 className="sn-h2 mt-4 max-w-[15ch]">
            {t('affiliates.applyTitle')}
          </h2>
          <p className="sn-body mt-5 max-w-[40ch]">
            {t('affiliates.applyBody')}
          </p>
        </div>
        {state === 'done' ? (
          <div className="aff-success" role="status">
            <span className="aff-check">
              <Check className="size-5" />
            </span>
            <h3>{t('affiliates.successTitle')}</h3>
            <p>{t('affiliates.successBody')}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="aff-form">
            {error ? (
              <p className="aff-form-error" role="alert">
                {error}
              </p>
            ) : null}
            <input
              name="company"
              tabIndex={-1}
              autoComplete="off"
              className="hidden"
              aria-hidden
            />
            <label>
              <span>{t('affiliates.nameLabel')}</span>
              <input name="name" required minLength={2} />
            </label>
            <label>
              <span>{t('affiliates.emailLabel')}</span>
              <input name="email" type="email" required />
            </label>
            <label className="aff-full">
              <span>
                {t('affiliates.websiteLabel')}{' '}
                <small>{t('affiliates.websiteOptional')}</small>
              </span>
              <input name="website" type="url" placeholder="https://" />
            </label>
            <label className="aff-full">
              <span>{t('affiliates.audienceLabel')}</span>
              <input
                name="audience"
                required
                minLength={2}
                placeholder={t('affiliates.audiencePlaceholder')}
              />
            </label>
            <label className="aff-full">
              <span>{t('affiliates.planLabel')}</span>
              <textarea
                name="promotionPlan"
                required
                minLength={10}
                rows={4}
                placeholder={t('affiliates.planPlaceholder')}
              />
            </label>
            <label className="aff-full">
              <span>{t('affiliates.payoutLabel')}</span>
              <input name="payoutEmail" type="email" required />
              <small>{t('affiliates.payoutHint')}</small>
            </label>
            <button
              className="sn-pill aff-full justify-center"
              type="submit"
              disabled={state === 'sending'}
            >
              {state === 'sending'
                ? t('affiliates.submitting')
                : t('affiliates.submit')}
              <ArrowRight className="size-4" />
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
