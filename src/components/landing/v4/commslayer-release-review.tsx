'use client';
import { useState } from 'react';
import { useLocale } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { translateMessages } from '@/lib/i18n/namespace';
import { commslayerRelease } from '@/lib/i18n/messages/commslayer-release';
import { releaseScenarios, releaseExamples, releaseIntegrationGuides, releaseUpdates, releasePricingEvidence } from '@/lib/release/commslayer-review';

type Key = keyof typeof commslayerRelease;
export function CommslayerReleaseReview() {
  const { locale } = useLocale(), format = useFormat();
  const t = (key: Key, vars?: Record<string, string | number>) => translateMessages(locale, commslayerRelease, key, vars);
  const [section, setSection] = useState<'demos' | 'examples' | 'pricing' | 'integrations' | 'changelog'>('demos');
  const [selected, setSelected] = useState(0), [step, setStep] = useState(0);
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null;
  const scenario = releaseScenarios[selected];
  const evidence = releasePricingEvidence, competitor = evidence.commslayer;
  const price = (value: number, digits = 0) => format.currency(value, 'USD', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const button = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-50';
  return <section className="space-y-4" aria-label={t('title')}>
    <h2 className="text-lg font-semibold">{t('positioning')}</h2><p className="text-sm text-muted-foreground">{t('scope')}</p>
    <div className="flex flex-wrap gap-2">{(['demos', 'examples', 'pricing', 'integrations', 'changelog'] as const).map(key => <button type="button" key={key} className={button} aria-pressed={section === key} onClick={() => setSection(key)}>{t(key)}</button>)}</div>
    {section === 'demos' && <div className="space-y-4 rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{t('illustration')}</p>
      <div className="flex flex-wrap gap-2">{releaseScenarios.map((item, index) => <button type="button" key={item.id} className={button} aria-pressed={selected === index} onClick={() => { setSelected(index);setStep(0); }}>{t(`demo_${item.id}`)}</button>)}</div>
      <p className="text-xs">{t('step', { current: format.number(step + 1), total: format.number(scenario.steps.length) })}</p>
      <p className="min-h-16 text-sm">{t(scenario.steps[step])}</p>
      <button type="button" className={button} onClick={() => setStep(step + 1 < scenario.steps.length ? step + 1 : 0)}>{t(step + 1 < scenario.steps.length ? 'next' : 'restart')}</button>
    </div>}
    {section === 'examples' && <div className="space-y-4"><p className="text-sm text-muted-foreground">{t('casesScope')}</p>{releaseExamples.map(key => <article key={key} className="rounded-xl border p-4"><h3 className="font-medium">{t(key)}</h3><p className="mt-2 text-sm">{t(`${key}Example`)}</p></article>)}</div>}
    {section === 'pricing' && <div className="space-y-4 rounded-xl border p-4 text-sm">
      <p>{t('verifiedOn', { date: format.dateTime(evidence.checkedAt) })}</p><p>{t('pricingUnits')}</p>
      <p>{t('pricingRiverz', { price: price(evidence.riverz.balanceMonthly) })}</p>
      <p>{t('pricingCommslayer', { free: format.number(competitor.freeConversations), plus: price(competitor.plus.monthlyFrom), plusConversations: format.number(competitor.plus.conversations), plusMessages: format.number(competitor.plus.aiMessages), scale: price(competitor.scale.monthlyFrom), scaleConversations: format.number(competitor.scale.conversations), scaleMessages: format.number(competitor.scale.aiMessages) })}</p>
      <p>{t('pricingExtras', { conversation: price(competitor.extraConversation, 2), message: price(competitor.extraAiMessage, 3) })}</p>
      <a className="underline" href={competitor.source} target="_blank" rel="noreferrer">{t('source')} · Commslayer</a><p className="text-muted-foreground">{t('pricingNoGuarantee')}</p>
    </div>}
    {section === 'integrations' && <div className="space-y-3">{releaseIntegrationGuides.map(key => <article key={key} className="rounded-xl border p-4 text-sm"><h3 className="font-medium">{t(key)}</h3><p className="mt-2">{t(`${key}Help`)}</p><p className="mt-2 text-xs text-muted-foreground">{t('prerequisites')}: {t(`${key}Requirements`)}</p></article>)}</div>}
    {section === 'changelog' && <div className="space-y-4"><p className="text-sm text-muted-foreground">{t('updatesScope')}</p><ul className="list-disc space-y-3 pl-5 text-sm">{releaseUpdates.map(key => <li key={key}>{t(key)}</li>)}</ul></div>}
  </section>;
}
