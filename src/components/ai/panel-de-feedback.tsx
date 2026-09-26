'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Linea, MarcoDeTelefono, etiquetaDeCanal, type ItemChat } from '@/components/ai/chat-de-prueba';
import { PruebasGuardadas, TarjetaDeRegla } from '@/components/ai/pruebas-guardadas';
import type { Propuestas } from '@/lib/ai/sesiones-de-prueba';
import { cn } from '@/lib/utils';

/**
 * Todo el feedback del comercio en un lugar: lo que el equipo marcó en las
 * conversaciones reales de la bandeja y en las pruebas. De acá sale la
 * propuesta de mejoras —reglas que se aplican con un clic o solas— y lo que no
 * se arregla con una regla va a la cola del equipo de Riverz.
 */

interface FeedbackReal {
  id: string;
  canal: string | null;
  voto: 'bien' | 'mal' | null;
  nota: string;
  captura: ItemChat[];
  estado: 'nuevo' | 'usado' | 'descartado';
  created_at: string;
}

interface Lote {
  id: string;
  propuestas: Propuestas | null;
  automatico: boolean;
  created_at: string;
}

export function PanelDeFeedback({ nombreComercio }: { nombreComercio: string | null }) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [vista, setVista] = useState<'reales' | 'pruebas'>('reales');
  const [pruebaElegida, setPruebaElegida] = useState<string | null>(null);
  const [automaticas, setAutomaticas] = useState(false);

  useEffect(() => {
    fetch('/api/ai/feedback', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { automaticas?: boolean } | null) => setAutomaticas(j?.automaticas === true))
      .catch(() => {});
  }, []);

  async function cambiarAutomaticas(valor: boolean) {
    setAutomaticas(valor);
    const res = await fetchWithCsrf('/api/ai/feedback/ajustes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ automaticas: valor }),
    }).catch(() => null);
    if (!res?.ok) {
      setAutomaticas(!valor);
      toast.error(t('assistant.probarFallo'));
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="bg-muted inline-flex w-fit rounded-lg p-0.5">
          {(['reales', 'pruebas'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVista(v)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                vista === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {v === 'reales' ? t('assistant.feedbackReales') : t('assistant.feedbackPruebas')}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={automaticas} onCheckedChange={(v) => void cambiarAutomaticas(v)} />
          <span className="text-foreground">{t('assistant.feedbackAutomaticas')}</span>
        </label>
      </div>
      {automaticas ? <p className="text-muted-foreground text-xs">{t('assistant.feedbackAutomaticasHint')}</p> : null}

      {vista === 'reales' ? (
        <FeedbackDeConversaciones nombreComercio={nombreComercio} />
      ) : (
        <PruebasGuardadas elegida={pruebaElegida} onElegir={setPruebaElegida} nombreComercio={nombreComercio} />
      )}
    </div>
  );
}

function FeedbackDeConversaciones({ nombreComercio }: { nombreComercio: string | null }) {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [datos, setDatos] = useState<{
    feedback: FeedbackReal[];
    lotes: Lote[];
    agentes: Array<{ id: string; name: string }>;
  } | null>(null);
  const [proponiendo, setProponiendo] = useState(false);

  const cargar = useCallback(async () => {
    const res = await fetch('/api/ai/feedback', { cache: 'no-store' }).catch(() => null);
    const json = res?.ok ? await res.json() : null;
    setDatos({ feedback: json?.feedback ?? [], lotes: json?.lotes ?? [], agentes: json?.agentes ?? [] });
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const nuevos = (datos?.feedback ?? []).filter((f) => f.estado === 'nuevo').length;

  async function proponer() {
    setProponiendo(true);
    try {
      const res = await fetchWithCsrf('/api/ai/feedback/mejorar', { method: 'POST' });
      const json = (await res.json().catch(() => null)) as { sin_feedback?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(json?.error ?? '');
      if (json?.sin_feedback) toast.success(t('assistant.pruebasSinCambios'));
      await cargar();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t('assistant.probarFallo'));
    } finally {
      setProponiendo(false);
    }
  }

  if (!datos) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  const nombreDe = (agenteId: string | null) =>
    agenteId ? (datos.agentes.find((a) => a.id === agenteId)?.name ?? '—') : t('assistant.pruebasTodosLosAsistentes');
  const lote = datos.lotes[0] ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {datos.feedback.length === 0 ? t('assistant.feedbackVacio') : t('assistant.feedbackNuevos', { n: nuevos })}
        </p>
        <Button size="sm" onClick={() => void proponer()} disabled={proponiendo || nuevos === 0}>
          {proponiendo ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {t('assistant.pruebasProponer')}
        </Button>
      </div>

      {lote?.propuestas && (lote.propuestas.reglas.length > 0 || lote.propuestas.plataforma.length > 0) ? (
        <section className="space-y-3">
          <p className="text-foreground text-sm font-medium">
            {t('assistant.pruebasMejoras')}
            <span className="text-muted-foreground font-normal">
              {' '}
              · {format.dateTime(lote.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          </p>
          {lote.propuestas.reglas.map((r, i) => (
            <TarjetaDeRegla
              key={`${lote.id}-${i}`}
              urlAplicar={`/api/ai/feedback/lotes/${lote.id}/aplicar`}
              indice={i}
              regla={r}
              agente={r.accion === 'crear' ? nombreDe(r.agente_id) : null}
              onAplicada={(p) =>
                setDatos((prev) =>
                  prev ? { ...prev, lotes: prev.lotes.map((l) => (l.id === lote.id ? { ...l, propuestas: p } : l)) } : prev
                )
              }
            />
          ))}
          {lote.propuestas.plataforma.map((p, i) => (
            <div key={i} className="border-border space-y-1.5 rounded-xl border p-3">
              <Badge variant="secondary">{t('assistant.pruebasParaPlataforma')}</Badge>
              <p className="text-foreground text-sm">{p.problema}</p>
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {datos.feedback.map((f) => (
          <article key={f.id} className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground truncate">
                {etiquetaDeCanal(t, f.canal)} ·{' '}
                {format.dateTime(f.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <Badge variant={f.estado === 'nuevo' ? 'default' : 'outline'}>
                {f.estado === 'nuevo' ? t('assistant.feedbackEstadoNuevo') : t('assistant.feedbackEstadoUsado')}
              </Badge>
            </div>
            <MarcoDeTelefono titulo={nombreComercio || t('templates.yourBusiness')} alto="h-[340px]">
              {f.captura.map((it, i) => (
                <Linea
                  key={i}
                  it={it}
                  feedback={i === f.captura.length - 1 ? { voto: f.voto, nota: f.nota } : null}
                />
              ))}
            </MarcoDeTelefono>
            {!f.captura.length ? (
              <p className="text-muted-foreground flex items-center gap-1 text-xs">
                {f.voto === 'mal' ? <ThumbsDown className="size-3" /> : <ThumbsUp className="size-3" />}
                {f.nota}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
