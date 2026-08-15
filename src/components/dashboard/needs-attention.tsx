'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/i18n/locale-link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

interface Issue {
  kind: string;
  severity: 'critical' | 'warning';
  count: number;
  detail?: string | null;
  href: string;
}

/**
 * "Esto necesita tu atención", arriba de todo en Inicio.
 *
 * Cada línea es un problema que ya ocurrió y que el comercio puede resolver, con
 * el link al lugar donde se resuelve. Si no hay nada, no se renderiza: un
 * cartel de "todo bien" permanente entrena a no mirar la zona, y entonces el
 * día que aparezca algo tampoco se va a mirar.
 */
export function NeedsAttention() {
  const t = useT();
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

  if (!issues || issues.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
        <h2 className="text-sm font-semibold text-foreground">
          {t('health.needsAttention')}
        </h2>
      </div>
      <ul className="mt-2 space-y-1.5">
        {issues.map((issue) => (
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
                {issue.detail && (
                  <span className="text-muted-foreground"> · {issue.detail}</span>
                )}
              </span>
              <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
