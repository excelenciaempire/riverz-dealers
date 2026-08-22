'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, PackageOpen } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';

/**
 * /devoluciones — lo que pidieron devolver o cambiar.
 *
 * El agente abre el caso desde la conversación con el pedido, el motivo y las
 * fotos que la persona ya mandó. Acá se decide. Sin esta pantalla, esa
 * información entraba y no salía: el comercio resolvía de memoria por chat y no
 * quedaba rastro de cuántas devoluciones hubo ni por qué.
 *
 * Lo que espera una decisión va primero, aunque sea más viejo: es una lista de
 * trabajo, no un registro histórico.
 */

type Estado = 'abierta' | 'aprobada' | 'rechazada' | 'recibida' | 'resuelta';

interface Devolucion {
  id: string;
  order_number: string | null;
  kind: 'devolucion' | 'cambio';
  reason: string | null;
  customer_note: string | null;
  photos: string[];
  status: Estado;
  resolution: string | null;
  created_at: string;
  contacts?: { name: string | null; email: string | null; phone: string | null } | null;
}

/** Qué se puede hacer desde cada estado. Un caso rechazado o resuelto está
 *  cerrado: reabrirlo se hace abriendo otro, no volviendo atrás. */
const SIGUIENTES: Record<Estado, Estado[]> = {
  abierta: ['aprobada', 'rechazada'],
  aprobada: ['recibida', 'rechazada'],
  recibida: ['resuelta'],
  rechazada: [],
  resuelta: [],
};

const COLOR: Record<Estado, string> = {
  abierta: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  aprobada: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
  recibida: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
  resuelta: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rechazada: 'bg-muted text-muted-foreground',
};

export default function DevolucionesPage() {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [items, setItems] = useState<Devolucion[] | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/devoluciones');
      const json = await res.json();
      setItems(res.ok ? (json.returns ?? []) : []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const mover = async (id: string, status: Estado) => {
    setGuardando(id);
    try {
      const res = await fetchWithCsrf('/api/devoluciones', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error();
      // Se recarga en vez de parchear en memoria: el orden depende del estado,
      // así que la fila se mueve de lugar y dejarla donde estaba confunde.
      await cargar();
    } catch {
      toast.error(t('returns.saveFailed'));
    } finally {
      setGuardando(null);
    }
  };

  if (items === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t('returns.title')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('returns.subtitle')}</p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border py-14 text-center">
          <PackageOpen className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('returns.empty')}</p>
        </div>
      ) : (
        items.map((d) => (
          <article key={d.id} className="rounded-xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${COLOR[d.status]}`}>
                {t(`returns.status.${d.status}`)}
              </span>
              <span className="text-sm font-medium text-foreground">
                {t(d.kind === 'cambio' ? 'returns.kindExchange' : 'returns.kindReturn')}
                {d.order_number ? ` · #${d.order_number}` : ''}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {format.date(d.created_at)}
              </span>
            </div>

            <p className="mt-2 text-sm text-foreground">
              {d.contacts?.name || d.contacts?.email || d.contacts?.phone || t('returns.noName')}
            </p>
            {d.reason ? (
              <p className="mt-1 text-sm text-muted-foreground">{d.reason}</p>
            ) : null}
            {/* Lo que escribió la clienta, sin resumir. El motivo de arriba lo
                redactó el agente y a veces la palabra exacta importa. */}
            {d.customer_note ? (
              <p className="mt-1 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                {d.customer_note}
              </p>
            ) : null}

            {d.photos?.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {d.photos.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt=""
                      loading="lazy"
                      className="h-16 w-16 rounded-lg border border-border object-cover"
                    />
                  </a>
                ))}
              </div>
            ) : null}

            {d.resolution ? (
              <p className="mt-2 text-xs text-muted-foreground">{d.resolution}</p>
            ) : null}

            {SIGUIENTES[d.status].length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {SIGUIENTES[d.status].map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={s === 'rechazada' ? 'outline' : 'default'}
                    disabled={guardando === d.id}
                    onClick={() => mover(d.id, s)}
                  >
                    {t(`returns.action.${s}`)}
                  </Button>
                ))}
              </div>
            ) : null}
          </article>
        ))
      )}
    </div>
  );
}
