'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AudioLines,
  Check,
  ChevronDown,
  Loader2,
  Mic2,
  Plus,
  X,
} from 'lucide-react';
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

type TriggerLinks = {
  automations?: { agent_ids?: string[] }[];
  deciding?: { voice_agent_id?: string | null }[];
  campaigns?: { agent_id?: string | null }[];
};

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
  const [usageByAgent, setUsageByAgent] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [res, linksRes] = await Promise.all([
        fetch(`/api/ai/agents?workspace_id=${workspaceId}`, {
          cache: 'no-store',
        }),
        fetch(`/api/voice/triggers?workspace_id=${workspaceId}`, {
          cache: 'no-store',
        }),
      ]);
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
      if (linksRes.ok) {
        const links = (await linksRes.json()) as TriggerLinks;
        const counts: Record<string, number> = {};
        const add = (id?: string | null) => {
          if (id) counts[id] = (counts[id] ?? 0) + 1;
        };
        for (const automation of links.automations ?? []) {
          for (const id of automation.agent_ids ?? []) add(id);
        }
        for (const assistant of links.deciding ?? []) {
          add(assistant.voice_agent_id);
        }
        for (const campaign of links.campaigns ?? []) add(campaign.agent_id);
        setUsageByAgent(counts);
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!name.trim() || !workspaceId || saving) return;
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
          voice_accepts_inbound: false,
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
    if (!voice || saving) return;
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
          voice_accepts_inbound: voice.voice_accepts_inbound,
          voice_transfer_number:
            voice.voice_transfer_number.trim() || null,
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
    <section className="border-border bg-card overflow-hidden rounded-2xl border shadow-sm">
      <div className="border-border/70 bg-muted/20 relative border-b px-5 py-4">
        <Waveform className="absolute top-0 right-5 hidden h-full opacity-45 sm:flex" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="bg-accent/15 text-accent-ink mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl">
              <Mic2 className="size-4" />
            </span>
            <div>
              <h3 className="text-foreground text-sm font-semibold">
                {t('voice.voiceAgentsTitle')}
              </h3>
              <p className="text-muted-foreground mt-0.5 max-w-xl text-xs">
                {t('voice.voiceAgentsHint')}
              </p>
            </div>
          </div>
          {agents.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant={creating ? 'ghost' : 'outline'}
              onClick={() => setCreating((value) => !value)}
              className="relative shrink-0"
            >
              {creating ? (
                <X className="mr-1 size-3.5" />
              ) : (
                <Plus className="mr-1 size-3.5" />
              )}
              {creating
                ? t('voice.voiceAgentCancel')
                : t('voice.voiceAgentCreate')}
            </Button>
          )}
        </div>
      </div>

      {creating && (
        <div className="border-border bg-background/70 border-b p-4 sm:p-5">
          <div className="mx-auto flex max-w-2xl flex-col gap-2 sm:flex-row">
            <Input
              className="bg-background text-foreground h-10"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void create();
              }}
              placeholder={t('voice.voiceAgentName')}
              maxLength={80}
              autoFocus
            />
            <Button
              type="button"
              onClick={create}
              disabled={saving || !name.trim()}
              className="h-10 shrink-0"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Plus className="mr-1 size-4" />
                  {t('voice.voiceAgentCreate')}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid min-h-36 place-items-center">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : agents.length === 0 ? (
        <div className="px-5 py-8 text-center sm:py-10">
          <div className="bg-accent/10 text-accent-ink border-accent/20 mx-auto grid size-14 place-items-center rounded-2xl border">
            <AudioLines className="size-6" />
          </div>
          <p className="text-foreground mt-4 text-sm font-medium">
            {t('voice.voiceAgentsEmptyTitle')}
          </p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-sm text-xs">
            {t('voice.voiceAgentsEmpty')}
          </p>
          {!creating && (
            <Button
              type="button"
              className="mt-4"
              onClick={() => setCreating(true)}
            >
              <Plus className="mr-1 size-4" />
              {t('voice.voiceAgentFirst')}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2 p-3 sm:p-4">
          {agents.map((agent) => {
            const open = openId === agent.id;
            const ready =
              agent.is_active && agent.voice_enabled && !!agent.voice_id;
            return (
              <div
                key={agent.id}
                id={`voice-agent-${agent.id}`}
                className={`overflow-hidden rounded-xl border transition-all ${
                  open
                    ? 'border-accent/50 bg-background shadow-sm'
                    : 'border-border bg-muted/20 hover:border-border/80 hover:bg-muted/35'
                }`}
              >
                <button
                  type="button"
                  className="group flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left sm:px-4"
                  aria-expanded={open}
                  onClick={() => {
                    if (open) {
                      setOpenId(null);
                      return;
                    }
                    setOpenId(agent.id);
                    setVoice(initialVoiceState(agent));
                  }}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="bg-background text-foreground grid size-9 shrink-0 place-items-center rounded-full border text-sm font-semibold uppercase">
                      {agent.name.slice(0, 1)}
                    </span>
                    <span className="min-w-0">
                      <span className="text-foreground block truncate text-sm font-medium">
                        {agent.name}
                      </span>
                      <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                        <span
                          className={`size-1.5 rounded-full ${ready ? 'bg-emerald-500' : 'bg-amber-500'}`}
                        />
                        {ready
                          ? t('voice.voiceAgentReady')
                          : agent.is_active
                            ? t('voice.voiceAgentNeedsVoice')
                            : t('voice.voiceAgentPaused')}
                        {(usageByAgent[agent.id] ?? 0) > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            {t('voice.voiceAgentLinkedCount', {
                              count: String(usageByAgent[agent.id]),
                            })}
                          </>
                        )}
                      </span>
                    </span>
                  </span>
                  <span className="bg-background grid size-8 shrink-0 place-items-center rounded-lg border">
                    <ChevronDown
                      className={`text-muted-foreground size-4 transition-transform ${open ? 'rotate-180' : ''}`}
                    />
                  </span>
                </button>
                {open && voice && (
                  <div className="border-border bg-card border-t px-4 py-5 sm:px-5">
                    <div className="border-border bg-muted/25 mb-5 flex items-center justify-between rounded-xl border px-3.5 py-3">
                      <span className="text-foreground flex items-center gap-2 text-sm font-medium">
                        <span
                          className={`grid size-7 place-items-center rounded-lg ${voice.voice_enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}
                        >
                          <Check className="size-3.5" />
                        </span>
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
                    />
                    <div className="border-border mt-5 flex justify-end border-t pt-4">
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

function Waveform({ className }: { className?: string }) {
  const bars = [16, 28, 20, 38, 24, 44, 30, 18, 34, 22, 40, 26];

  return (
    <div className={`items-center gap-1 ${className ?? ''}`} aria-hidden="true">
      {bars.map((height, index) => (
        <span
          key={`${height}-${index}`}
          className="bg-accent-ink/25 w-1 rounded-full"
          style={{ height }}
        />
      ))}
    </div>
  );
}
