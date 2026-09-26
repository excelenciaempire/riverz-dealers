'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { Badge } from '@/components/ui/badge';
import { Linea, MarcoDeTelefono, etiquetaDeCanal, type ItemChat } from '@/components/ai/chat-de-prueba';
import { PruebasGuardadas } from '@/components/ai/pruebas-guardadas';
import type { Propuestas } from '@/lib/ai/sesiones-de-prueba';
import { cn } from '@/lib/utils';

/**
 * Todo el feedback del comercio en un lugar, para mirarlo: lo que el equipo
 * comentó en las conversaciones reales de la bandeja y en las pruebas, con las
 * mejoras que aprobó el equipo de Riverz. Las mejoras se proponen y se aplican
 * en el panel de plataforma.
 */

interface FeedbackReal {
  id: string;
  canal: string | null;
  voto: 'bien' | 'mal' | null;
  nota: string;
  captura: ItemChat[];
  created_at: string;
}

interface Lote {
  id: string;
  propuestas: Propuestas | null;
  created_at: string;
}

export function PanelDeFeedback({ nombreComercio }: { nombreComercio: string | null }) {
  const t = useT();
  const [vista, setVista] = useState<'reales' | 'pruebas'>('reales');
  const [pruebaElegida, setPruebaElegida] = useState<string | null>(null);

  return (
    <div className="min-w-0 space-y-4">
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
  const [datos, setDatos] = useState<{ feedback: FeedbackReal[]; lotes: Lote[] } | null>(null);

  useEffect(() => {
    fetch('/api/ai/feedback', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((json) => setDatos({ feedback: json?.feedback ?? [], lotes: json?.lotes ?? [] }));
  }, []);

  if (!datos) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }
  if (datos.feedback.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">{t('assistant.feedbackVacio')}</p>;
  }

  const reglas = datos.lotes.flatMap((l) => l.propuestas?.reglas ?? []);

  return (
    <div className="space-y-5">
      {reglas.length > 0 ? (
        <section className="space-y-2">
          <p className="text-foreground text-sm font-medium">{t('assistant.pruebasMejoras')}</p>
          {reglas.map((r, i) => (
            <div key={i} className="border-border space-y-1 rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-foreground text-sm font-medium">{r.titulo}</p>
                <Badge variant={r.aplicada ? 'default' : 'outline'}>
                  {r.aplicada ? t('assistant.pruebasAplicada') : t('assistant.pruebasEnRevision')}
                </Badge>
              </div>
              <p className="text-foreground text-xs whitespace-pre-wrap">{r.hacer}</p>
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {datos.feedback.map((f) => (
          <article key={f.id} className="space-y-2">
            <p className="text-muted-foreground truncate text-xs">
              {etiquetaDeCanal(t, f.canal)} ·{' '}
              {format.dateTime(f.created_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
            <MarcoDeTelefono titulo={nombreComercio || t('templates.yourBusiness')} alto="h-[340px]">
              {f.captura.map((it, i) => (
                <Linea key={i} it={it} feedback={i === f.captura.length - 1 ? { voto: f.voto, nota: f.nota } : null} />
              ))}
            </MarcoDeTelefono>
            {!f.captura.length ? <p className="text-muted-foreground text-xs">{f.nota}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
