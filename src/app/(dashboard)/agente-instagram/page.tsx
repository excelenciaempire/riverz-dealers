'use client';

import { useState } from 'react';
import { MessageSquareReply, Send } from 'lucide-react';
import { InstagramIcon } from '@/components/layout/instagram-icon';
import {
  ApprovalsQueue,
  AttributedOrders,
  CommentsSection,
  ConnectionPill,
  OutreachSection,
  ProactiveLimits,
  useIgConnected,
  useProactiveSettings,
} from '@/components/instagram/sections';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

type Tab = 'comments' | 'outreach';

/**
 * Ventas por Instagram — DOS cosas, nunca las dos a la vez en pantalla.
 *
 *   Comentarios   — qué pasa cuando alguien comenta en tus posts.
 *   Conversaciones— salir tú a buscar a quién escribirle.
 *
 * Antes era una sola página con todo apilado y se leía como un panel de
 * control: el comercio no distinguía dónde terminaba una función y empezaba la
 * otra. Ahora se elige una y solo se ve esa. Lo que es común a ambas —lo que
 * espera aprobación, los límites y los resultados— vive fuera de la pestaña,
 * porque manda sobre las dos.
 *
 * Responder los DMs NO está aquí: eso es el Asistente IA, y mezclarlo era
 * justo la confusión que había que quitar.
 */
export default function VentasInstagramPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('comments');
  const settings = useProactiveSettings();
  const connected = useIgConnected();

  const TABS: { v: Tab; label: string; icon: React.ReactNode }[] = [
    {
      v: 'comments',
      label: t('igAgent.tabComments'),
      icon: <MessageSquareReply className="h-4 w-4" />,
    },
    {
      v: 'outreach',
      label: t('igAgent.tabOutreach'),
      icon: <Send className="h-4 w-4" />,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#5b51d8] via-[#c13584] to-[#f58529] text-white shadow-sm">
            <InstagramIcon className="h-5 w-5" />
          </span>
          <h1 className="app-page-title">{t('igAgent.title')}</h1>
        </div>
        <ConnectionPill connected={connected} />
      </header>

      {/* Lo que espera tu decisión, antes de cualquier pestaña. */}
      <ApprovalsQueue />

      <div className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1">
        {TABS.map((x) => (
          <button
            key={x.v}
            type="button"
            onClick={() => setTab(x.v)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors',
              tab === x.v
                ? 'bg-accent text-accent-ink'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {x.icon}
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'comments' ? (
        <CommentsSection settings={settings} />
      ) : (
        <OutreachSection />
      )}

      {/* Comunes a las dos pestañas: mandan sobre todo lo que sale solo. */}
      <ProactiveLimits settings={settings} />
      <AttributedOrders />
    </div>
  );
}
