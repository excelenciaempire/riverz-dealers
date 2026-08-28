'use client';

import { useEffect, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import Link from '@/components/i18n/locale-link';
import { useT } from '@/hooks/use-locale';
import { useWorkspace } from '@/hooks/use-workspace';

type Triggers = {
  automations: { id: string; name: string; active: boolean }[];
  deciding: { id: string; name: string }[];
  campaigns: { id: string; name: string; status: string }[];
};

/**
 * Cuándo llama.
 *
 * La pregunta que el comercio hace y que ninguna pantalla contestaba: «¿en qué
 * momento se decide llamar y cuándo no?». Estaba repartida en tres secciones
 * que no se nombran entre sí —el lienzo, el editor del agente y las campañas—
 * y encima el editor mostraba cuatro interruptores de objetivo que parecían
 * decidirlo y no disparaban nada.
 *
 * Acá se ven las reglas de verdad, leídas de la base. Si la lista está vacía,
 * el teléfono no va a sonar solo: eso también es una respuesta, y es la que
 * más falta hacía.
 */
export function WhenItCalls() {
  const t = useT();
  const { workspace } = useWorkspace();
  const [data, setData] = useState<Triggers | null>(null);

  useEffect(() => {
    if (!workspace?.id) return;
    let cancelado = false;
    (async () => {
      const res = await fetch(`/api/voice/triggers?workspace_id=${workspace.id}`, {
        cache: 'no-store',
      });
      if (!res.ok || cancelado) return;
      const json = (await res.json()) as Triggers;
      if (!cancelado) setData(json);
    })();
    return () => {
      cancelado = true;
    };
  }, [workspace?.id]);

  if (!data) return null;

  const vacio =
    data.automations.length === 0 &&
    data.deciding.length === 0 &&
    data.campaigns.length === 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('voice.whenTitle')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('voice.whenHint')}</p>
        </div>
        <Link
          href="/automatizaciones"
          className="flex shrink-0 items-center gap-1 text-xs text-accent-ink hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('voice.whenNewRule')}
        </Link>
      </div>

      {vacio ? (
        // Decirlo derecho: no es un estado vacío decorativo, es la diferencia
        // entre «configuré todo y no pasa nada» y saber por qué.
        <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
          {t('voice.whenNothing')}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {data.automations.map((a) => (
            <Row
              key={a.id}
              label={a.name}
              kind={t('voice.whenAutomation')}
              muted={!a.active}
              badge={a.active ? undefined : t('voice.whenPaused')}
              href={`/automatizaciones/${a.id}`}
            />
          ))}
          {data.deciding.map((a) => (
            <Row
              key={a.id}
              label={t('voice.whenAgentDecides', { name: a.name })}
              kind={t('voice.whenAssistant')}
              href="/asistente"
            />
          ))}
          {data.campaigns.map((c) => (
            <Row
              key={c.id}
              label={c.name}
              kind={t('voice.whenCampaign')}
              muted={c.status !== 'running'}
              badge={c.status === 'running' ? undefined : t('voice.whenPaused')}
              href="/voz/campanas"
            />
          ))}
        </ul>
      )}

      {/* El botón de la bandeja no es una regla, pero es la forma más común de
          hacer la primera llamada: callarlo dejaba pensar que sin automatización
          no hay manera de llamar.
          Sólo cuando YA hay reglas: en vacío el propio cartel de arriba termina
          con «o llamá a mano desde la bandeja», así que esta línea decía lo
          mismo dos veces seguidas. */}
      {!vacio && (
        <p className="mt-3 text-xs text-muted-foreground">{t('voice.whenManual')}</p>
      )}
    </div>
  );
}

function Row({
  label,
  kind,
  href,
  muted,
  badge,
}: {
  label: string;
  kind: string;
  href: string;
  muted?: boolean;
  badge?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm text-foreground">{label}</span>
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {kind}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badge && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
              {badge}
            </span>
          )}
          <ChevronRight
            className={`h-4 w-4 ${muted ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}
          />
        </span>
      </Link>
    </li>
  );
}
