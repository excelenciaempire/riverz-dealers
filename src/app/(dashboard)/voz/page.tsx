'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { Sparkles, Megaphone, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { VoiceCard } from '@/components/settings/voice-card';
import { VoiceNumberCard } from '@/components/settings/voice-number-card';
import { CallLog } from '@/components/voice/call-log';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';

type AgentRow = { id: string; name: string };

export default function VoicePage() {
  const t = useT();
  const { workspace } = useWorkspace();
  /** Agentes que HOY pueden atender el teléfono (los que se listan abajo). */
  const [agents, setAgents] = useState<AgentRow[]>([]);
  /** Todos los que alguna vez pudieron llamar — el filtro del registro los
   *  necesita para no esconder llamadas de un agente pausado después. */
  const [voiceAgents, setVoiceAgents] = useState<AgentRow[]>([]);

  const workspaceId = workspace?.id;

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data: agentRows } = await supabase
        .from('ai_agents')
        .select('id, name, scope, is_active, ai_agent_channels(channel)')
        .eq('workspace_id', workspaceId)
        .eq('voice_enabled', true)
        .is('deleted_at', null)
        .order('priority', { ascending: false });
      if (cancelled) return;
      const rows = (agentRows ?? []) as Array<{
        id: string;
        name: string;
        scope: string;
        is_active: boolean;
        ai_agent_channels?: Array<{ channel: string }> | null;
      }>;
      setVoiceAgents(rows.map((a) => ({ id: a.id, name: a.name })));
      // Mismo criterio que `pickVoiceAgent`: sólo un agente ACTIVO cuyo
      // alcance cubra las llamadas puede contestar. Antes se listaban
      // todos los que tuvieran la voz encendida, así que aparecían aquí
      // agentes pausados o acotados a otros canales que nunca iban a
      // atender el teléfono.
      setAgents(
        rows
          .filter(
            (a) =>
              a.is_active &&
              (a.scope === 'workspace' ||
                (a.ai_agent_channels ?? []).some((c) => c.channel === 'voice')),
          )
          .map((a) => ({ id: a.id, name: a.name })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('nav.voice')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('voice.cardDesc')}</p>
      </div>

      {/* Self-serve phone number (buy per country) */}
      <VoiceNumberCard />

      {/* Connection + config + compact metrics */}
      <VoiceCard />

      {/* Voice campaigns — call a whole segment with an objective. */}
      <Link
        href="/campanas/voz"
        className="flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-yellow-500" />
          <span className="text-sm font-semibold text-foreground">{t('voice.campaignsTitle')}</span>
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      {/* Voice-enabled agents */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-yellow-500" />
          <h2 className="text-sm font-semibold text-foreground">{t('voice.agentsTitle')}</h2>
        </div>
        {agents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('voice.noAgents')}{' '}
            <Link href="/asistente" className="text-primary underline">
              {t('voice.goToAssistant')}
            </Link>
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span className="text-sm text-foreground">{a.name}</span>
                <Link href="/asistente" className="text-xs text-primary underline">
                  {t('voice.configure')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Call log — filtros, paginado y exportación */}
      <CallLog workspaceId={workspaceId} agents={voiceAgents} />
    </div>
  );
}
