'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  VoiceSettings,
  initialVoiceState,
  type VoiceState,
} from '@/components/ai/voice-settings';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useLocale, useT } from '@/hooks/use-locale';

type VoiceAgent = {
  id: string;
  name: string;
  language?: string | null;
  is_active: boolean;
  voice_enabled: boolean;
  ai_agent_channels?: { channel: string }[];
} & Partial<VoiceState>;

/**
 * Los perfiles telefónicos viven en Llamadas. Un asistente de chat sólo los
 * vincula; no vuelve a mezclar guion, voz y operación del canal con su persona.
 */
export function VoiceAgentProfiles({
  workspaceId,
  onSaved,
}: {
  workspaceId?: string;
  onSaved?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const fetchWithCsrf = useFetchWithCsrf();
  const [agents, setAgents] = useState<VoiceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/ai/agents?workspace_id=${workspaceId}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { agents?: VoiceAgent[] };
      setAgents(
        (json.agents ?? []).filter(
          (agent) =>
            agent.voice_enabled ||
            agent.ai_agent_channels?.some(
              (channel) => channel.channel === 'voice'
            )
        )
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!name.trim() || !workspaceId) return;
    setSaving(true);
    try {
      const res = await fetchWithCsrf('/api/ai/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: name.trim(),
          language: locale,
          is_active: true,
          scope: 'channels',
          channels: ['voice'],
          voice_enabled: true,
          voice_ai_decides: false,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        agent?: VoiceAgent;
        error?: string;
      } | null;
      if (!res.ok || !json?.agent) {
        toast.error(json?.error ?? t('voice.voiceAgentCreateFailed'));
        return;
      }
      const created = json.agent;
      setAgents((current) => [created, ...current]);
      setName('');
      setCreating(false);
      setOpenId(created.id);
      setVoice(initialVoiceState(created));
      toast.success(t('voice.voiceAgentCreated'));
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  async function save(agent: VoiceAgent) {
    if (!voice) return;
    setSaving(true);
    try {
      const res = await fetchWithCsrf(`/api/ai/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          voice_enabled: voice.voice_enabled,
          voice_id: voice.voice_id,
          voice_greeting: voice.voice_greeting.trim() || null,
          voice_system_prompt: voice.voice_system_prompt.trim() || null,
          voice_objectives: voice.voice_objectives,
          voice_max_call_seconds: voice.voice_max_call_seconds,
          voice_calling_hours: voice.voice_calling_hours,
          voice_max_retries: voice.voice_max_retries,
          voice_retry_delay_minutes: voice.voice_retry_delay_minutes,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        agent?: VoiceAgent;
        error?: string;
      } | null;
      if (!res.ok || !json?.agent) {
        toast.error(json?.error ?? t('voice.voiceAgentSaveFailed'));
        return;
      }
      setAgents((current) =>
        current.map((item) => (item.id === agent.id ? json.agent! : item))
      );
      toast.success(t('voice.voiceAgentSaved'));
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border-border bg-card rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-foreground text-sm font-semibold">
            {t('voice.voiceAgentsTitle')}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {t('voice.voiceAgentsHint')}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setCreating((value) => !value)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('voice.voiceAgentCreate')}
        </Button>
      </div>

      {creating && (
        <div className="border-border bg-muted/30 mt-3 flex gap-2 rounded-lg border p-3">
          <Input
            className="bg-background text-foreground"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('voice.voiceAgentName')}
            maxLength={80}
            autoFocus
          />
          <Button
            type="button"
            size="sm"
            onClick={create}
            disabled={saving || !name.trim()}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t('voice.voiceAgentCreate')
            )}
          </Button>
        </div>
      )}

      {loading ? (
        <Loader2 className="text-muted-foreground mt-4 h-4 w-4 animate-spin" />
      ) : agents.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          {t('voice.voiceAgentsEmpty')}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {agents.map((agent) => {
            const open = openId === agent.id;
            return (
              <div
                key={agent.id}
                className="border-border bg-muted/30 rounded-lg border"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                  onClick={() => {
                    if (open) {
                      setOpenId(null);
                      return;
                    }
                    setOpenId(agent.id);
                    setVoice(initialVoiceState(agent));
                  }}
                >
                  <span>
                    <span className="text-foreground block text-sm font-medium">
                      {agent.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {agent.is_active
                        ? t('voice.voiceAgentActive')
                        : t('voice.voiceAgentPaused')}
                    </span>
                  </span>
                  <ChevronDown
                    className={`text-muted-foreground h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </button>
                {open && voice && (
                  <div className="border-border border-t px-3 py-4">
                    <div className="border-border bg-background mb-4 flex items-center justify-between rounded-lg border px-3 py-2">
                      <span className="text-foreground text-sm">
                        {t('voice.enable')}
                      </span>
                      <Switch
                        checked={voice.voice_enabled}
                        onCheckedChange={(enabled) =>
                          setVoice({ ...voice, voice_enabled: enabled })
                        }
                      />
                    </div>
                    <VoiceSettings
                      value={voice}
                      onChange={setVoice}
                      language={agent.language ?? locale}
                      workspaceId={workspaceId}
                      agentId={agent.id}
                      showAiDecides={false}
                    />
                    <div className="mt-4 flex justify-end">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => save(agent)}
                        disabled={saving}
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          t('voice.save')
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
