'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Layers, Loader2 } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';

/**
 * "Esto es el mismo producto."
 *
 * Quien vende en más de una plataforma tiene cada producto repetido: una fila
 * por canal, cada una con su conocimiento. En la práctica una queda llena y las
 * otras vacías —nadie escribe la misma información dos veces— y el agente
 * contesta distinto según por dónde le escriban.
 *
 * El panel sólo aparece cuando hay algo que unir. Una pantalla vacía que dice
 * "no hay duplicados" es una pantalla que el comercio abre una vez y no vuelve
 * a mirar; ésta se muestra sola el día que aparecen.
 *
 * Se propone y confirma el comercio: unir dos productos distintos hace que el
 * agente cotice el precio equivocado, que es peor que el problema que esto
 * resuelve. Lo único que se une solo es el SKU idéntico, y eso pasa en la
 * sincronización sin que nadie tenga que mirar nada.
 */

interface Grupo {
  key: string;
  masterId: string;
  masterTitle: string;
  motivo: 'sku' | 'titulo';
  confianza: number;
  hijos: Array<{ id: string; title: string; platform: string; price: number | null }>;
}

export function UnifyPanel() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [uniendo, setUniendo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/products/unificar');
      const json = await res.json();
      setGrupos(res.ok ? (json.grupos ?? []) : []);
    } catch {
      setGrupos([]);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const unir = async (g: Grupo) => {
    setUniendo(g.masterId);
    try {
      const res = await fetchWithCsrf('/api/products/unificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ master_id: g.masterId, hijos: g.hijos.map((h) => h.id) }),
      });
      if (!res.ok) throw new Error();
      setGrupos((prev) => (prev ?? []).filter((x) => x.masterId !== g.masterId));
      toast.success(t('unify.done'));
    } catch {
      toast.error(t('unify.failed'));
    } finally {
      setUniendo(null);
    }
  };

  const descartar = async (g: Grupo) => {
    setUniendo(g.masterId);
    try {
      const res = await fetchWithCsrf('/api/products/unificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismiss: g.key }),
      });
      if (!res.ok) throw new Error();
      setGrupos((prev) => (prev ?? []).filter((x) => x.key !== g.key));
    } catch {
      toast.error(t('unify.failed'));
    } finally {
      setUniendo(null);
    }
  };

  // Nada que unir: el panel no existe. No hay estado vacío que mostrar.
  if (grupos === null || grupos.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('unify.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('unify.hint')}</p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {grupos.map((g) => (
          <div key={g.masterId} className="rounded-lg border border-border px-3 py-2.5">
            <p className="text-sm font-medium text-foreground">{g.masterTitle}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {t(g.motivo === 'sku' ? 'unify.bySku' : 'unify.byTitle')}
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {g.hijos.map((h) => (
                <li key={h.id} className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{h.platform}</span> · {h.title}
                  {h.price != null ? ` · $${h.price}` : ''}
                </li>
              ))}
            </ul>
            {/* Se dice qué pasa con los precios ANTES de unir: es la duda que
                cualquiera tiene, y descubrirla después sería un motivo para
                deshacerlo todo. */}
            <p className="mt-1.5 text-[11px] text-muted-foreground">{t('unify.pricesKept')}</p>
            <div className="mt-2 flex justify-end gap-2">
              {/* Poder decir que no es lo que hace que el panel se pueda leer.
                  Sin esta salida, la misma propuesta equivocada vuelve para
                  siempre, el comercio aprende a ignorarlo, y el día que la
                  propuesta es buena tampoco la mira. */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={uniendo === g.masterId}
                onClick={() => descartar(g)}
              >
                {t('unify.notSame')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={uniendo === g.masterId}
                onClick={() => unir(g)}
              >
                {uniendo === g.masterId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  t('unify.merge')
                )}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
