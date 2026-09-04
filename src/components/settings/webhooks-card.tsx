'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Loader2, Plus, Send, Trash2, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

type Endpoint = { id: string; name: string; url: string; events: string[]; is_active: boolean; webhook_deliveries?: { succeeded: boolean; delivered_at: string }[] };

const AUTOMATION_GUIDES = [
  { name: 'Make', url: 'https://www.make.com/en/help/apps/webhooks' },
  { name: 'Zapier', url: 'https://help.zapier.com/hc/en-us/articles/8496288817805-Set-up-a-webhook-trigger-in-Zapier' },
  { name: 'n8n', url: 'https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/' },
];

export function WebhooksCard() {
  const t = useT(); const fetchWithCsrf = useFetchWithCsrf();
  const [items, setItems] = useState<Endpoint[]>([]); const [events, setEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [open, setOpen] = useState(false);
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [chosen, setChosen] = useState<string[]>(['conversation.created']);
  const [secret, setSecret] = useState<string | null>(null);
  const load = useCallback(async () => { try { const r = await fetch('/api/integrations/webhooks', { cache: 'no-store' }); const j = await r.json(); if (r.ok) { setItems(j.endpoints ?? []); setEvents(j.events ?? []); } } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); toast.success(t('settings.webhookCopied')); };
  async function save() { setSaving(true); try { const r = await fetchWithCsrf('/api/integrations/webhooks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, url, events: chosen }) }); const j = await r.json(); if (!r.ok) { toast.error(t('settings.webhookInvalid')); return; } setSecret(j.secret); setName(''); setUrl(''); setOpen(false); await load(); } catch { toast.error(t('settings.networkError')); } finally { setSaving(false); } }
  async function remove(id: string) { const r = await fetchWithCsrf(`/api/integrations/webhooks?id=${id}`, { method: 'DELETE' }); if (r.ok) { setItems((v) => v.filter((x) => x.id !== id)); toast.success(t('settings.webhookDeleted')); } }
  async function test(id: string) { const r = await fetchWithCsrf(`/api/integrations/webhooks/${id}/test`, { method: 'POST' }); toast[r.ok ? 'success' : 'error'](r.ok ? t('settings.webhookTestSent') : t('settings.genericError')); }
  return <li className="col-span-full rounded-xl border border-border bg-card p-4">
    <div className="flex items-start justify-between gap-3"><div className="flex gap-3"><div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300"><Webhook className="size-5" /></div><div><p className="text-sm font-semibold">{t('settings.webhooksTitle')}</p><p className="mt-0.5 text-xs text-muted-foreground">{t('settings.webhooksDescription')}</p></div></div><button onClick={() => setOpen((x) => !x)} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground"><Plus className="size-3.5" />{t('settings.webhookNew')}</button></div>
    <div className="mt-4 flex flex-wrap gap-2">{AUTOMATION_GUIDES.map((guide) => <a key={guide.name} href={guide.url} target="_blank" rel="noreferrer" className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted">{t('settings.webhookConnectWith', { name: guide.name })}</a>)}</div>
    {open && <div className="mt-4 grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2"><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.webhookName')} className="rounded-md border border-border bg-background px-3 py-2 text-sm" /><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://hooks.make.com/..." className="rounded-md border border-border bg-background px-3 py-2 text-sm" /><div className="sm:col-span-2 flex flex-wrap gap-2">{events.map((event) => <label key={event} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={chosen.includes(event)} onChange={() => setChosen((old) => old.includes(event) ? old.filter((x) => x !== event) : [...old, event])} />{event}</label>)}</div><div className="sm:col-span-2"><button onClick={save} disabled={saving} className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">{saving ? <Loader2 className="size-4 animate-spin" /> : t('settings.save')}</button></div></div>}
    {secret && <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs"><p className="font-medium">{t('settings.webhookSecretTitle')}</p><p className="mt-1 text-muted-foreground">{t('settings.webhookSecretDescription')}</p><div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-background p-2">{secret}</code><button onClick={() => copy(secret)} aria-label={t('settings.copy')}><Copy className="size-4" /></button></div></div>}
    {loading ? <div className="flex justify-center py-5"><Loader2 className="size-4 animate-spin" /></div> : <ul className="mt-4 space-y-2">{items.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"><CheckCircle2 className="size-3.5 text-emerald-600" /><span className="font-medium">{item.name}</span><code className="min-w-0 flex-1 truncate text-muted-foreground">{item.url}</code><span className="text-muted-foreground">{item.events.length} {t('settings.webhookEvents')}</span><button onClick={() => test(item.id)} title={t('settings.webhookSendTest')}><Send className="size-3.5" /></button><button onClick={() => remove(item.id)} title={t('settings.delete')}><Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" /></button></li>)}</ul>}
  </li>;
}
