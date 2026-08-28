'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
import { useFetchWithCsrf } from '@/lib/api/fetch-with-csrf';
import { issueDetailText } from '@/lib/health/detail';
import type { IssueKind } from '@/lib/health/issues';

interface Issue {
  kind: IssueKind;
  severity: 'critical' | 'warning';
  count: number;
  detail?: string | null;
  href: string;
  refId: string;
  lastAt: string | null;
}

/**
 * "Esto necesita tu atención", arriba de todo en Inicio.
 *
 * Sólo llega acá lo que el comercio puede resolver — el filtro está en el
 * servidor (`collectMerchantIssues`); lo que es nuestro se ve entero en /admin.
 * Cada línea lleva al lugar exacto: la corrida que falló, el chat del cliente,
 * la plantilla rechazada. Si no hay nada, no se renderiza: un cartel de "todo
 * bien" permanente entrena a no mirar la zona, y entonces el día que aparezca
 * algo tampoco se va a mirar.
 *
 * "Ocultar" se guarda en la cuenta, no en el navegador, y con la fecha de lo
 * que se ocultó: si el problema vuelve a pasar, el aviso vuelve.
 */
export function NeedsAttention() {
  const t = useT();
  const fetchWithCsrf = useFetchWithCsrf();
  const [issues, setIssues] = useState<Issue[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/health/issues', { cache: 'no-store' });
        const json = await res.json();
        if (!cancelled && res.ok) setIssues((json.issues ?? []) as Issue[]);
      } catch {
        /* silencioso: es un aviso, no puede romper el panel */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ocultar = useCallback(
    async (lista: Issue[]) => {
      // Optimista: la tarjeta se va enseguida. Es un aviso, no una operación;
      // esperar al servidor para que desaparezca un cartel se siente roto.
      setIssues((prev) => (prev ?? []).filter((i) => !lista.includes(i)));
      try {
        await fetchWithCsrf('/api/health/issues/ocultar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            issues: lista.map((i) => ({
              kind: i.kind,
              refId: i.refId,
              lastAt: i.lastAt,
            })),
          }),
        });
      } catch {
        /* si no se pudo guardar, vuelve en la próxima carga */
      }
    },
    [fetchWithCsrf],
  );

  if (!issues || issues.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
        <h2 className="text-sm font-semibold text-foreground">
          {t('health.needsAttention')}
        </h2>
        <button
          type="button"
          onClick={() => void ocultar(issues)}
          aria-label={t('health.dismiss')}
          title={t('health.dismiss')}
          className="ml-auto -mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <ul className="mt-2 space-y-1.5">
        {issues.map((issue) => {
          const detail = issueDetailText(issue.kind, issue.detail, t);
          return (
            <li key={`${issue.kind}-${issue.href}`}>
              <Link
                href={issue.href}
                className="group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-amber-500/10"
              >
                <span
                  className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    issue.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500',
                  )}
                />
                <span className="min-w-0 flex-1 text-xs leading-snug text-foreground">
                  {t(`health.${issue.kind}`, { n: issue.count })}
                  {detail && <span className="text-muted-foreground"> · {detail}</span>}
                </span>
                <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
