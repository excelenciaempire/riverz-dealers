'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import {SHOW_RIVERZ_IMPROVEMENTS} from '@/lib/ui/improvements-preview';

export function VoiceFallbackSettings({
  workspaceId,
  onSaved,
}: {
  workspaceId?: string;
  onSaved?: () => void;
}) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [number, setNumber] = useState('');
  const [language, setLanguage] = useState<'es' | 'en'>('es');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mailbox, setMailbox] = useState(false);
  const [seconds, setSeconds] = useState('60');
  const [loadError, setLoadError] = useState(false);
  const scopeVersion=useRef(0);

  useEffect(() => {
    const lifecycle=scopeVersion;
    const version=++lifecycle.current;
    const controller=new AbortController();
    setLoading(true);setSaving(false);setLoadError(false);
    setNumber('');setLanguage('es');setMailbox(false);setSeconds('60');
    if(workspaceId)void (async()=>{
      try {
        const response=await fetch(`/api/voice/connection?workspace_id=${workspaceId}`,{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw new Error('unavailable');
        const json=await response.json();
        if(lifecycle.current!==version)return;
        setNumber(json.config?.fallback_transfer_number ?? '');
        setLanguage(json.config?.fallback_language==='en'?'en':'es');
        setMailbox(json.config?.fallback_voicemail_enabled===true);
        setSeconds(String(json.config?.fallback_voicemail_seconds ?? 60));
      }catch {if(lifecycle.current===version)setLoadError(true);}
      finally {if(lifecycle.current===version)setLoading(false);}
    })();
    return()=>{lifecycle.current++;controller.abort();};
  }, [workspaceId]);

  async function save() {
    if (!workspaceId) return;
    const duration=Number(seconds), version=scopeVersion.current;
    if(SHOW_RIVERZ_IMPROVEMENTS && (!Number.isInteger(duration)||duration<15||duration>120)) {
      toast.error(t('voice.mailboxInvalid'));return;
    }
    setSaving(true);
    try {
      const response = await fetchWithCsrf('/api/voice/connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          config: {
            fallback_transfer_number: number.trim(),
            fallback_language: language,
            ...(SHOW_RIVERZ_IMPROVEMENTS?{fallback_voicemail_enabled:mailbox,fallback_voicemail_seconds:duration}:{}),
          },
        }),
      });
      if(scopeVersion.current!==version)return;
      if (!response.ok) {
        toast.error(t('voice.fallbackInvalid'));
        return;
      }
      toast.success(t('voice.saved'));
      onSaved?.();
    } catch {
      if(scopeVersion.current===version)toast.error(t('voice.fallbackUnavailable'));
    } finally {
      if(scopeVersion.current===version)setSaving(false);
    }
  }

  return (
    <section className="border-border bg-card rounded-2xl border p-4 shadow-sm sm:p-5">
      <h2 className="text-sm font-semibold">{t('voice.fallbackTitle')}</h2>
      <p className="text-muted-foreground mt-0.5 text-xs">
        {t('voice.fallbackDesc')}
      </p>
      {loading ? (
        <Loader2 className="mt-3 size-4 animate-spin" />
      ) : loadError ? <p className="mt-3 text-xs" role="alert">{t('voice.fallbackUnavailable')}</p> : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1 space-y-1">
            <span className="text-xs font-medium">
              {t('voice.fallbackNumber')}
            </span>
            <Input
              type="tel"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              placeholder={t('voice.testCallPlaceholder')}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">
              {t('voice.fallbackLanguage')}
            </span>
            <select
              className="border-input bg-background h-9 rounded-md border px-3 text-sm"
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value === 'en' ? 'en' : 'es')
              }
            >
              <option value="es">{t('voice.fallbackSpanish')}</option>
              <option value="en">{t('voice.fallbackEnglish')}</option>
            </select>
          </label>
          {SHOW_RIVERZ_IMPROVEMENTS && <details className="w-full rounded-lg border p-3">
            <summary className="cursor-pointer text-xs font-medium">{t('voice.mailboxTitle')}</summary>
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={mailbox} onChange={event=>setMailbox(event.target.checked)} />
                {t('voice.mailboxEnable')}
              </label>
              <p className="text-muted-foreground text-xs">{t('voice.mailboxConsent')}</p>
              {mailbox && <label className="block max-w-48 space-y-1 text-xs">
                <span>{t('voice.mailboxDuration')}</span>
                <Input type="number" min={15} max={120} step={1} value={seconds} onChange={event=>setSeconds(event.target.value)} />
              </label>}
            </div>
          </details>}
          <Button onClick={save} disabled={saving || !workspaceId}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              t('voice.save')
            )}
          </Button>
        </div>
      )}
    </section>
  );
}
