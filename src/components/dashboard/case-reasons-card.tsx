'use client';
import { useEffect, useRef, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { useLocale, useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { caseReasonCsv, caseReasonReport, type CaseReasonEvidence, type CaseReasonQuery, type CaseReasonReport } from '@/lib/dashboard/case-reason-contract';

/** Parent keys the card to the selected dashboard filter. No request until
 * explicitly opened, no new navigation or satisfaction survey setting. */
export function CaseReasonsCard({ range }: { range: Pick<CaseReasonQuery,'start'|'end'|'previous_start'|'previous_end'> }) {
  const t = useT(), fmt = useFormat(), { locale } = useLocale();
  const [report,setReport] = useState<CaseReasonReport | null>(null);
  const [cases,setCases] = useState<CaseReasonEvidence[]>([]);
  const [busy,setBusy] = useState(false), [failed,setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null), retry = useRef<Pick<CaseReasonQuery,'reason'|'cursor'>>({});
  const readWindow = useRef(range);
  useEffect(() => () => controller.current?.abort(),[]);
  async function load(selection: Pick<CaseReasonQuery,'reason'|'cursor'> = {}) {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    const window = readWindow.current;
    retry.current = selection; setBusy(true); setFailed(false);
    if (!selection.cursor) setCases([]);
    try {
      const response = await fetch('/api/analytics/case-reasons?'+new URLSearchParams({ ...window,...selection }), { cache:'no-store',signal:current.signal });
      if (!response.ok) throw new Error('case_reason_unavailable');
      const data = caseReasonReport.parse(await response.json());
      if (current.signal.aborted || controller.current !== current) return;
      if (data.selected_reason !== (selection.reason ?? null) || ['start','end','previous_start','previous_end'].some(key => Date.parse(data[key as 'start']) !== Date.parse(window[key as 'start']))) throw new Error('case_reason_stale');
      setReport(data); setCases(previous => selection.cursor ? [...new Map([...previous,...(data.cases ?? [])].map(row => [row.id,row])).values()] : data.cases ?? []);
    } catch { if (!current.signal.aborted && controller.current === current) setFailed(true); }
    finally { if (!current.signal.aborted && controller.current === current) setBusy(false); }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([caseReasonCsv(locale,report)], { type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'riverz-case-reasons.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  const label = (reason: string) => t(reason === 'unclassified' ? 'inbox.caseUnclassified' : `inbox.caseReason_${reason}`);
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null;
  return <details className="rounded-xl border p-4" onToggle={event => {
    if (event.currentTarget.open) { readWindow.current=range; void load(); } else { controller.current?.abort(); setBusy(false); }
  }}>
    <summary className="cursor-pointer text-sm font-medium">{t('dashboard.caseReasons_title')}</summary>
    <p className="mt-2 text-xs text-muted-foreground">{t('dashboard.caseReasons_scope')}</p>
    {report && <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <time dateTime={report.observed_at}>{t('dashboard.caseReasons_observed',{ date:fmt.dateTime(report.observed_at) })}</time>
        <div className="flex gap-3"><button type="button" className="underline" disabled={busy} onClick={() => { readWindow.current=range; void load(report.selected_reason ? { reason:report.selected_reason } : {}); }}>{t('dashboard.caseReasons_refresh')}</button><button type="button" className="underline" onClick={download}>{t('dashboard.caseReasons_export')}</button></div>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-left text-xs">
        <thead><tr>{['reasonColumn','currentCases','previousCases','ratedCases','satisfaction'].map(key => <th key={key} className="px-2 py-2 font-medium">{t(`dashboard.caseReasons_${key}`)}</th>)}</tr></thead>
        <tbody>{report.rows.map(row => <tr key={row.reason} className="border-t">
          <td className="px-2 py-2"><button type="button" disabled={busy || row.current_count===0} onClick={() => void load({ reason:row.reason })} className="text-left underline disabled:no-underline">{label(row.reason)}</button></td>
          <td className="px-2 py-2">{fmt.number(row.current_count)}</td><td className="px-2 py-2">{fmt.number(row.previous_count)}</td>
          <td className="px-2 py-2">{fmt.number(row.rated_count)}</td><td className="px-2 py-2">{row.rated_count ? `${fmt.number(100*row.positive_count/row.rated_count,{ maximumFractionDigits:1 })}%` : '—'}</td>
        </tr>)}</tbody>
      </table></div>
      {report.selected_reason && <div className="space-y-2 text-xs"><p className="font-medium">{label(report.selected_reason)}</p>
        {cases.map(row => <Link key={row.id} href={`/bandeja?c=${encodeURIComponent(row.id)}`} className="block underline">{t('dashboard.caseReasons_openCase',{ date:fmt.dateTime(row.created_at) })}</Link>)}
        {report.next_cursor && !failed && <button type="button" disabled={busy} className="underline" onClick={() => void load({ reason:report.selected_reason!,cursor:JSON.stringify(report.next_cursor) })}>{t('dashboard.caseReasons_older')}</button>}
      </div>}
    </div>}
    {failed && <div role="alert" className="mt-3 text-xs"><p>{t('dashboard.caseReasons_failed')}</p><button type="button" className="mt-1 underline" disabled={busy} onClick={() => void load(retry.current)}>{t('common.retry')}</button></div>}
    {busy && <p role="status" className="mt-3 text-xs">{t('common.loading')}</p>}
  </details>;
}
