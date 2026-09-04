'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AudioLines,
  Check,
  ChevronDown,
  Loader2,
  Mic2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
  const [agentName, setAgentName] = useState('');
  const [voice, setVoice] = useState<VoiceState | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [newVoice, setNewVoice] = useState<VoiceState>(() => ({
    ...initialVoiceState(),
    voice_enabled: true,
  }));
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<VoiceAgent | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  function openCreate() {
    setName('');
    setNewVoice({ ...initialVoiceState(), voice_enabled: true });
    setCreating(true);
  }

  function closeCreate() {
    if (saving) return;
    setCreating(false);
  }

  async function create() {
    if (!name.trim() || !workspaceId || saving) return;
    if (!newVoice.voice_id) {
      toast.error(t('voice.voiceAgentChooseVoice'));
      return;
    }
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
          voice_id: newVoice.voice_id,
          voice_greeting: newVoice.voice_greeting.trim() || null,
          voice_system_prompt: newVoice.voice_system_prompt.trim() || null,
          voice_objectives: newVoice.voice_objectives,
          voice_max_call_seconds: newVoice.voice_max_call_seconds,
          voice_calling_hours: newVoice.voice_calling_hours,
          voice_max_retries: newVoice.voice_max_retries,
          voice_retry_delay_minutes: newVoice.voice_retry_delay_minutes,
          voice_accepts_inbound: newVoice.voice_accepts_inbound,
          voice_transfer_number: newVoice.voice_transfer_number.trim() || null,
          voice_max_concurrent_calls: newVoice.voice_max_concurrent_calls,
          voice_reserved_inbound_slots: newVoice.voice_reserved_inbound_slots,
          voice_max_campaign_concurrent: newVoice.voice_max_campaign_concurrent,
          voice_dedupe_minutes: newVoice.voice_dedupe_minutes,
          voice_monthly_minutes_limit: newVoice.voice_monthly_minutes_limit,
          voice_recording_enabled: newVoice.voice_recording_enabled,
          voice_recording_disclosure: newVoice.voice_recording_disclosure,
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
      setOpenId(null);
      setVoice(null);
      toast.success(t('voice.voiceAgentCreated'));
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }

  async function save(agent: VoiceAgent, announce = true): Promise<boolean> {
    if (!voice || saving) return false;
    setSaving(true);
    try {
      const res = await fetchWithCsrf(`/api/ai/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: agentName.trim() || agent.name,
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
          voice_transfer_number: voice.voice_transfer_number.trim() || null,
          voice_max_concurrent_calls: voice.voice_max_concurrent_calls,
          voice_reserved_inbound_slots: voice.voice_reserved_inbound_slots,
          voice_max_campaign_concurrent: voice.voice_max_campaign_concurrent,
          voice_dedupe_minutes: voice.voice_dedupe_minutes,
          voice_monthly_minutes_limit: voice.voice_monthly_minutes_limit,
          voice_recording_enabled: voice.voice_recording_enabled,
          voice_recording_disclosure: voice.voice_recording_disclosure,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        agent?: VoiceAgent;
        error?: string;
      } | null;
      if (!res.ok || !json?.agent) {
        toast.error(json?.error ?? t('voice.voiceAgentSaveFailed'));
        return false;
      }
      setAgents((current) =>
        current.map((item) => (item.id === agent.id ? json.agent! : item))
      );
      if (announce) toast.success(t('voice.voiceAgentSaved'));
      onSaved?.();
      return true;
    } catch {
      toast.error(t('voice.voiceAgentSaveFailed'));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function removeAgent() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await fetchWithCsrf(`/api/ai/agents/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const json = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        toast.error(json?.error ?? t('voice.voiceAgentDeleteFailed'));
        return;
      }
      setAgents((current) =>
        current.filter((agent) => agent.id !== deleteTarget.id)
      );
      setUsageByAgent((current) => {
        const next = { ...current };
        delete next[deleteTarget.id];
        return next;
      });
      if (openId === deleteTarget.id) {
        setOpenId(null);
        setAgentName('');
        setVoice(null);
      }
      setDeleteTarget(null);
      toast.success(t('voice.voiceAgentDeleted'));
      onSaved?.();
    } catch {
      toast.error(t('voice.voiceAgentDeleteFailed'));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="border-border bg-card overflow-hidden rounded-2xl border shadow-sm">
      <div className="border-border/70 bg-muted/20 border-b px-5 py-4">
        <div className="flex items-start justify-between gap-4">
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
              variant="outline"
              onClick={openCreate}
              className="relative shrink-0"
            >
              <Plus className="mr-1 size-3.5" />
              {t('voice.voiceAgentCreate')}
            </Button>
          )}
        </div>
      </div>

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
          <Button type="button" className="mt-4" onClick={openCreate}>
            <Plus className="mr-1 size-4" />
            {t('voice.voiceAgentFirst')}
          </Button>
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
                    setAgentName(agent.name);
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
                    <div className="border-border bg-muted/25 mb-5 grid gap-3 rounded-xl border p-3.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <label className="block">
                        <span className="text-foreground mb-1.5 block text-xs font-medium">
                          {t('voice.voiceAgentNameLabel')}
                        </span>
                        <Input
                          value={agentName}
                          onChange={(event) => setAgentName(event.target.value)}
                          maxLength={80}
                          className="bg-background h-9"
                        />
                      </label>
                      <div className="flex h-9 items-center justify-between gap-4 sm:justify-end">
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
                    </div>
                    <VoiceSettings
                      value={voice}
                      onChange={setVoice}
                      language={agent.language ?? locale}
                      workspaceId={workspaceId}
                      agentId={agent.id}
                      showReadiness={false}
                      onBeforeTestCall={() => save(agent, false)}
                      testCallDisabled={saving}
                    />
                    <div className="border-border mt-5 flex items-center justify-between gap-3 border-t pt-4">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(agent)}
                        disabled={saving}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="mr-1 size-3.5" />
                        {t('voice.voiceAgentDelete')}
                      </Button>
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

      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!open) closeCreate();
        }}
      >
        <DialogContent
          className="border-border bg-card text-foreground grid max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-3xl lg:max-w-4xl"
          showCloseButton={false}
        >
          <div className="border-border flex items-start justify-between gap-4 border-b px-4 py-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <span className="bg-accent/15 text-accent-ink grid size-9 shrink-0 place-items-center rounded-xl">
                <Mic2 className="size-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-foreground text-base font-semibold">
                  {t('voice.voiceAgentNewTitle')}
                </DialogTitle>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t('voice.voiceAgentDialogHint')}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeCreate}
              disabled={saving}
              aria-label={t('common.close')}
              className="text-muted-foreground hover:bg-accent hover:text-foreground rounded-lg p-1.5 transition-colors disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mx-auto max-w-3xl space-y-6">
              <label className="block">
                <span className="text-foreground mb-1.5 block text-sm font-medium">
                  {t('voice.voiceAgentNameLabel')}
                </span>
                <Input
                  className="bg-background text-foreground h-10"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t('voice.voiceAgentName')}
                  maxLength={80}
                  autoFocus
                />
              </label>

              <VoiceSettings
                value={newVoice}
                onChange={setNewVoice}
                language={locale}
                workspaceId={workspaceId}
                showReadiness={false}
                showTestCall={false}
              />
            </div>
          </div>

          <div className="border-border bg-card/60 flex flex-wrap items-center justify-end gap-2 border-t px-4 py-4 sm:px-6">
            {!newVoice.voice_id && (
              <p className="text-muted-foreground mr-auto text-xs">
                {t('voice.voiceAgentChooseVoice')}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={closeCreate}
              disabled={saving}
            >
              {t('voice.voiceAgentCancel')}
            </Button>
            <Button
              type="button"
              onClick={create}
              disabled={saving || !name.trim() || !newVoice.voice_id}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('voice.voiceAgentCreate')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
          <div className="flex items-start gap-3">
            <span className="bg-destructive/10 text-destructive grid size-10 shrink-0 place-items-center rounded-xl">
              <Trash2 className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base">
                {t('voice.voiceAgentDeleteTitle')}
              </DialogTitle>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('voice.voiceAgentDeleteHint', {
                  name: deleteTarget?.name ?? '',
                })}
              </p>
            </div>
          </div>

          {!!deleteTarget && (usageByAgent[deleteTarget.id] ?? 0) > 0 && (
            <p className="border-border bg-muted/30 text-muted-foreground rounded-xl border px-3.5 py-3 text-xs">
              {t('voice.voiceAgentDeleteLinked', {
                count: String(usageByAgent[deleteTarget.id]),
              })}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t('voice.voiceAgentCancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={removeAgent}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('voice.voiceAgentDeleteConfirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
