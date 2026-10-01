'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { DOCUMENT_MAX_BYTES, DOCUMENT_MAX_TEXT, isDocumentSource, type DocumentRevision, type DocumentSource } from '@/lib/ai/document-contract';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export function DocumentSources({ agentId }: { agentId: string }) {
  const { t } = useLocale(), fmt = useFormat(), fetchWithCsrf = useFetchWithCsrf();
  const [sources, setSources] = useState<DocumentSource[] | null>(null), [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [canEdit, setCanEdit] = useState(false);
  const [reviewed, setReviewed] = useState(false), [withdraw, setWithdraw] = useState(false), [history, setHistory] = useState<DocumentRevision[] | null>(null);
  const controller = useRef<AbortController | null>(null), fileInput = useRef<HTMLInputElement>(null), replacement = useRef<DocumentSource | null>(null);
  const source = sources?.find(row => row.id === selected);
  useEffect(() => () => { controller.current?.abort(); }, []);
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null;
  function choose(row: DocumentSource) { setSelected(row.id);setText(row.text);setReviewed(false);setWithdraw(false);setHistory(null); }
  function store(row: DocumentSource) {
    setSources(old => [row, ...(old ?? []).filter(item => item.id !== row.id)]);choose(row);
  }
  async function request(url: string, init?: RequestInit, mutate = false) {
    if (controller.current) return null;
    const c = new AbortController();controller.current = c;setBusy(true);setError('');
    try {
      const response = await (mutate ? fetchWithCsrf : fetch)(url, { ...init, cache: 'no-store', signal: c.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : t('assistant.document_unavailable'));
      return c.signal.aborted ? null : data;
    } catch (cause) {
      if (!c.signal.aborted) setError(cause instanceof Error && cause.message !== 'Failed to fetch' ? cause.message : t('assistant.document_unavailable'));
      return null;
    } finally {
      if (controller.current === c) { controller.current = null;setBusy(false); }
    }
  }
  async function load() {
    const data = await request(`/api/ai/agents/${agentId}/documents`);
    if (!data) return;
    if (!Array.isArray(data.sources) || !data.sources.every(isDocumentSource) || typeof data.can_edit !== 'boolean') { setError(t('assistant.document_unavailable'));return; }
    setSources(data.sources);setCanEdit(data.can_edit);
    const current = data.sources.find((row: DocumentSource) => row.id === selected) ?? data.sources[0];
    if (current) choose(current);else { setSelected(null);setText('');setHistory(null);setReviewed(false);setWithdraw(false); }
  }
  async function upload(file: File) {
    if (file.size > DOCUMENT_MAX_BYTES) { setError(t('assistant.document_too_large'));return; }
    const form = new FormData();form.append('file', file);
    if (replacement.current) { form.append('source_id', replacement.current.id);form.append('revision', String(replacement.current.revision)); }
    const data = await request(`/api/ai/agents/${agentId}/documents`, { method: 'POST', body: form }, true);
    if (data && isDocumentSource(data)) store(data);else if (data) setError(t('assistant.document_unavailable'));
    replacement.current = null;
  }
  async function change(action: 'edit'|'activate'|'withdraw') {
    if (!source || !canEdit || busy) return;
    const data = await request(`/api/ai/agents/${agentId}/documents`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, source_id: source.id, revision: source.revision, ...(action === 'edit' ? { text } : {}) }) }, true);
    if (data && isDocumentSource(data)) store(data);else if (data) setError(t('assistant.document_unavailable'));
  }
  async function loadHistory() {
    if (!source) return;
    const data = await request(`/api/ai/agents/${agentId}/documents?source_id=${source.id}`);
    if (!data) return;
    if (!Array.isArray(data.history) || data.history.some((row: DocumentRevision) => !row || !Number.isSafeInteger(row.revision) || !Number.isFinite(Date.parse(row.observed_at)) || !['draft','active','withdrawn'].includes(row.status))) { setError(t('assistant.document_unavailable'));return; }
    setHistory(data.history);
  }
  return <details className="rounded-lg border p-3 text-sm" onToggle={event => {
    if (event.currentTarget.open) { if (!busy) void load(); }
    else { controller.current?.abort();controller.current = null;setBusy(false);setReviewed(false);setWithdraw(false); }
  }}>
    <summary className="cursor-pointer font-medium">{t('assistant.documentsTitle')}</summary>
    <div className="mt-3 space-y-3">
      <p className="text-muted-foreground text-xs">{t('assistant.documentsFormats')}</p>
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
      {busy && <p role="status">{t('assistant.documentsProcessing')}</p>}
      {sources && <>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busy} variant="outline" onClick={() => void load()}>{t('assistant.documentsRefresh')}</Button>
          {canEdit && <Button type="button" size="sm" disabled={busy || sources.length >= 20} onClick={() => { replacement.current = null;fileInput.current?.click(); }}>{t('assistant.documentsUpload')}</Button>}
        </div>
        <input ref={fileInput} type="file" hidden accept=".pdf,.docx,.xlsx" onChange={event => { const file = event.target.files?.[0];event.target.value = '';if (file) void upload(file); }} />
        {!sources.length ? <p className="text-muted-foreground">{t('assistant.documentsEmpty')}</p> : <label className="block space-y-1">
          <span>{t('assistant.documentsSource')}</span>
          <select className="w-full rounded border bg-background p-2" value={selected ?? ''} disabled={busy} onChange={event => { const next = sources.find(row => row.id === event.target.value);if (next) choose(next); }}>
            {sources.map(row => <option key={row.id} value={row.id}>{row.name} · {t(`assistant.documentsStatus_${row.status}`)}</option>)}
          </select>
        </label>}
        {source && <>
          <p className="text-muted-foreground text-xs">{t('assistant.documentsRevision', { n: fmt.number(source.revision) })} · {fmt.dateTime(source.updated_at)} · {source.format.toUpperCase()} · {fmt.number(source.bytes)} B</p>
          <label className="block space-y-1"><span>{t('assistant.documentsPreview')}</span><Textarea value={text} maxLength={DOCUMENT_MAX_TEXT} rows={7} readOnly={!canEdit} disabled={busy} onChange={event => { setText(event.target.value);setReviewed(false);setWithdraw(false); }} /></label>
          {canEdit && <>
            <p className="text-muted-foreground text-xs">{t('assistant.documentsEditEffect')}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy || !text.trim() || text === source.text} onClick={() => void change('edit')}>{t('assistant.documentsSave')}</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { replacement.current = source;fileInput.current?.click(); }}>{t('assistant.documentsReplace')}</Button>
            </div>
            {source.status !== 'active' && <>
              <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={reviewed} disabled={busy || text !== source.text} onChange={event => setReviewed(event.target.checked)} />{t('assistant.documentsReview')}</label>
              <Button type="button" size="sm" disabled={busy || !reviewed || text !== source.text} onClick={() => void change('activate')}>{t('assistant.documentsActivate')}</Button>
            </>}
            {source.status !== 'withdrawn' && (withdraw ? <div className="space-y-2"><p className="text-xs">{t('assistant.documentsWithdrawEffect')}</p><div className="flex gap-2">
              <Button type="button" size="sm" disabled={busy} onClick={() => void change('withdraw')}>{t('assistant.documentsWithdrawConfirm')}</Button>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setWithdraw(false)}>{t('assistant.documentsBack')}</Button>
            </div></div> : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setWithdraw(true)}>{t('assistant.documentsWithdraw')}</Button>)}
          </>}
          <details onToggle={event => { event.stopPropagation();if (event.currentTarget.open && !history && !busy) void loadHistory(); }}>
            <summary className="cursor-pointer text-xs">{t('assistant.documentsVersions')}</summary>
            {history?.map(row => <p key={row.revision} className="mt-2 text-xs">{t('assistant.documentsRevision', { n: fmt.number(row.revision) })} · {t(`assistant.documentsStatus_${row.status}`)} · {fmt.dateTime(row.observed_at)} · {row.name}</p>)}
            {history?.length === 50 && <p className="text-xs">{t('assistant.documentsVersionsLimit')}</p>}
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void loadHistory()}>{t('assistant.documentsRefresh')}</Button>
          </details>
        </>}
      </>}
    </div>
  </details>;
}
