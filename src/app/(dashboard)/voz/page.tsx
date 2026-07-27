'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { PhoneCall, PhoneIncoming, Sparkles, Loader2, Mic, Megaphone, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { VoiceCard } from '@/components/settings/voice-card';
import { VoiceNumberCard } from '@/components/settings/voice-number-card';
import { CallDetail } from '@/components/voice/call-detail';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import type { VoiceCall, VoiceCallOutcome, VoiceCallStatus } from '@/types';

const STATUS_KEY: Record<VoiceCallStatus, string> = {
  queued: 'voice.statusQueued',
  dialing: 'voice.statusDialing',
  in_progress: 'voice.statusInProgress',
  completed: 'voice.statusCompleted',
  failed: 'voice.statusFailed',
  no_answer: 'voice.statusNoAnswer',
  busy: 'voice.statusBusy',
  voicemail: 'voice.statusVoicemail',
  canceled: 'voice.statusCanceled',
};

const OUTCOME_KEY: Record<VoiceCallOutcome, string> = {
  confirmed: 'voice.outcomeConfirmed',
  cancelled_by_customer: 'voice.outcomeCancelled',
  rescheduled: 'voice.outcomeRescheduled',
  recovered: 'voice.outcomeRecovered',
  declined: 'voice.outcomeDeclined',
  callback_requested: 'voice.outcomeCallback',
  opt_out: 'voice.outcomeOptOut',
  no_outcome: 'voice.outcomeNone',
};

type CallRow = VoiceCall & { contact?: { id: string; name: string | null; phone: string | null } };

function fmtDuration(sec: number | null): string {
  if (!sec || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VoicePage() {
  const t = useT();
  const { workspace } = useWorkspace();
  const format = useFormat();
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCall, setSelectedCall] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace?.id) return;
    setLoading(true);
    try {
      const supabase = createClient();
      // Mismo criterio que `pickVoiceAgent`: sólo un agente ACTIVO cuyo
      // alcance cubra las llamadas puede contestar. Antes se listaban
      // todos los que tuvieran la voz encendida, así que aparecían aquí
      // agentes pausados o acotados a otros canales que nunca iban a
      // atender el teléfono.
      const { data: agentRows } = await supabase
        .from('ai_agents')
        .select('id, name, scope, is_active, ai_agent_channels(channel)')
        .eq('workspace_id', workspace.id)
        .eq('voice_enabled', true)
        .is('deleted_at', null)
        .order('priority', { ascending: false });
      const usable = ((agentRows ?? []) as Array<{
        id: string;
        name: string;
        scope: string;
        is_active: boolean;
        ai_agent_channels?: Array<{ channel: string }> | null;
      }>).filter(
        (a) =>
          a.is_active &&
          (a.scope === 'workspace' ||
            (a.ai_agent_channels ?? []).some((c) => c.channel === 'voice')),
      );
      setAgents(usable.map((a) => ({ id: a.id, name: a.name })));

      const res = await fetch(`/api/voice/calls?workspace_id=${workspace.id}&limit=50`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const { calls: rows } = (await res.json()) as { calls: CallRow[] };
        setCalls(rows);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace?.id]);

  useEffect(() => {
    // El registro se carga al entrar/refrescar la página (sin auto-refresco).
    load();
  }, [load]);

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

      {/* Call log */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">{t('voice.callLogTitle')}</h2>
        {loading ? (
          <div className="flex items-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('voice.noCalls')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">{t('voice.colContact')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('voice.colStatus')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('voice.outcome')}</th>
                  <th className="pb-2 pr-4 font-medium">{t('voice.duration')}</th>
                  <th className="pb-2 font-medium">{t('voice.colWhen')}</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedCall(c.id)}
                    className="cursor-pointer border-t border-border/60 hover:bg-muted/40"
                  >
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        {c.direction === 'inbound' ? (
                          <PhoneIncoming className="h-3.5 w-3.5 text-yellow-500" />
                        ) : (
                          <PhoneCall className="h-3.5 w-3.5 text-yellow-500" />
                        )}
                        {c.contact?.name || c.phone}
                        {c.recording_url && <Mic className="h-3 w-3 text-muted-foreground" />}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {(c.status === 'dialing' || c.status === 'in_progress') && (
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                        )}
                        {t(STATUS_KEY[c.status])}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {c.outcome ? t(OUTCOME_KEY[c.outcome]) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{fmtDuration(c.duration_seconds)}</td>
                    <td className="py-2 text-muted-foreground">
                      {format.dateTime(new Date(c.created_at))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CallDetail callId={selectedCall} onClose={() => setSelectedCall(null)} />
    </div>
  );
}
