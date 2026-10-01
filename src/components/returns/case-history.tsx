'use client';
import { useEffect, useRef, useState } from 'react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { returnHistoryPage, type ReturnCaseEvent } from '@/lib/returns/history-contract';

/** Mounted with a case/version key by the existing returns screen. */
export function ReturnCaseHistory({ caseId }: { caseId: string }) {
  const t = useT(), format = useFormat();
  const [events, setEvents] = useState<ReturnCaseEvent[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const retryCursor = useRef<string | undefined>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  async function load(cursor?: string) {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    retryCursor.current = cursor; setLoading(true); setFailed(false);
    if (!cursor) { setEvents(null); setNext(null); }
    try {
      const response = await fetch(`/api/devoluciones/${encodeURIComponent(caseId)}/historial${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('history_read_failed');
      const page = returnHistoryPage.parse(await response.json());
      if (controller.signal.aborted || request.current !== controller) return;
      setEvents(previous => cursor ? [...new Map([...(previous ?? []), ...page.events].map(event => [event.id, event])).values()] : page.events);
      setNext(page.next_cursor);
    } catch {
      if (!controller.signal.aborted && request.current === controller) setFailed(true);
    } finally { if (!controller.signal.aborted && request.current === controller) setLoading(false); }
  }
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null;
  return <details className="mt-3 border-t pt-3" onToggle={event => {
    if (event.currentTarget.open) void load();
    else { request.current?.abort(); setLoading(false); }
  }}>
    <summary className="cursor-pointer text-xs font-medium">{t('returns.history')}</summary>
    <div className="mt-3 space-y-3 text-xs">
      {events?.map(event => <div key={event.id} className="space-y-1 border-l-2 pl-3">
        <div className="flex flex-wrap justify-between gap-2">
          <span className="font-medium">{t(`returns.history_${event.event_type}`)}</span>
          <time dateTime={event.occurred_at} className="text-muted-foreground">{format.dateTime(event.occurred_at)}</time>
        </div>
        {event.event_type === 'baseline' && <p className="text-muted-foreground">{t('returns.historyBaseline')}</p>}
        <p>{event.previous_status && event.previous_status !== event.status ? `${t(`returns.status.${event.previous_status}`)} → ` : ''}{t(`returns.status.${event.status}`)}</p>
        {event.previous_resolution !== event.resolution && event.previous_resolution && <p className="whitespace-pre-wrap text-muted-foreground">{t('returns.historyPreviousNote', { note: event.previous_resolution })}</p>}
        {event.resolution && <p className="whitespace-pre-wrap">{event.resolution}</p>}
        {event.previous_resolution && !event.resolution && <p>{t('returns.historyNoteRemoved')}</p>}
        <p className="text-muted-foreground">{t('returns.historyPhotos', { count: format.number(event.photo_count) })}</p>
      </div>)}
      {failed && <div role="alert"><p>{t('returns.historyFailed')}</p><button type="button" className="mt-1 underline" disabled={loading} onClick={() => void load(retryCursor.current)}>{t('common.retry')}</button></div>}
      {events?.length === 0 && !failed && <p>{t('returns.historyEmpty')}</p>}
      {loading && <p role="status">{t('common.loading')}</p>}
      {next && !failed && <button type="button" className="underline" disabled={loading} onClick={() => void load(next)}>{t('returns.historyOlder')}</button>}
    </div>
  </details>;
}
