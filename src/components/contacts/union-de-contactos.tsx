'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Link2, Link2Off, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { useT } from '@/hooks/use-locale';
import { channelLabel } from '@/lib/channels/display';
import type { Channel } from '@/types';

interface Hermano {
  id: string;
  name: string | null;
  channel: Channel;
  phone: string | null;
  email: string | null;
}

/**
 * "Esta persona también te escribe por…", y el botón para decir que no.
 *
 * La unión entre canales existía desde hacía meses y no se veía en ninguna
 * pantalla. El agente leía el historial del cliente unificado —sus compras,
 * sus notas, su resumen— y el comercio no tenía forma de saber que dos fichas
 * eran una sola. Cuando la unión está bien, es la mitad de lo que hace bueno
 * al agente; cuando está mal, le muestra a una persona la dirección y los
 * pedidos de otra. Las dos cosas merecían ser visibles.
 *
 * Separar corta la unión Y la bloquea. Sin el bloqueo el próximo mensaje las
 * vuelve a juntar —el teléfono sigue coincidiendo— y el botón no serviría de
 * nada.
 */
export function UnionDeContactos({ contactId }: { contactId: string }) {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [hermanos, setHermanos] = useState<Hermano[] | null>(null);
  const [bloqueada, setBloqueada] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/contacts/${contactId}/union`, { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      setHermanos(j.hermanos ?? []);
      setBloqueada(Boolean(j.bloqueada));
    } catch {
      /* silencioso: es información de más, no puede romper la ficha */
    }
  }, [contactId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function cambiar(separar: boolean) {
    setGuardando(true);
    try {
      const res = await fetchWithCsrf(`/api/contacts/${contactId}/union`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ separar }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = await res.json();
      setHermanos(j.hermanos ?? []);
      setBloqueada(Boolean(j.bloqueada));
    } catch {
      toast.error(t('contacts.unionFailed'));
    } finally {
      setGuardando(false);
    }
  }

  // Sin nada que contar, no ocupa lugar: la mayoría de los contactos no están
  // unidos a nada y una fila que siempre dice "no" enseña a no mirarla.
  if (!hermanos || (hermanos.length === 0 && !bloqueada)) return null;

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-start gap-2">
        {bloqueada ? (
          <Link2Off className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Link2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">
            {bloqueada ? t('contacts.unionSeparated') : t('contacts.unionTitle')}
          </p>
          {hermanos.length > 0 ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hermanos
                .map((h) => `${h.name?.trim() || channelLabel(h.channel, t)}`)
                .join(' · ')}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={guardando}
          onClick={() => cambiar(!bloqueada)}
        >
          {guardando ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : bloqueada ? (
            t('contacts.unionRejoin')
          ) : (
            t('contacts.unionSeparate')
          )}
        </Button>
      </div>
    </div>
  );
}
