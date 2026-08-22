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
        <div
          key={g.key}
          className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
        >
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
      ))}
    </div>
  );
}
