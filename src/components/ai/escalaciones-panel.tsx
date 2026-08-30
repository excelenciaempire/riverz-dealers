'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { cn } from '@/lib/utils';
import type { NeedsHumanReason } from '@/types';

/**
 * Los casos que el asistente dejó en manos de una persona.
 *
 * Vive al lado de "Lo que no supo contestar" porque son las dos caras de lo
 * mismo: dónde el asistente llegó hasta donde podía. La diferencia es qué se
 * hace con cada una — un hueco se cierra cargando conocimiento, un caso
 * escalado se cierra atendiéndolo, y por eso cada fila lleva al hilo.
 *
 * Sin agrupar: dos personas con un envío mal enviado son dos clientes
 * esperando, no un problema.
 */

interface Caso {
  id: string;
  canal: string | null;
  motivo: string | null;
  cuando: string;
  pendiente: boolean;
  cliente: string | null;
  resumen: string | null;
}

/**
 * Por qué se plantó, en palabras que se entienden sin saber cómo funciona.
 *
 * Tipado contra `NeedsHumanReason` a propósito. Escrito como
 * `Record<string, string>` se quedó atrás sin que nada fallara: tenía un
 * `webchat_handoff` que no existe en ningún lado —el chat web escribe
 * `visitor_request`— y le faltaban seis motivos reales, así que seis clases de
 * escalada se mostraban como "otro motivo" en el panel que existe justamente
 * para distinguirlas.
 */
const MOTIVOS: Record<NeedsHumanReason, string> = {
  escalation_keyword: 'Pidió una persona',
  escalate_after_messages: 'Se agotaron las respuestas del asistente',
  flow_handoff: 'Lo derivó un flujo',
  reply_burst_guard: 'Demasiadas respuestas seguidas',
  approval_unnotified: 'Una cancelación o reembolso sin avisar',
  answer_gap: 'El asistente no supo la respuesta',
  comprobante_sin_pedido: 'Mandó el comprobante y no aparece el pedido',
  visitor_request: 'Apretó "hablar con una persona" en el chat web',
  mensaje_no_recibido: 'Manda algo que el canal no nos entrega',
  comment_sin_moderar: 'Meta no dejó responder ni ocultar el comentario',
  ia_sin_respuesta: 'El asistente no llegó a responder',
  ia_caida: 'Se prometió una persona y el asistente no pudo',
  problema_detectado: 'Un problema en curso',
};

export function EscalacionesPanel() {
  const t = useT();
  const fmt = useFormat();
  const [casos, setCasos] = useState<Caso[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetch('/api/escalaciones')
      .then((r) => (r.ok ? r.json() : { casos: [] }))
      .then((j) => {
        if (!cancelado) setCasos(j.casos ?? []);
      })
      .catch(() => {
        if (!cancelado) setCasos([]);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  if (casos === null) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (casos.length === 0) {
    return (
      <div className="py-8 text-center">
        <CheckCircle2 className="mx-auto size-5 text-emerald-500/70" />
        <p className="mt-2 text-[13px] text-muted-foreground">
          {t('assistant.escalacionesVacio')}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {casos.map((c) => (
        <li key={c.id}>
          <Link
            href={`/bandeja?c=${c.id}`}
            className="flex items-start gap-3 py-2.5 hover:bg-accent/20"
          >
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium text-foreground">
                  {c.cliente || t('assistant.escalacionesSinNombre')}
                </span>
                {/* Sólo lo que nadie abrió: una lista entera en rojo no
                    distingue nada. */}
                {c.pendiente && (
                  <span className="shrink-0 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:text-red-400">
                    {t('inbox.needsHumanBadge')}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'mt-0.5 block truncate text-[11px]',
                  c.pendiente ? 'text-muted-foreground' : 'text-muted-foreground/70',
                )}
              >
                {(c.motivo && (MOTIVOS as Record<string, string>)[c.motivo]) ||
                  t('assistant.escalacionesOtroMotivo')}
                {c.resumen ? ` · ${c.resumen.replace(/\s+/g, ' ').slice(0, 90)}` : ''}
              </span>
            </span>
            <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground/70">
              {fmt.dateTime(c.cuando)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
