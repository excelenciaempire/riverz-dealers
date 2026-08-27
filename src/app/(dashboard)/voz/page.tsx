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
 * Se ordena por CUÁNDO se entra a cada cosa, no por tema. Armar el teléfono
 * —número, quién atiende, cómo se comporta— se hace una vez; mirar cómo vienen
 * saliendo las llamadas se hace todas las semanas. Eran siete tarjetas iguales
 * apiladas, así que el que entraba a ver el registro pasaba por tres de
 * configuración para llegar.
 *
 * Cada cosa que falta se dice DONDE se arregla: si no hay agente con voz, lo
 * dice «Quién atiende»; si no hay número, la tarjeta del número. Hubo un cartel
 * de estado arriba que repetía esas mismas frases palabra por palabra — dos
 * veces lo mismo en una pantalla es una forma de confundir.
 *
 * El freno de emergencia vive en el encabezado. Estaba al fondo, después del
 * registro: un botón de pánico al que hay que llegar scrolleando no es un botón
 * de pánico. Y entre los interruptores se veía igual que «grabar llamadas».
 *
 * La columna va angosta como en `/voz/campanas` y en Comentarios: a lo ancho de
 * una pantalla grande, una fila de interruptores se lee como un formulario de
 * impuestos.
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
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="app-page-title">{t('nav.voice')}</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {t('voice.pageDesc')}
            {/* El consumo, en gris y sólo cuando ya hubo llamadas: en una
                cuenta nueva un «0 min» no le dice nada a nadie. */}
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
        {/* Arriba y a mano. Al fondo de la página, después del registro, era un
            freno de emergencia al que había que llegar scrolleando. */}
        <Button
          variant={parado ? 'default' : 'outline'}
          size="sm"
          onClick={() => frenar(!parado)}
          disabled={parando}
        >
          {parando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : parado ? (
            t('voice.stoppedResume')
          ) : (
            <>
              <Ban className="mr-1 h-3.5 w-3.5" />
              {t('voice.stopAction')}
            </>
          )}
        </Button>
      </header>

      {parado && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          <Ban className="h-4 w-4 shrink-0" />
          {t('voice.stopped')}
          <span className="text-xs text-muted-foreground">{t('voice.stopHint')}</span>
        </p>
      )}

      {/* ── Armarlo. Se hace una vez. ── */}
      <section className="space-y-4">
        <div className="app-section-head">
          <h2 className="text-sm font-semibold text-foreground">{t('voice.setupGroup')}</h2>
        </div>

        <VoiceNumberCard />

        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground">{t('voice.whoAnswers')}</h3>
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
        </div>

        <VoiceCard onSaved={recargar} />
      </section>

      {/* ── Mirarlo. Se hace todas las semanas. ── */}
      <section className="space-y-4">
        <div className="app-section-head">
          <h2 className="text-sm font-semibold text-foreground">{t('voice.activityGroup')}</h2>
          {/* Campañas era una tarjeta entera para un link. */}
          <Link
            href="/voz/campanas"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Megaphone className="h-3.5 w-3.5" />
            {t('voice.campaignsTitle')}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* No dibuja nada mientras no haya llamadas: una grilla de ceros en una
            cuenta recién armada es ruido con forma de tablero. */}
        <VoiceAnalytics />

        <CallLog workspaceId={workspaceId} agents={voiceAgents} />
      </section>
    </div>
  );
}
