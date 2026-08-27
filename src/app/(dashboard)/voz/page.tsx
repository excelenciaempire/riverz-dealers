'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { toast } from 'sonner';
import { Loader2, Megaphone, ChevronRight, Ban } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { VoiceCard } from '@/components/settings/voice-card';
import { VoiceNumberCard } from '@/components/settings/voice-number-card';
import { CallLog } from '@/components/voice/call-log';
import { VoiceAnalytics } from '@/components/voice/voice-analytics';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';

type AgentRow = { id: string; name: string };
type Usage = { minutes_used: number; minutes_limit: number; spend_usd: number; calls: number };

/**
 * Llamadas.
 *
 * Antes esta pantalla eran dos tarjetas de configuración —«Número de teléfono»
 * y «Voz / Teléfono»— y había que deducir, leyendo interruptores, si la cuenta
 * podía llamar. No podía: le faltaba un agente con la voz activada, y eso no
 * estaba escrito en ningún lado. Un comercio armaba todo y no pasaba nada.
 *
 * Ahora cada cosa que falta se dice DONDE se arregla: si no hay agente con
 * voz, lo dice «Quién atiende»; si no hay número, la tarjeta del número. Hubo
 * un cartel de estado arriba que repetía esas mismas frases palabra por
 * palabra — dos veces lo mismo en una pantalla es una forma de confundir.
 *
 * El freno de emergencia sale de la lista de interruptores: es un botón de
 * pánico, no una preferencia, y estaba dibujado igual que «grabar llamadas».
 */
export default function VoicePage() {
  const t = useT();
  const { workspace } = useWorkspace();
  const fetchWithCsrf = useFetchWithCsrf();

  const [agents, setAgents] = useState<AgentRow[]>([]);
  /** Todos los que alguna vez pudieron llamar — el filtro del registro los
   *  necesita para no esconder llamadas de un agente pausado después. */
  const [voiceAgents, setVoiceAgents] = useState<AgentRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  /** Sólo para el bloque de parada del final. */
  const [parado, setParado] = useState(false);
  const [parando, setParando] = useState(false);

  const workspaceId = workspace?.id;

  /** El freno y el consumo. Se relee tras guardar, o quedan mintiendo hasta el F5. */
  const recargar = useCallback(async () => {
    if (!workspaceId) return;
    const [cn, us] = await Promise.all([
      fetch(`/api/voice/connection?workspace_id=${workspaceId}`, { cache: 'no-store' }),
      fetch(`/api/voice/usage?workspace_id=${workspaceId}`, { cache: 'no-store' }),
    ]);
    if (cn.ok) {
      const json = (await cn.json()) as { config?: { kill_switch?: boolean } | null };
      setParado(!!json.config?.kill_switch);
    }
    if (us.ok) setUsage((await us.json()) as Usage);
  }, [workspaceId]);

  useEffect(() => {
    recargar();
  }, [recargar]);

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
      // Mismo criterio que `pickVoiceAgent`: sólo un agente ACTIVO cuyo alcance
      // cubra las llamadas puede atender. Listar los demás prometía un teléfono
      // que nunca iba a sonar.
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

  async function frenar(valor: boolean) {
    if (!workspaceId) return;
    setParando(true);
    try {
      const actual = await fetch(`/api/voice/connection?workspace_id=${workspaceId}`, {
        cache: 'no-store',
      }).then((r) => r.json());
      const res = await fetchWithCsrf('/api/voice/connection', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          config: { ...(actual.config ?? {}), kill_switch: valor },
        }),
      });
      if (!res.ok) {
        toast.error(t('voice.callFailed'));
        return;
      }
      await recargar();
    } finally {
      setParando(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('nav.voice')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('voice.pageDesc')}
          {/* Lo único del cartel viejo que no se repetía en ningún lado. */}
          {usage && usage.calls > 0 && (
            <>
              {' · '}
              {t('voice.usageThisMonth', { minutes: String(usage.minutes_used) })}
              {usage.minutes_limit > 0
                ? ` ${t('voice.usageOf', { limit: String(usage.minutes_limit) })}`
                : ''}
              {usage.spend_usd > 0 && ` · $${usage.spend_usd.toFixed(2)}`}
            </>
          )}
        </p>
      </div>

      {/* El número propio del espacio de trabajo (compra + papeleo regulatorio). */}
      <VoiceNumberCard />

      {/* Quién atiende. Es la mitad de la respuesta a «¿por qué no llama?», y
          antes estaba al final de la pantalla como un listado más. */}
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">{t('voice.whoAnswers')}</h2>
        {agents.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t('voice.whoAnswersNone')}{' '}
            <Link href="/asistente" className="text-primary underline">
              {t('voice.whoAnswersTurnOn')}
            </Link>
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
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

      <VoiceCard onSaved={recargar} />

      <Link
        href="/voz/campanas"
        className="flex items-center justify-between rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-yellow-500" />
          <span className="text-sm font-semibold text-foreground">{t('voice.campaignsTitle')}</span>
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </Link>

      <VoiceAnalytics />

      <CallLog workspaceId={workspaceId} agents={voiceAgents} />

      {/* El freno de emergencia, al final y con su propia forma. Entre los
          interruptores se veía igual que «grabar llamadas», y no es lo mismo
          elegir si se guarda el audio que cortarle el teléfono a la cuenta. */}
      <section
        className={`rounded-xl border p-4 ${
          parado ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-card'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Ban
                className={`h-4 w-4 ${parado ? 'text-destructive' : 'text-muted-foreground'}`}
              />
              {parado ? t('voice.stopped') : t('voice.stopTitle')}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('voice.stopHint')}</p>
          </div>
          <Button
            variant={parado ? 'outline' : 'destructive'}
            size="sm"
            onClick={() => frenar(!parado)}
            disabled={parando}
          >
            {parando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : parado ? (
              t('voice.stoppedResume')
            ) : (
              t('voice.stopAction')
            )}
          </Button>
        </div>
      </section>
    </div>
  );
}
