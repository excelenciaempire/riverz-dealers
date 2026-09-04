'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { toast } from 'sonner';
import {
  AudioLines,
  Ban,
  ChevronRight,
  Loader2,
  Megaphone,
  PhoneCall,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { VoiceCard } from '@/components/settings/voice-card';
import { VoiceNumberCard } from '@/components/settings/voice-number-card';
import { CallLog } from '@/components/voice/call-log';
import { VoiceAnalytics } from '@/components/voice/voice-analytics';
import { VoiceStatusLine } from '@/components/voice/voice-status-line';
import { WhenItCalls } from '@/components/voice/when-it-calls';
import { VoiceAgentProfiles } from '@/components/voice/voice-agent-profiles';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useVoiceReadiness } from '@/hooks/use-voice-readiness';
import { useWorkspace } from '@/hooks/use-workspace';
import { useT } from '@/hooks/use-locale';

type Usage = {
  minutes_used: number;
  minutes_limit: number;
  spend_usd: number;
  calls: number;
};

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

  const [usage, setUsage] = useState<Usage | null>(null);
  /** Sólo para el bloque de parada del final. */
  const [parado, setParado] = useState(false);
  const [parando, setParando] = useState(false);
  /**
   * Todos los que alguna vez pudieron llamar, incluidos los pausados. Es una
   * pregunta DISTINTA de «quién puede atender» (que la contesta readiness):
   * el filtro del registro los necesita para no esconder las llamadas de un
   * agente que se pausó después de hacerlas.
   */
  const [enElRegistro, setEnElRegistro] = useState<
    { id: string; name: string }[]
  >([]);

  const workspaceId = workspace?.id;
  const {
    readiness,
    loading: cargandoEstado,
    reload: releerEstado,
  } = useVoiceReadiness(workspaceId);

  /** El freno y el consumo. Se relee tras guardar, o quedan mintiendo hasta el F5. */
  const recargar = useCallback(async () => {
    if (!workspaceId) return;
    const [cn, us] = await Promise.all([
      fetch(`/api/voice/connection?workspace_id=${workspaceId}`, {
        cache: 'no-store',
      }),
      fetch(`/api/voice/usage?workspace_id=${workspaceId}`, {
        cache: 'no-store',
      }),
    ]);
    if (cn.ok) {
      const json = (await cn.json()) as {
        config?: { kill_switch?: boolean } | null;
      };
      setParado(!!json.config?.kill_switch);
    }
    if (us.ok) setUsage((await us.json()) as Usage);
  }, [workspaceId]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  // Quién puede ATENDER ya no se calcula acá: lo dice `readiness`. Esta copia
  // del criterio se olvidaba de nada, pero eran cuatro copias sueltas y la
  // canónica estaba mal — la de acá sólo servía para que las dos pantallas
  // discreparan. Queda la lista del filtro del registro, que es otra pregunta.
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('ai_agents')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .eq('voice_enabled', true)
        .is('deleted_at', null)
        .order('priority', { ascending: false });
      if (!cancelled) {
        setEnElRegistro((data ?? []) as { id: string; name: string }[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function frenar(valor: boolean) {
    if (!workspaceId) return;
    setParando(true);
    try {
      const actual = await fetch(
        `/api/voice/connection?workspace_id=${workspaceId}`,
        {
          cache: 'no-store',
        }
      ).then((r) => r.json());
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
    <div className="mx-auto max-w-5xl space-y-9">
      <header className="border-border bg-card relative overflow-hidden rounded-2xl border shadow-sm">
        <div className="bg-accent/10 pointer-events-none absolute -top-20 -right-16 size-64 rounded-full blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex items-start gap-3.5">
            <span className="bg-accent text-accent-foreground grid size-11 shrink-0 place-items-center rounded-2xl shadow-sm">
              <PhoneCall className="size-5" />
            </span>
            <div>
              <h1 className="app-page-title">{t('nav.voice')}</h1>
              <p className="text-muted-foreground mt-1 max-w-lg text-[13px]">
                {t('voice.pageDesc')}
              </p>
              {usage && usage.calls > 0 && (
                <p className="text-muted-foreground border-border bg-background/70 mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]">
                  <AudioLines className="text-accent-ink size-3" />
                  {t('voice.usageThisMonth', {
                    minutes: String(usage.minutes_used),
                  })}
                  {usage.minutes_limit > 0
                    ? ` ${t('voice.usageOf', { limit: String(usage.minutes_limit) })}`
                    : ''}
                  {usage.spend_usd > 0 && ` · $${usage.spend_usd.toFixed(2)}`}
                </p>
              )}
            </div>
          </div>
          {(readiness?.ready || !!usage?.calls || parado) && (
            <Button
              variant={parado ? 'default' : 'outline'}
              size="sm"
              onClick={() => frenar(!parado)}
              disabled={parando}
              className="shrink-0"
            >
              {parando ? (
                <Loader2 className="size-4 animate-spin" />
              ) : parado ? (
                t('voice.stoppedResume')
              ) : (
                <>
                  <Ban className="mr-1 size-3.5" />
                  {t('voice.stopAction')}
                </>
              )}
            </Button>
          )}
        </div>

        <div className="border-border/70 border-t">
          {parado ? (
            <p className="bg-destructive/5 text-destructive flex flex-wrap items-center gap-x-2 gap-y-1 px-5 py-3 text-sm sm:px-6">
              <Ban className="size-4 shrink-0" />
              <span className="font-medium">{t('voice.stopped')}</span>
              <span className="text-muted-foreground text-xs">
                {t('voice.stopHint')}
              </span>
            </p>
          ) : (
            <VoiceStatusLine
              readiness={readiness}
              loading={cargandoEstado}
              className="rounded-none border-0 px-5 py-3 sm:px-6"
            />
          )}
        </div>
      </header>

      {/* ── Armarlo. Se hace una vez. ── */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-foreground text-sm font-semibold">
              {t('voice.setupGroup')}
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t('voice.voiceSetupHint')}
            </p>
          </div>
        </div>

        <VoiceNumberCard />

        <VoiceAgentProfiles
          workspaceId={workspaceId}
          onSaved={() => {
            void releerEstado();
          }}
        />

        {/* Cuándo llama va DESPUÉS de quién atiende y antes del comportamiento:
            es el orden en que se piensa —tengo número, tengo quien atienda,
            ahora cuándo suena— y era justo el eslabón que no estaba. */}
        <div className="grid items-start gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <WhenItCalls />
          <VoiceCard
            onSaved={() => {
              recargar();
              releerEstado();
            }}
          />
        </div>
      </section>

      {/* ── Mirarlo. Se hace todas las semanas. ── */}
      <section className="space-y-4 pb-8">
        <div className="app-section-head">
          <h2 className="text-foreground text-sm font-semibold">
            {t('voice.activityGroup')}
          </h2>
          {/* Campañas era una tarjeta entera para un link. */}
          <Link
            href="/voz/campanas"
            className="text-accent-ink flex items-center gap-1 text-xs hover:underline"
          >
            <Megaphone className="h-3.5 w-3.5" />
            {t('voice.campaignsTitle')}
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* No dibuja nada mientras no haya llamadas: una grilla de ceros en una
            cuenta recién armada es ruido con forma de tablero. */}
        <VoiceAnalytics />

        <CallLog workspaceId={workspaceId} agents={enElRegistro} />
      </section>
    </div>
  );
}
