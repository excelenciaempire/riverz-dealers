'use client';

import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Inbox,
  PhoneOutgoing,
  Plus,
  Workflow,
} from 'lucide-react';
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
      const res = await fetch(
        `/api/voice/triggers?workspace_id=${workspace.id}`,
        {
          cache: 'no-store',
        }
      );
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
    <section className="border-border bg-card overflow-hidden rounded-2xl border shadow-sm">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <Workflow className="size-4" />
          </span>
          <div>
            <h3 className="text-foreground text-sm font-semibold">
              {t('voice.whenTitle')}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t('voice.whenHint')}
            </p>
          </div>
        </div>
        {!vacio && (
          <Link
            href="/automatizaciones"
            className="text-accent-ink hover:bg-accent/10 flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors"
          >
            <Plus className="size-3.5" />
            {t('voice.whenNewRule')}
          </Link>
        )}
      </div>

      {vacio ? (
        <div className="px-4 pt-5 pb-4 sm:px-5 sm:pb-5">
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
            <FlowNode icon={Inbox} label={t('voice.whenFlowContact')} />
            <span className="bg-border h-px w-full" />
            <FlowNode icon={Workflow} label={t('voice.whenFlowRule')} muted />
            <span className="bg-border h-px w-full" />
            <FlowNode
              icon={PhoneOutgoing}
              label={t('voice.whenFlowCall')}
              muted
            />
          </div>
          <p className="text-muted-foreground mt-4 text-sm">
            {t('voice.whenNothing')}
          </p>
          <Link
            href="/automatizaciones"
            className="border-border bg-background hover:bg-muted text-foreground mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors"
          >
            <Plus className="size-3.5" />
            {t('voice.whenNewRule')}
          </Link>
        </div>
      ) : (
        <ul className="border-border mt-4 divide-y border-t px-4 sm:px-5">
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
        <p className="border-border bg-muted/15 text-muted-foreground flex items-center gap-2 border-t px-4 py-3 text-xs sm:px-5">
          <Inbox className="size-3.5 shrink-0" />
          {t('voice.whenManual')}
        </p>
      )}
    </section>
  );
}

function FlowNode({
  icon: Icon,
  label,
  muted,
}: {
  icon: typeof Inbox;
  label: string;
  muted?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <span
        className={`grid size-9 place-items-center rounded-full border ${
          muted
            ? 'border-border bg-muted/30 text-muted-foreground'
            : 'border-accent/30 bg-accent/10 text-accent-ink'
        }`}
      >
        <Icon className="size-4" />
      </span>
      <span className="text-muted-foreground truncate text-[10px] font-medium">
        {label}
      </span>
    </span>
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
          <span className="text-foreground block truncate text-sm">
            {label}
          </span>
          <span className="text-muted-foreground text-[11px] tracking-wide uppercase">
            {kind}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {badge && (
            <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-[10px]">
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
