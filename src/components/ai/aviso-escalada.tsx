'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useT } from '@/hooks/use-locale';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';

/**
 * A QUÉ NÚMERO LLEGA UN CASO URGENTE.
 *
 * El asistente ya avisaba por WhatsApp cuando dejaba un caso en manos de una
 * persona, pero a qué número iba a caer no se veía en ningún lado. Se
 * descubría el día que hubiera un caso urgente, que es el peor día para
 * descubrirlo — y medido el 2026-08-28, 8 de 10 cuentas no tenían destino y
 * nadie lo sabía.
 *
 * Dos cosas y nada más: el número, y un botón para comprobar que llega.
 */
export function AvisoEscalada() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [telefono, setTelefono] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch('/api/escalaciones/aviso');
        const j = await r.json();
        if (vivo) setTelefono(j.telefono ?? null);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const probar = useCallback(async () => {
    setEnviando(true);
    try {
      const r = await fetchWithCsrf('/api/escalaciones/aviso', { method: 'POST' });
      const j = await r.json();
      if (j.ok) toast.success(t('assistant.avisoEnviado'));
      else toast.error(j.error ?? t('assistant.avisoSinDestino'));
    } finally {
      setEnviando(false);
    }
  }, [fetchWithCsrf, t]);

  if (cargando) return null;

  if (!telefono) {
    return (
      <p className="text-[11px] text-amber-700 dark:text-amber-400">
        {t('assistant.avisoSinDestino')}
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <span>
        {t('assistant.avisoDestino')}{' '}
        <span className="font-medium text-foreground tabular-nums">
          +{telefono}
        </span>
      </span>
      <button
        type="button"
        onClick={probar}
        disabled={enviando}
        className="rounded-md border border-border px-2 py-0.5 text-foreground transition-colors hover:bg-accent disabled:opacity-50"
      >
        {t('assistant.avisoProbar')}
      </button>
    </div>
  );
}
