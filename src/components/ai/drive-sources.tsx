'use client';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { driveSourceList, type DriveSourceList } from '@/lib/ai/drive-contract';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function DriveSources({ agentId, onChanged }: { agentId: string; onChanged: () => void }) {
  const { t } = useLocale(), fmt = useFormat(), fetchWithCsrf = useFetchWithCsrf();
  const [status, setStatus] = useState<DriveSourceList | null>(null), [file, setFile] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);
  if (!SHOW_RIVERZ_IMPROVEMENTS) return null;
  const base = `/api/ai/agents/${agentId}/drive`;
  async function request(url: string, body?: unknown, mutate = false) {
    if (controller.current) return null;
    const c = new AbortController(); controller.current = c; setBusy(true); setError('');
    try {
      const response = await (mutate ? fetchWithCsrf : fetch)(url, { method: mutate ? 'POST' : 'GET',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), cache: 'no-store', signal: c.signal });
      const data = await response.json();
      if (!response.ok) { if (!c.signal.aborted) setError(typeof data.error === 'string' ? data.error : t('assistant.drive_unavailable')); return null; }
      return c.signal.aborted ? null : data;
    } catch { if (!c.signal.aborted) setError(t('assistant.drive_unavailable')); return null; }
    finally { if (controller.current === c) { controller.current = null; setBusy(false); } }
  }
  async function load() {
    const data = await request(base); if (!data) return;
    const parsed = driveSourceList.safeParse(data);
    if (!parsed.success) { setError(t('assistant.drive_unavailable')); return; }
    setStatus(parsed.data); setConfirm(null);
  }
  async function connect() {
    const data = await request(base + '/connect', undefined, true); if (!data) return;
    try {
      const url = new URL(data.url);
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error();
      window.location.assign(url.toString());
    } catch { setError(t('assistant.drive_unavailable')); }
  }
  async function change(body: unknown) {
    const result = await request(base, body, true); if (!result) return;
    setFile(''); await load(); onChanged();
  }
  return <details className="rounded-md border p-3" onToggle={event => {
    event.stopPropagation();
    if (event.currentTarget.open) void load();
    else { controller.current?.abort(); controller.current = null; setBusy(false); setConfirm(null); }
  }}>
    <summary className="cursor-pointer font-medium">{t('assistant.driveTitle')}</summary>
    <div className="mt-3 space-y-3">
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
      {status && <>
        {status.connected ? <>
          <p className="text-muted-foreground text-xs">{status.email}</p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (file.trim() && !busy) void change({ action: 'add', file }); }}>
            <label className="min-w-0 flex-1 space-y-1"><span className="text-xs">{t('assistant.driveFile')}</span>
              <Input type="url" value={file} maxLength={2048} disabled={busy} onChange={event => setFile(event.target.value)} placeholder="https://docs.google.com/…" required /></label>
            <Button type="submit" size="sm" disabled={busy || !file.trim() || status.sources.length >= 20}>{t('assistant.driveAdd')}</Button>
          </form>
          <p className="text-muted-foreground text-xs">{t('assistant.driveReview')}</p>
        </> : <Button type="button" size="sm" disabled={busy} onClick={() => void connect()}>{t('assistant.driveConnect')}</Button>}
        {status.sources.map(row => <div key={row.id} className="space-y-1 rounded border p-2 text-xs">
          <a href={`https://drive.google.com/file/d/${row.file_id}/view`} target="_blank" rel="noopener noreferrer" className="underline">{row.name ?? t('assistant.drivePendingFile')}</a>
          <p>{t(`assistant.driveState_${row.state}`)}{row.synced_at ? ` · ${fmt.dateTime(row.synced_at)}` : ''}</p>
          {row.error_code && <p className="text-destructive">{t(`assistant.${row.error_code}`)}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy || !status.connected} onClick={() => void change({ action: 'retry', id: row.id, revision: row.revision })}>{t('assistant.driveRetry')}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => confirm === row.id ? void change({ action: 'remove', id: row.id, revision: row.revision }) : setConfirm(row.id)}>{t(confirm === row.id ? 'assistant.documentsWithdrawConfirm' : 'assistant.driveRemove')}</Button>
            {confirm === row.id && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirm(null)}>{t('assistant.documentsBack')}</Button>}
          </div>
        </div>)}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void load(); onChanged(); }}>{t('assistant.documentsRefresh')}</Button>
          {status.connected && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => confirm === 'disconnect' ? void change({ action: 'disconnect' }) : setConfirm('disconnect')}>{t(confirm === 'disconnect' ? 'assistant.documentsWithdrawConfirm' : 'assistant.driveDisconnect')}</Button>}
        </div>
        {confirm === 'disconnect' && <div className="space-y-1"><p className="text-xs">{t('assistant.driveDisconnectEffect')}</p><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirm(null)}>{t('assistant.documentsBack')}</Button></div>}
      </>}
    </div>
  </details>;
}
