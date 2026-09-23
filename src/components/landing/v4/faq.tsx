'use client';

import { Plus } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { FIRST_MONTH_DISCOUNT_PERCENT } from '@/lib/billing/first-month-offer';
import { Rise } from './bits';

const QUESTIONS = [
  ['faqIncludedQuestion', 'faqIncludedAnswer'],
  ['faqSetupQuestion', 'faqSetupAnswer'],
  ['faqFirstMonthQuestion', 'faqFirstMonthAnswer'],
  ['faqCountingQuestion', 'faqCountingAnswer'],
  ['faqGrowthQuestion', 'faqGrowthAnswer'],
  ['faqMistakesQuestion', 'faqMistakesAnswer'],
  ['faqChangeQuestion', 'faqChangeAnswer'],
  ['faqCallsQuestion', 'faqCallsAnswer'],
  ['faqCommitmentQuestion', 'faqCommitmentAnswer'],
] as const;

export function Faq() {
  const t = useT();

  return (
    <section
      id="preguntas"
      className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 lg:py-24"
    >
      <Rise>
        <h2 className="sn-h2">{t('landingV4.faqTitle')}</h2>
      </Rise>

      <div
        className="mt-8 max-w-4xl border-t"
        style={{ borderColor: 'var(--sn-line)' }}
      >
        {QUESTIONS.map(([question, answer]) => (
          <details
            key={question}
            className="group border-b py-5 sm:py-6"
            style={{ borderColor: 'var(--sn-line)' }}
          >
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[17px] leading-snug font-medium marker:hidden sm:text-[19px] [&::-webkit-details-marker]:hidden">
              <span>{t(`landingV4.${question}`)}</span>
              <Plus
                aria-hidden
                className="mt-0.5 size-5 shrink-0 transition-transform group-open:rotate-45"
              />
            </summary>
            <p className="sn-body max-w-[65ch] pt-4 pb-1 !text-[16px]">
              {t(`landingV4.${answer}`, {
                percent: FIRST_MONTH_DISCOUNT_PERCENT,
              })}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
