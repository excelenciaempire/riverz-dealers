'use client';
import { useState } from 'react';
import { useLocale, useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import Link from '@/components/i18n/locale-link';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { outcomeCsv } from '@/lib/dashboard/outcome-export';
import type { OutcomeReport } from '@/lib/dashboard/outcomes';

export function OutcomeEvidence({ report }: { report: OutcomeReport }) {
  const t = useT(), { locale } = useLocale(), fmt = useFormat();
  const [state, setState] = useState('all'), [limit, setLimit] = useState(20);
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null;
  const rows = report.cases.filter(row => state === 'all' || row.state === state), timing = report.verificationTiming;
  const download = () => {
    const url = URL.createObjectURL(new Blob([outcomeCsv(locale, report)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'riverz-case-outcomes.csv'; link.click(); URL.revokeObjectURL(url);
  };
  return <details className="rounded-xl border p-4 text-sm">
    <summary className="cursor-pointer font-medium">{t('dashboard.timingTitle')}</summary>
    <div className="mt-3 space-y-3">
      <p className="text-muted-foreground">{t('dashboard.timingBasis')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span>{t('dashboard.timingMedian')}: {timing?.medianSeconds === null || timing?.medianSeconds === undefined ? '—' : `${fmt.number(timing.medianSeconds / 60, { maximumFractionDigits: 1 })} min`}</span>
        <span>{t('dashboard.timingSample', { count: fmt.number(timing?.samples ?? 0) })}</span>
        {!!timing?.unavailable && <span>{t('dashboard.timingMissing', { count: fmt.number(timing.unavailable) })}</span>}
        <button type="button" className="rounded border px-3 py-1" onClick={download}>{t('dashboard.timingDownload')}</button>
      </div>
      <label className="flex items-center gap-2">{t('dashboard.timingState')}
        <select className="rounded border bg-background px-2 py-1" value={state} onChange={event => { setState(event.target.value); setLimit(20); }}>
          {['all', 'verified', 'review', 'human'].map(value => <option key={value} value={value}>{t(`dashboard.timingState_${value}`)}</option>)}
        </select>
      </label>
      <ul className="space-y-2">{rows.slice(0, limit).map(row => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
        <Link href={`/bandeja?c=${row.id}`} className="underline">{t('dashboard.timingOpenCase')}</Link>
        <span>{t(`dashboard.timingState_${row.state}`)}</span>
        <span>{row.verificationSeconds === null || row.verificationSeconds === undefined ? '—' : `${fmt.number(row.verificationSeconds / 60, { maximumFractionDigits: 1 })} min`}</span>
        {row.verifiedAt && <time dateTime={row.verifiedAt}>{fmt.dateTime(row.verifiedAt)}</time>}
      </li>)}</ul>
      {!rows.length && <p className="text-muted-foreground">{t('dashboard.timingEmpty')}</p>}
      {rows.length > limit && <button type="button" className="rounded border px-3 py-1" onClick={() => setLimit(value => value + 20)}>{t('dashboard.timingMore')}</button>}
    </div>
  </details>;
}
