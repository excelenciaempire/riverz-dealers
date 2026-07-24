'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import type { VoiceModelConfig } from '@/lib/voice/model-config';

/**
 * Platform-admin only: the GLOBAL voice model stack. Merchants never see this.
 * The API enforces the platform-admin allowlist; this page degrades to a
 * "forbidden" notice if the GET is rejected.
 */
export default function AdminVoiceModelPage() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [config, setConfig] = useState<VoiceModelConfig | null>(null);
  // Plaintext API keys being entered (write-only; never returned by GET).
  const [keys, setKeys] = useState<{
    stt_api_key: string;
    llm_api_key: string;
    tts_api_key: string;
    realtime_api_key: string;
  }>({ stt_api_key: '', llm_api_key: '', tts_api_key: '', realtime_api_key: '' });
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/voice-model', { cache: 'no-store' });
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        return;
      }
      const json = await res.json();
      if (res.ok) setConfig(json.config as VoiceModelConfig);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function set(patch: Partial<VoiceModelConfig>) {
    setConfig((c) => (c ? { ...c, ...patch } : c));
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      // Only send keys the admin actually typed (empty = leave untouched).
      const keyPayload = Object.fromEntries(
        Object.entries(keys).filter(([, v]) => v.trim() !== ''),
      );
      const res = await fetchWithCsrf('/api/admin/voice-model', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, ...keyPayload }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? 'Error');
        return;
      }
      setConfig(json.config as VoiceModelConfig);
      setKeys({ stt_api_key: '', llm_api_key: '', tts_api_key: '', realtime_api_key: '' });
      toast.success(t('voice.adminSaved'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (forbidden || !config) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
        <ShieldAlert className="h-8 w-8" />
        <p className="text-sm">{t('voice.adminForbidden')}</p>
      </div>
    );
  }

  const isRealtime = config.mode === 'realtime';

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('voice.adminTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('voice.adminDesc')}</p>
      </div>

      {/* Mode */}
      <section className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-sm font-medium text-foreground">{t('voice.adminMode')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => set({ mode: 'pipeline' })}
            className={`rounded-lg border p-3 text-left ${
              !isRealtime ? 'border-primary bg-primary/5' : 'border-border bg-muted/40'
            }`}
          >
            <p className="text-sm font-medium text-foreground">{t('voice.adminModePipeline')}</p>
            <p className="text-xs text-muted-foreground">{t('voice.adminPipelineHint')}</p>
          </button>
          <button
            type="button"
            onClick={() => set({ mode: 'realtime' })}
            className={`rounded-lg border p-3 text-left ${
              isRealtime ? 'border-primary bg-primary/5' : 'border-border bg-muted/40'
            }`}
          >
            <p className="text-sm font-medium text-foreground">{t('voice.adminModeRealtime')}</p>
            <p className="text-xs text-muted-foreground">{t('voice.adminRealtimeHint')}</p>
          </button>
        </div>
      </section>

      {!isRealtime ? (
        <>
          <Section title={t('voice.adminStt')}>
            <Row label={t('voice.adminProvider')}>
              <Input value={config.stt_provider} onChange={(e) => set({ stt_provider: e.target.value })} />
            </Row>
            <Row label={t('voice.adminModel')}>
              <Input value={config.stt_model} onChange={(e) => set({ stt_model: e.target.value })} />
            </Row>
            <Row label={t('voice.adminLanguage')}>
              <Input value={config.stt_language} onChange={(e) => set({ stt_language: e.target.value })} />
            </Row>
            <Row label={t('voice.adminEndpoint')}>
              <Input
                placeholder={t('voice.adminEndpointHint')}
                value={config.stt_base_url ?? ''}
                onChange={(e) => set({ stt_base_url: e.target.value || null })}
              />
            </Row>
            <Row label={t('voice.adminApiKey')}>
              <Input
                type="password"
                placeholder={config.has_stt_key ? '••••••••' : ''}
                value={keys.stt_api_key}
                onChange={(e) => setKeys((k) => ({ ...k, stt_api_key: e.target.value }))}
              />
            </Row>
          </Section>

          <Section title={t('voice.adminLlm')}>
            <Row label={t('voice.adminProvider')}>
              <Input value={config.llm_provider} onChange={(e) => set({ llm_provider: e.target.value })} />
            </Row>
            <Row label={t('voice.adminModel')}>
              <Input value={config.llm_model} onChange={(e) => set({ llm_model: e.target.value })} />
            </Row>
            <Row label={t('voice.adminEndpoint')}>
              <Input
                placeholder={t('voice.adminEndpointHint')}
                value={config.llm_base_url ?? ''}
                onChange={(e) => set({ llm_base_url: e.target.value || null })}
              />
            </Row>
            <Row label={t('voice.adminApiKey')}>
              <Input
                type="password"
                placeholder={config.has_llm_key ? '••••••••' : ''}
                value={keys.llm_api_key}
                onChange={(e) => setKeys((k) => ({ ...k, llm_api_key: e.target.value }))}
              />
            </Row>
          </Section>

          <Section title={t('voice.adminTts')}>
            <Row label={t('voice.adminProvider')}>
              <Input value={config.tts_provider} onChange={(e) => set({ tts_provider: e.target.value })} />
            </Row>
            <Row label={t('voice.adminModel')}>
              <Input value={config.tts_model} onChange={(e) => set({ tts_model: e.target.value })} />
            </Row>
            <Row label={t('voice.adminDefaultVoice')}>
              <Input
                value={config.tts_default_voice_id ?? ''}
                onChange={(e) => set({ tts_default_voice_id: e.target.value || null })}
              />
            </Row>
            <Row label={t('voice.adminEndpoint')}>
              <Input
                placeholder={t('voice.adminEndpointHint')}
                value={config.tts_base_url ?? ''}
                onChange={(e) => set({ tts_base_url: e.target.value || null })}
              />
            </Row>
            <Row label={t('voice.adminApiKey')}>
              <Input
                type="password"
                placeholder={config.has_tts_key ? '••••••••' : ''}
                value={keys.tts_api_key}
                onChange={(e) => setKeys((k) => ({ ...k, tts_api_key: e.target.value }))}
              />
            </Row>
          </Section>
        </>
      ) : (
        <Section title={t('voice.adminRealtime')}>
          <Row label={t('voice.adminProvider')}>
            <Input
              placeholder="personaplex"
              value={config.realtime_provider ?? ''}
              onChange={(e) => set({ realtime_provider: e.target.value || null })}
            />
          </Row>
          <Row label={t('voice.adminModel')}>
            <Input
              value={config.realtime_model ?? ''}
              onChange={(e) => set({ realtime_model: e.target.value || null })}
            />
          </Row>
          <Row label={t('voice.adminEndpoint')}>
            <Input
              placeholder={t('voice.adminEndpointHint')}
              value={config.realtime_base_url ?? ''}
              onChange={(e) => set({ realtime_base_url: e.target.value || null })}
            />
          </Row>
          <Row label={t('voice.adminApiKey')}>
            <Input
              type="password"
              placeholder={config.has_realtime_key ? '••••••••' : ''}
              value={keys.realtime_api_key}
              onChange={(e) => setKeys((k) => ({ ...k, realtime_api_key: e.target.value }))}
            />
          </Row>
        </Section>
      )}

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : t('voice.adminSave')}
        </Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-sm font-medium text-foreground">{title}</p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-1 gap-1 sm:grid-cols-[160px_1fr] sm:items-center">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
