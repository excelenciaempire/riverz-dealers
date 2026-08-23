'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, HelpCircle, Loader2 } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';

/**
 * Lo que el agente no supo contestar.
 *
 * Es la mitad del valor de tener un agente y hasta acá se perdía: la
 * conversación quedaba marcada para una persona, el caso se resolvía a mano, y
 * la PREGUNTA no quedaba en ningún lado. Así se arregla el caso y nunca el
 * agujero, y la misma pregunta vuelve la semana que viene.
 *
 * Va agrupado y ordenado por cuánta gente preguntó, porque esa lista es
 * accionable y la lista en bruto no: doce personas preguntando lo mismo son UN
 * párrafo que falta escribir, no doce tareas.
 */

interface Hueco {
  key: string;
  question: string;
  veces: number;
  ultima: string;
  missing: string | null;
}

export function AnswerGapsPanel() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [gaps, setGaps] = useState<Hueco[] | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);
  // Cuál se está respondiendo. Uno por vez: contestar bien una pregunta es
  // trabajo de leer y escribir, y abrir cinco formularios a la vez no ayuda.
  const [abierto, setAbierto] = useState<string | null>(null);
  const [productos, setProductos] = useState<Array<{ id: string; title: string }>>([]);
  const [productoId, setProductoId] = useState('');
  const [respuesta, setRespuesta] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/huecos');
      const json = await res.json();
      setGaps(res.ok ? (json.gaps ?? []) : []);
    } catch {
      setGaps([]);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El catálogo se pide una sola vez y sólo cuando hace falta elegir: la
  // pantalla se abre para MIRAR la lista, y traer el catálogo entero para eso
  // sería un viaje que casi siempre se tira.
  useEffect(() => {
    if (!abierto || productos.length > 0) return;
    fetch('/api/shopify/products')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const lista = (j?.products ?? []) as Array<{ id: string; title: string }>;
        setProductos(lista);
        if (lista.length === 1) setProductoId(lista[0].id);
      })
      .catch(() => {});
  }, [abierto, productos.length]);

  const resolver = async (key: string) => {
    setMarcando(key);
    try {
      const res = await fetchWithCsrf('/api/huecos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) throw new Error();
      setGaps((prev) => (prev ?? []).filter((g) => g.key !== key));
    } catch {
      toast.error(t('gaps.saveFailed'));
    } finally {
      setMarcando(null);
    }
  };

  const responder = async (g: Hueco) => {
    if (!productoId || respuesta.trim().length < 2) return;
    setEnviando(true);
    try {
      const res = await fetchWithCsrf('/api/huecos/responder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: g.key,
          product_id: productoId,
          question: g.question,
          answer: respuesta.trim(),
        }),
      });
      if (!res.ok) throw new Error();
      setGaps((prev) => (prev ?? []).filter((x) => x.key !== g.key));
      setAbierto(null);
      setRespuesta('');
      toast.success(t('gaps.answered'));
    } catch {
      toast.error(t('gaps.saveFailed'));
    } finally {
      setEnviando(false);
    }
  };

  if (gaps === null) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (gaps.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-8 text-center">
        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm text-muted-foreground">{t('gaps.empty')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {gaps.map((g) => (
        <div key={g.key} className="rounded-lg border border-border px-3 py-2.5">
          <div className="flex items-start gap-3">
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{g.question}</p>
              {g.missing ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{g.missing}</p>
              ) : null}
              {/* Cuánta gente preguntó lo mismo. Es lo que decide por dónde
                  empezar: una pregunta repetida doce veces vale doce veces más
                  que una suelta. */}
              {g.veces > 1 ? (
                <p className="mt-0.5 text-[11px] font-medium text-foreground">
                  {t('gaps.times', { n: String(g.veces) })}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setAbierto(abierto === g.key ? null : g.key);
                  setRespuesta('');
                }}
              >
                {t('gaps.answer')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={marcando === g.key}
                onClick={() => resolver(g.key)}
              >
                {t('gaps.markDone')}
              </Button>
            </div>
          </div>

          {/* Cargar la respuesta acá mismo. Sin esto la lista era un reproche:
              el comercio leía qué no supo el agente y tenía que ir a buscar el
              producto, abrirlo y pegar el texto a mano. La mitad no lo hacía y
              la misma pregunta volvía a la semana. */}
          {abierto === g.key ? (
            <div className="mt-2 space-y-2 border-t border-border pt-2">
              <select
                value={productoId}
                onChange={(e) => setProductoId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
              >
                <option value="">{t('gaps.pickProduct')}</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <textarea
                value={respuesta}
                onChange={(e) => setRespuesta(e.target.value)}
                rows={3}
                placeholder={t('gaps.answerPlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/40"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  disabled={enviando || !productoId || respuesta.trim().length < 2}
                  onClick={() => responder(g)}
                >
                  {t('gaps.saveAnswer')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
