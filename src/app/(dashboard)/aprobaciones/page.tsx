'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, ShieldQuestion } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';

/**
 * /aprobaciones — lo que el agente preparó y espera tu sí.
 *
 * El aviso sale por WhatsApp y esa sigue siendo la vía rápida. Pero el WhatsApp
 * puede no llegar —sin teléfono cargado, con la plantilla rechazada, con el
 * número mal escrito— y hasta acá esa solicitud se quedaba esperando sin
 * ningún lugar donde verla: la clienta ya había escuchado "te confirmo en
 * breve" y del otro lado nadie sabía que le debía una respuesta.
 *
 * Es la misma función que ejecuta el "SI" por WhatsApp, así que las dos vías no
 * pueden divergir y una decisión contestada dos veces se ejecuta una sola.
 */

interface Aprobacion {
  id: string;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  expires_at: string;
}

export default function AprobacionesPage() {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [items, setItems] = useState<Aprobacion[] | null>(null);
  const [decidiendo, setDecidiendo] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/approvals', { cache: 'no-store' });
      const json = await res.json();
      setItems(res.ok ? (json.approvals ?? []) : []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const decidir = async (id: string, decision: 'aprobada' | 'rechazada') => {
    setDecidiendo(id);
    try {
      const res = await fetchWithCsrf(`/api/approvals/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || json?.ok === false) throw new Error(json?.message);
      // Se saca de la lista y se muestra lo que de verdad pasó: "aprobado" no
      // es lo mismo que "hecho" — el reembolso puede haberlo rechazado Shopify,
      // y enterarse por la clienta sería lo peor.
      setItems((prev) => (prev ?? []).filter((x) => x.id !== id));
      toast.success(json?.message ?? t('approvals.done'));
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t('approvals.failed'));
    } finally {
      setDecidiendo(null);
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
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t('approvals.title')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('approvals.subtitle')}</p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-border py-14 text-center">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm text-muted-foreground">{t('approvals.empty')}</p>
        </div>
      ) : (
        items.map((a) => (
          <article key={a.id} className="rounded-xl border border-border p-4">
            <div className="flex items-start gap-2">
              <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{a.title}</p>
                {/* El cuerpo viene con saltos de línea: importe, motivo, qué
                    pasa si aceptás. Se respetan — es lo que hace que la
                    decisión se pueda tomar sin abrir nada más. */}
                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {format.date(a.created_at)}
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={decidiendo === a.id}
                onClick={() => decidir(a.id, 'rechazada')}
              >
                {t('approvals.reject')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={decidiendo === a.id}
                onClick={() => decidir(a.id, 'aprobada')}
              >
                {decidiendo === a.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  t('approvals.approve')
                )}
              </Button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
