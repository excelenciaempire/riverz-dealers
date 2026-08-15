'use client';

import { useCallback, useEffect, useState } from 'react';
import { HelpCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { Button } from '@/components/ui/button';

interface Approval {
  id: string;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  expires_at: string;
}

/**
 * "Esperando tu decisión", arriba de todo en Inicio.
 *
 * La pregunta sale por WhatsApp, pero ese mensaje puede no llegar: sin teléfono
 * cargado, fuera de la ventana de Meta, o con el número equivocado. Cuando eso
 * pasa la decisión quedaba escrita en una tabla que ninguna pantalla leía, y el
 * cliente que informó su pago se quedaba esperando para siempre. Acá se ve, y
 * se resuelve con el mismo `decidir()` que usa la respuesta por chat.
 *
 * Si no hay nada pendiente no se renderiza — igual que "Necesita tu atención".
 */
export function PendingApprovals() {
  const t = useT();
  const format = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [rows, setRows] = useState<Approval[] | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/approvals', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setRows((json.approvals ?? []) as Approval[]);
    } catch {
      /* silencioso: es un aviso, no puede romper el panel */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (id: string, aprobar: boolean) => {
    setDeciding(id);
    // Optimista: la fila se va enseguida. Si el servidor la rechaza vuelve a
    // aparecer con el recargado de abajo.
    setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    try {
      const res = await fetchWithCsrf(`/api/approvals/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aprobar }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) toast.success(json?.message ?? t('common.saved'));
      else toast.error(json?.message ?? t('health.approvalFailed'));
    } catch {
      toast.error(t('health.approvalFailed'));
    } finally {
      setDeciding(null);
      void load();
    }
  };

  if (!rows || rows.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <HelpCircle className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">
          {t('health.approvalsTitle')}
        </h2>
      </div>
      <ul className="mt-2 divide-y divide-border">
        {rows.map((a) => (
          <li key={a.id} className="flex flex-wrap items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{a.title}</p>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{a.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {format.dateTime(a.created_at)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={deciding === a.id}
                onClick={() => decide(a.id, false)}
              >
                {t('health.approvalReject')}
              </Button>
              <Button size="sm" disabled={deciding === a.id} onClick={() => decide(a.id, true)}>
                {deciding === a.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  t('health.approvalApprove')
                )}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
