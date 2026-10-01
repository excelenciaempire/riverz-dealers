'use client';
import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import type { HttpActionMetadata } from '@/lib/integrations/http-action-store';

const channel = z.enum(['whatsapp', 'instagram', 'messenger', 'gmail', 'outlook', 'zoho', 'webchat', 'voice', 'ig_comment', 'fb_comment']);
const grant = z.object({ agent_id: z.string().uuid(), channel, context_scope: z.enum(['contact', 'business']),
  action_revision: z.number().int().positive(), revision: z.number().int().positive(), state: z.enum(['active', 'withdrawn']),
  granted_by: z.string().uuid(), updated_at: z.string().datetime({ offset: true }) }).strict();
const choice = z.object({ id: z.string().uuid(), name: z.string().min(1).max(120), is_active: z.boolean(),
  channels: z.array(channel).max(7) }).strict();
const catalog = z.object({ grants: z.array(grant).max(100), assistants: z.array(choice).max(100), action_revision: z.number().int().positive() }).strict();
const buttonClass = 'rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50';
const inputClass = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
type Props = { workspaceId: string; row: HttpActionMetadata; allowed: boolean };

export function HttpActionGrants(props: Props) {
  return SHOW_RIVERZ_IMPROVEMENTS && props.allowed ? <Controls key={`${props.workspaceId}:${props.row.id}:${props.row.revision}`} {...props} /> : null;
}
function Controls({ workspaceId, row }: Props) {
  const t = useT(), fetchWithCsrf = useFetchWithCsrf();
  const [open, setOpen] = useState(false), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null), [grants, setGrants] = useState<Array<z.infer<typeof grant>>>([]);
  const [assistants, setAssistants] = useState<Array<z.infer<typeof choice>>>([]);
  const [agentId, setAgentId] = useState(''), [selectedChannel, setChannel] = useState('');
  const [scope, setScope] = useState<'contact' | 'business'>(() => row.definition.method === 'GET'
    && !row.definition.parameters.some(p => !p.source || p.source === 'input')
    && !row.definition.parameters.some(p => p.required && ['contact_id', 'phone', 'email'].includes(p.source ?? '')) ? 'business' : 'contact');
  const [showWithdrawn, setShowWithdrawn] = useState(false);
  const endpoint = `/api/integrations/http-actions/${row.id}/assistant-grants`;
  const canBind = row.definition.parameters.some(p => p.required && p.type === 'string' && ['contact_id', 'phone', 'email'].includes(p.source ?? ''));
  const canBusiness = row.definition.method === 'GET' && !row.definition.parameters.some(p => !p.source || p.source === 'input');
  const selected = assistants.find(a => a.id === agentId);
  async function request(method: 'GET' | 'PATCH', input?: unknown) {
    const response = await fetchWithCsrf(endpoint, { method, cache: 'no-store', headers: { 'content-type': 'application/json', 'x-riverz-workspace': workspaceId },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    const json = await response.json();
    if (!response.ok) {
      const key = typeof json.error === 'string' ? json.error.replace(/^http_action_/, '') : 'unavailable';
      const allowed = ['invalid', 'not_found', 'forbidden', 'changed', 'identity_required', 'limit', 'read_only', 'unauthorized', 'limited', 'unavailable'];
      throw new Error(t(`settings.httpAction_${allowed.includes(key) ? key : 'unavailable'}`));
    }
    return json;
  }
  async function load() {
    setBusy(true); setFailure(null);
    try {
      const result = catalog.safeParse(await request('GET'));
      if (!result.success) throw new Error(t('settings.httpAction_unavailable'));
      if (result.data.action_revision !== row.revision) throw new Error(t('settings.httpAction_changed'));
      setGrants(result.data.grants); setAssistants(result.data.assistants); setLoaded(true);
    } catch (error) { setFailure(error instanceof Error ? error.message : t('settings.httpAction_unavailable')); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setFailure(null);
    if (!selected?.channels.some(channel => channel === selectedChannel) || (scope === 'contact' ? !canBind : !canBusiness)) {
      setFailure(t('settings.httpAction_identity_required')); return;
    }
    setBusy(true);
    const existing = grants.find(g => g.agent_id === agentId && g.channel === selectedChannel);
    try {
      const result = grant.safeParse(await request('PATCH', { operation: 'save', agent_id: agentId, channel: selectedChannel,
        context_scope: scope, action_revision: row.revision, expected_version: existing?.revision ?? 0 }));
      if (!result.success || result.data.agent_id !== agentId || result.data.channel !== selectedChannel || result.data.state !== 'active'
        || result.data.action_revision !== row.revision || result.data.context_scope !== scope || result.data.revision !== (existing?.revision ?? 0) + 1) {
        throw new Error(t('settings.httpAction_unavailable'));
      }
      setGrants(current => [...current.filter(g => g.agent_id !== agentId || g.channel !== selectedChannel), result.data]);
    } catch (error) { setFailure(error instanceof Error ? error.message : t('settings.httpAction_unavailable')); }
    finally { setBusy(false); }
  }
  async function withdraw(item: z.infer<typeof grant>) {
    setBusy(true); setFailure(null);
    try {
      const result = grant.safeParse(await request('PATCH', { operation: 'withdraw', agent_id: item.agent_id,
        channel: item.channel, expected_version: item.revision }));
      if (!result.success || result.data.agent_id !== item.agent_id || result.data.channel !== item.channel || result.data.state !== 'withdrawn'
        || ![item.revision, item.revision + 1].includes(result.data.revision)) throw new Error(t('settings.httpAction_unavailable'));
      setGrants(current => current.map(g => g.agent_id === item.agent_id && g.channel === item.channel ? result.data : g));
    } catch (error) { setFailure(error instanceof Error ? error.message : t('settings.httpAction_unavailable')); }
    finally { setBusy(false); }
  }
  return <div className="border-t border-border pt-2">
    <button type="button" className={buttonClass} aria-expanded={open} disabled={busy} onClick={() => { setOpen(!open); if (!open && !loaded) void load(); }}>{t('settings.httpGrantTitle')}</button>
    {open && <div className="mt-3 space-y-3 text-xs">
      <p className="text-muted-foreground">{t('settings.httpGrantHelp')}</p>
      <p>{row.definition.method === 'POST' ? t('settings.httpGrantPostHelp') : t('settings.httpGrantGetHelp')}</p>
      {row.state !== 'active' && <p className="text-muted-foreground">{t('settings.httpGrantDraftHelp')}</p>}
      {busy && <p role="status">{t('settings.httpLoading')}</p>}
      {failure && <div role="alert" className="space-y-2 text-destructive"><p>{failure}</p><button className={buttonClass} type="button" disabled={busy} onClick={() => void load()}>{t('settings.httpReload')}</button></div>}
      {loaded && <>
        {!assistants.length && <p>{t('settings.httpGrantNoProfiles')}</p>}
        {assistants.length > 0 && <form onSubmit={submit} className="space-y-3">
          <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-3">
            <label className="space-y-1"><span>{t('settings.httpGrantProfile')}</span><select required className={inputClass} value={agentId} onChange={event => { setAgentId(event.target.value); setChannel(''); }}>
              <option value="">{t('settings.httpGrantChoose')}</option>{assistants.map(a => <option key={a.id} value={a.id} disabled={!a.channels.length}>{a.name}{a.is_active ? '' : ` (${t('settings.httpGrantPaused')})`}</option>)}
            </select></label>
            <label className="space-y-1"><span>{t('settings.httpGrantChannel')}</span><select required className={inputClass} value={selectedChannel} onChange={event => setChannel(event.target.value)} disabled={!selected}>
              <option value="">{t('settings.httpGrantChoose')}</option>{selected?.channels.map(c => <option key={c} value={c}>{t(`settings.httpGrantChannel_${c}`)}</option>)}
            </select></label>
            <label className="space-y-1"><span>{t('settings.httpGrantScope')}</span><select className={inputClass} value={scope} onChange={event => setScope(event.target.value as 'contact' | 'business')}>
              <option value="contact" disabled={!canBind}>{t('settings.httpGrantScope_contact')}</option><option value="business" disabled={!canBusiness}>{t('settings.httpGrantScope_business')}</option>
            </select></label>
          </fieldset>
          {scope === 'business' && <p className="text-muted-foreground">{t('settings.httpGrantBusinessHelp')}</p>}
          {!canBind && !canBusiness && <p className="text-muted-foreground">{t('settings.httpAction_identity_required')}</p>}
          <button type="submit" className={buttonClass} disabled={busy || !selectedChannel || (scope === 'contact' ? !canBind : !canBusiness)}>{t('settings.httpGrantSave')}</button>
        </form>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={showWithdrawn} onChange={event => setShowWithdrawn(event.target.checked)} />{t('settings.httpGrantShowWithdrawn')}</label>
        {grants.filter(g => showWithdrawn || g.state === 'active').map(g => <div key={`${g.agent_id}:${g.channel}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2">
          <div><p>{assistants.find(a => a.id === g.agent_id)?.name ?? t('settings.httpGrantUnavailableProfile')} · {t(`settings.httpGrantChannel_${g.channel}`)}</p>
            <p className="text-muted-foreground">{t(`settings.httpGrantScope_${g.context_scope}`)} · {t('settings.httpVersion', { n: g.action_revision })} · {t(`settings.httpState_${g.state}`)}</p>
            {g.action_revision !== row.revision && <p className="text-amber-700 dark:text-amber-300">{t('settings.httpGrantChanged')}</p>}
          </div>
          {g.state === 'active' && <button type="button" className={buttonClass} disabled={busy} onClick={() => void withdraw(g)}>{t('settings.httpGrantWithdraw')}</button>}
        </div>)}
        {!grants.some(g => g.state === 'active') && <p className="text-muted-foreground">{t('settings.httpGrantEmpty')}</p>}
      </>}
    </div>}
  </div>;
}
