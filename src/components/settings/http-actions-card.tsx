'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, Link2, Loader2, Plus, X } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useWorkspace } from '@/hooks/use-workspace';
import { useFetchWithCsrf, type FetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { httpActionWrite, type HttpActionDefinition } from '@/lib/integrations/http-action-contract';
import type { HttpActionMetadata } from '@/lib/integrations/http-action-store';
import { HttpActionGrants } from './http-action-grants';
import { HttpActionStarterPicker } from './http-action-starter-picker';

const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';
const buttonClass = 'rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50';
const endpoint = '/api/integrations/http-actions';
type History = { revision: number; state: HttpActionMetadata['state']; observed_at: string; credential_present: boolean };
export function HttpActionsCard() {
  return SHOW_RIVERZ_IMPROVEMENTS ? <Access /> : null;
}
function Access() {
  const { workspace, membership, isAdmin, loading } = useWorkspace();
  if (loading || !workspace || !isAdmin) return null;
  const owner = typeof workspace.owner_id === 'string' && membership?.user_id === workspace.owner_id;
  if (!owner && membership?.allowed_sections && !membership.allowed_sections.includes('/ajustes')) return null;
  const canGrant = owner || !membership?.allowed_sections || ['/automatizaciones', '/bandeja'].every(section => membership.allowed_sections!.includes(section));
  return <Actions key={workspace.id} workspaceId={workspace.id} canGrant={canGrant} />;
}
function Actions({ workspaceId, canGrant }: { workspaceId: string; canGrant: boolean }) {
  const t = useT(), fetchWithCsrf = useFetchWithCsrf();
  const [open, setOpen] = useState(false), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [items, setItems] = useState<HttpActionMetadata[]>([]), [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState<HttpActionMetadata | 'new' | null>(null);
  const [history, setHistory] = useState<{ id: string; rows: History[] } | null>(null);
  const headers = { 'content-type': 'application/json', 'x-riverz-workspace': workspaceId };
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetchWithCsrf(path, { ...init, cache: 'no-store', headers });
    const json = await response.json();
    if (!response.ok) {
      const key = typeof json.error === 'string' ? json.error.replace(/^http_action_/, '') : 'unavailable';
      const allowed = ['invalid', 'not_found', 'forbidden', 'changed', 'credential_required', 'limit', 'read_only', 'unauthorized', 'limited', 'unavailable'];
      throw new Error(t(`settings.httpAction_${allowed.includes(key) ? key : 'unavailable'}`));
    }
    return json;
  }
  async function load() {
    setBusy(true); setFailure(null);
    try {
      const json = await request(endpoint);
      if (!Array.isArray(json.actions)) throw new Error(t('settings.httpAction_unavailable'));
      setItems(json.actions); setLoaded(true);
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : t('settings.httpAction_unavailable')); }
    finally { setBusy(false); }
  }
  async function transition(row: HttpActionMetadata, operation: 'activate' | 'withdraw') {
    setBusy(true); setFailure(null);
    try {
      const next = await request(`${endpoint}/${row.id}`, { method: 'PATCH', body: JSON.stringify({ operation, expected_version: row.revision }) });
      setItems(current => current.map(item => item.id === row.id ? next : item)); setHistory(null);
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : t('settings.httpAction_unavailable')); }
    finally { setBusy(false); }
  }
  async function versions(row: HttpActionMetadata) {
    setBusy(true); setFailure(null);
    try {
      const json = await request(`${endpoint}/${row.id}/history`);
      if (!Array.isArray(json.history)) throw new Error(t('settings.httpAction_unavailable'));
      setHistory({ id: row.id, rows: json.history });
    } catch (cause) { setFailure(cause instanceof Error ? cause.message : t('settings.httpAction_unavailable')); }
    finally { setBusy(false); }
  }
  return <li className="col-span-full rounded-xl border border-border bg-card p-4">
    <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); if (!open && !loaded && !busy) void load(); }} className="flex w-full items-center gap-3 text-left">
      <Link2 aria-hidden className="size-5 shrink-0 text-primary" />
      <span className="flex-1"><span className="block text-sm font-semibold">{t('settings.httpTitle')}</span><span className="block text-xs text-muted-foreground">{t('settings.httpDescription')}</span></span>
      <ChevronDown aria-hidden className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="mt-5 space-y-4">
      <p className="text-sm text-muted-foreground">{t('settings.httpAvailableTo')}</p>
      {failure && <div role="alert" className="flex items-center gap-3 text-sm text-destructive"><span>{failure}</span><button type="button" disabled={busy} className={buttonClass} onClick={() => void load()}>{t('settings.httpReload')}</button></div>}
      {busy && <span role="status" className="flex items-center gap-2 text-sm"><Loader2 aria-hidden className="size-4 animate-spin" />{t('settings.httpLoading')}</span>}
      {loaded && <>
        {!items.length && <p className="text-sm text-muted-foreground">{t('settings.httpEmpty')}</p>}
        {items.map(row => <article key={row.id} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{row.definition.name}</strong><span className="text-xs text-muted-foreground">{t(`settings.httpState_${row.state}`)} · {t('settings.httpVersion', { n: row.revision })}</span></div>
          <p className="text-xs text-muted-foreground">{row.definition.description}</p>
          <p className="text-xs">{row.definition.method === 'POST' ? t('settings.httpWrites') : t('settings.httpReads')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={busy || editing !== null} onClick={() => { setEditing(row); setHistory(null); }}>{t('settings.httpEdit')}</button>
            {row.state !== 'active' && <button type="button" className={buttonClass} disabled={busy || editing !== null} onClick={() => void transition(row, 'activate')}>{t('settings.httpActivate')}</button>}
            {row.state === 'active' && <button type="button" className={buttonClass} disabled={busy || editing !== null} onClick={() => void transition(row, 'withdraw')}>{t('settings.httpWithdraw')}</button>}
            <button type="button" className={buttonClass} disabled={busy || editing !== null} onClick={() => void versions(row)}>{t('settings.httpHistory')}</button>
          </div>
          {history?.id === row.id && <div className="space-y-1 text-xs"><p>{t('settings.httpHistoryLimit')}</p>{history.rows.map(version => <p key={version.revision}>{t('settings.httpVersion', { n: version.revision })} · {t(`settings.httpState_${version.state}`)} · {version.observed_at} · {version.credential_present ? t('settings.httpSecretPresent') : t('settings.httpSecretNone')}</p>)}</div>}
          <HttpActionGrants workspaceId={workspaceId} row={row} allowed={canGrant && !editing} />
        </article>)}
        {!editing && <button type="button" disabled={busy || items.length >= 20} className={`${buttonClass} flex items-center gap-2`} onClick={() => { setEditing('new'); setHistory(null); }}><Plus aria-hidden className="size-4" />{t('settings.httpNew')}</button>}
        {editing && <ActionForm key={editing === 'new' ? 'new' : `${editing.id}:${editing.revision}`} row={editing === 'new' ? null : editing}
          workspaceId={workspaceId} fetchWithCsrf={fetchWithCsrf} cancel={() => setEditing(null)} saved={row => { setItems(current => [...current.filter(item => item.id !== row.id), row]); setEditing(null); setFailure(null); }} />}
      </>}
    </div>}
  </li>;
}
function ActionForm({ row, workspaceId, fetchWithCsrf, cancel, saved }: { row: HttpActionMetadata | null; workspaceId: string; fetchWithCsrf: FetchWithCsrf;
  cancel: () => void; saved: (row: HttpActionMetadata) => void }) {
  const t = useT();
  const [definition, setDefinition] = useState<HttpActionDefinition>(row?.definition ?? { name: '', description: '', url: '', method: 'GET', credential_kind: 'none', parameters: [], outputs: [] });
  const [secret, setSecret] = useState(''), [busy, setBusy] = useState(false), [failure, setFailure] = useState<string | null>(null);
  const change = <K extends keyof HttpActionDefinition>(key: K, value: HttpActionDefinition[K]) => setDefinition(current => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault(); setFailure(null);
    const parsed = httpActionWrite.safeParse({ definition, expected_version: row?.revision ?? 0, ...(secret ? { secret } : {}) });
    if (!parsed.success) { setFailure(t('settings.httpAction_invalid')); return; }
    setBusy(true);
    try {
      const response = await fetchWithCsrf(row ? `${endpoint}/${row.id}` : endpoint, { method: row ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json', 'x-riverz-workspace': workspaceId },
        body: JSON.stringify({ ...parsed.data, ...(row ? { operation: 'save' } : {}) }) });
      const json = await response.json();
      if (!response.ok) {
        const key = String(json.error ?? '').replace(/^http_action_/, '');
        const allowed = ['invalid', 'not_found', 'forbidden', 'changed', 'credential_required', 'limit', 'read_only', 'unauthorized', 'limited', 'unavailable'];
        setFailure(t(`settings.httpAction_${allowed.includes(key) ? key : 'unavailable'}`)); return;
      }
      setSecret(''); saved(json);
    } catch { setFailure(t('settings.httpAction_unavailable')); }
    finally { setBusy(false); }
  }
  const field = (label: string, child: ReactNode) => <label className="block space-y-1 text-xs"><span>{label}</span>{child}</label>;
  return <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-background p-4">
    <p className="text-sm font-medium">{row ? t('settings.httpEdit') : t('settings.httpNew')}</p>
    <p className="text-xs text-muted-foreground">{t('settings.httpDraftHelp')}</p>
    {!row && <fieldset disabled={busy}><HttpActionStarterPicker apply={draft => { setDefinition(draft); setSecret(''); setFailure(null); }} /></fieldset>}
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      {field(t('settings.httpName'), <input className={inputClass} required maxLength={80} value={definition.name} onChange={event => change('name', event.target.value)} />)}
      {field(t('settings.httpPurpose'), <input className={inputClass} required maxLength={500} value={definition.description} onChange={event => change('description', event.target.value)} />)}
      {field(t('settings.httpEndpoint'), <input type="url" className={inputClass} required maxLength={2048} placeholder="https://" value={definition.url} onChange={event => change('url', event.target.value)} />)}
      {field(t('settings.httpMode'), <select className={inputClass} value={definition.method} onChange={event => change('method', event.target.value as 'GET' | 'POST')}><option value="GET">{t('settings.httpReads')}</option><option value="POST">{t('settings.httpWrites')}</option></select>)}
      {field(t('settings.httpAuth'), <select className={inputClass} value={definition.credential_kind} onChange={event => {
        const current = { ...definition, credential_kind: event.target.value as HttpActionDefinition['credential_kind'] };
        delete current.api_key_header; setDefinition(current); setSecret('');
      }}><option value="none">{t('settings.httpSecretNone')}</option><option value="bearer">Bearer</option><option value="api-key">{t('settings.httpApiKey')}</option></select>)}
      {definition.credential_kind === 'api-key' && field(t('settings.httpApiKeyHeader'), <select className={inputClass} value={definition.api_key_header ?? 'x-api-key'} onChange={event => {
        change('api_key_header', event.target.value as 'x-api-key' | 'x-make-apikey'); setSecret('');
      }}><option value="x-api-key">X-API-Key</option><option value="x-make-apikey">x-make-apikey (Make)</option></select>)}
      {definition.credential_kind !== 'none' && field(t('settings.httpSecret'), <input type="password" autoComplete="new-password" className={inputClass} minLength={8} maxLength={definition.api_key_header === 'x-make-apikey' ? 512 : 4096} value={secret} placeholder={row?.has_secret ? t('settings.httpSecretKeep') : ''} onChange={event => setSecret(event.target.value)} />)}
    </fieldset>
    {definition.method === 'POST' && <p className="text-xs text-amber-700 dark:text-amber-300">{t('settings.httpConfirmHelp')}</p>}
    <fieldset disabled={busy} className="space-y-3">
      <legend className="text-sm font-medium">{t('settings.httpInputs')}</legend>
      <p className="text-xs text-muted-foreground">{t('settings.httpIdentityHelp')}</p>
      {definition.parameters.map((parameter, index) => <div key={index} className="grid items-end gap-2 rounded-lg border border-border p-2 sm:grid-cols-5">
        {field(t('settings.httpField'), <input className={inputClass} required maxLength={48} value={parameter.key} onChange={event => change('parameters', definition.parameters.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} />)}
        {field(t('settings.httpType'), <select className={inputClass} value={parameter.type} onChange={event => change('parameters', definition.parameters.map((item, i) => i === index ? { ...item, type: event.target.value as typeof item.type } : item))}>{['string', 'number', 'boolean'].map(type => <option key={type} value={type}>{t(`settings.httpType_${type}`)}</option>)}</select>)}
        {field(t('settings.httpSource'), <select className={inputClass} value={parameter.source ?? 'input'} onChange={event => change('parameters', definition.parameters.map((item, i) => i === index ? { ...item, source: event.target.value as typeof item.source, type: event.target.value === 'input' ? item.type : 'string' } : item))}>{['input', 'contact_id', 'conversation_id', 'phone', 'email'].map(source => <option key={source} value={source}>{t(`settings.httpSource_${source}`)}</option>)}</select>)}
        <label className="flex items-center gap-2 py-2 text-xs"><input type="checkbox" checked={parameter.required} onChange={event => change('parameters', definition.parameters.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))} />{t('settings.httpRequired')}</label>
        <button type="button" className={buttonClass} aria-label={t('settings.httpRemoveField')} onClick={() => change('parameters', definition.parameters.filter((_, i) => i !== index))}><X aria-hidden className="size-4" /></button>
      </div>)}
      <button type="button" className={buttonClass} disabled={definition.parameters.length >= 12} onClick={() => change('parameters', [...definition.parameters, { key: '', type: 'string', source: 'input', required: true }])}>{t('settings.httpAddInput')}</button>
    </fieldset>
    <fieldset disabled={busy} className="space-y-3">
      <legend className="text-sm font-medium">{t('settings.httpOutputs')}</legend><p className="text-xs text-muted-foreground">{t('settings.httpOutputHelp')}</p>
      {definition.outputs.map((output, index) => <div key={index} className="grid items-end gap-2 rounded-lg border border-border p-2 sm:grid-cols-5">
        {field(t('settings.httpField'), <input className={inputClass} required maxLength={48} value={output.key} onChange={event => change('outputs', definition.outputs.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} />)}
        {field(t('settings.httpPath'), <input className={inputClass} required placeholder="result.status" value={output.path.join('.')} onChange={event => change('outputs', definition.outputs.map((item, i) => i === index ? { ...item, path: event.target.value.split('.') } : item))} />)}
        {field(t('settings.httpType'), <select className={inputClass} value={output.type} onChange={event => change('outputs', definition.outputs.map((item, i) => i === index ? { ...item, type: event.target.value as typeof item.type } : item))}>{['string', 'number', 'boolean'].map(type => <option key={type} value={type}>{t(`settings.httpType_${type}`)}</option>)}</select>)}
        <label className="flex items-center gap-2 py-2 text-xs"><input type="checkbox" checked={output.required} onChange={event => change('outputs', definition.outputs.map((item, i) => i === index ? { ...item, required: event.target.checked } : item))} />{t('settings.httpRequired')}</label>
        <button type="button" className={buttonClass} aria-label={t('settings.httpRemoveField')} onClick={() => change('outputs', definition.outputs.filter((_, i) => i !== index))}><X aria-hidden className="size-4" /></button>
      </div>)}
      <button type="button" className={buttonClass} disabled={definition.outputs.length >= 12} onClick={() => change('outputs', [...definition.outputs, { key: '', type: 'string', path: [''], required: true }])}>{t('settings.httpAddOutput')}</button>
    </fieldset>
    {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
    <div className="flex gap-2"><button type="submit" disabled={busy} className={`${buttonClass} bg-primary text-primary-foreground`}>{busy ? t('settings.httpLoading') : t('settings.httpSaveDraft')}</button><button type="button" disabled={busy} className={buttonClass} onClick={cancel}>{t('settings.httpCancel')}</button></div>
  </form>;
}
