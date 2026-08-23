'use client';

import { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-locale';
import { useFormat } from '@/hooks/use-format';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';

/**
 * Dejar que soporte lea tus conversaciones, por un rato.
 *
 * Riverz no puede leerlas. Es una barrera del panel y es a propósito: los
 * mensajes son de TUS clientes, gente que nunca aceptó nada con nosotros. El
 * precio de esa promesa es que ante un «la IA no me contesta» hay que pedir
 * capturas.
 *
 * Esto abre una ventana, y la abre el comercio. Vence sola: no existe la opción
 * de dejarla abierta para siempre, porque un permiso largo es un permiso que
 * nadie se acuerda de sacar.
 */

interface Permiso {
  vigente: boolean;
  expiraEn: string | null;
  motivo: string | null;
}

const HORAS = [24, 72, 168];

export function SupportAccessPanel() {
  const t = useT();
  const fmt = useFormat();
  const fetchWithCsrf = useFetchWithCsrf();
  const [p, setP] = useState<Permiso | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/workspace/soporte', { cache: 'no-store' });
        setP(res.ok ? ((await res.json()) as Permiso) : null);
      } catch {
        setP(null);
      }
    })();
  }, []);

  const cambiar = useCallback(
    async (horas: number | null) => {
      setOcupado(true);
      try {
        const res = await fetchWithCsrf('/api/workspace/soporte', {
          method: horas === null ? 'DELETE' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          ...(horas === null ? {} : { body: JSON.stringify({ horas }) }),
        });
        const json = (await res.json()) as Permiso & { error?: string };
        if (json.error) toast.error(json.error);
        else setP(json);
      } catch {
        toast.error(t('settings.supportError'));
      } finally {
        setOcupado(false);
      }
    },
    [fetchWithCsrf, t],
  );

  if (!p) return null;

  return (
    <div className="max-w-xl space-y-4 rounded-xl border border-border p-5">
      <div className="flex items-start gap-3">
        <LifeBuoy className="mt-0.5 size-4 shrink-0 text-accent-ink" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            {t('settings.supportTitle')}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {p.vigente && p.expiraEn
              ? t('settings.supportOpenUntil', { fecha: fmt.date(p.expiraEn) })
              : t('settings.supportClosed')}
          </p>
        </div>
      </div>

      {p.vigente ? (
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void cambiar(null)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {ocupado && <Loader2 className="size-3.5 animate-spin" />}
          {t('settings.supportRevoke')}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {HORAS.map((h) => (
            <button
              key={h}
              type="button"
              disabled={ocupado}
              onClick={() => void cambiar(h)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {h < 48
                ? t('settings.supportHours', { n: h })
                : t('settings.supportDays', { n: Math.round(h / 24) })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
