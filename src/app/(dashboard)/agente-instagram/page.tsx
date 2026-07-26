'use client';

import { InstagramIcon } from '@/components/layout/instagram-icon';
import {
  AttributedOrders,
  ConnectionPill,
  OutreachSection,
  OutreachToggle,
  ProactiveLimits,
  useIgConnected,
  useProactiveSettings,
} from '@/components/instagram/sections';
import { useT } from '@/hooks/use-locale';

/**
 * Ventas por Instagram — SALIR A BUSCAR. Describes un objetivo y el agente
 * elige a quién escribirle primero, con qué, y mide lo que vendió.
 *
 * Responder comentarios ya no está aquí: tiene su propia entrada en el menú,
 * dentro de Servicio al cliente, porque atender a quien te habla y salir a
 * buscar a alguien son dos trabajos distintos. Y responder los DMs es el
 * Asistente IA. Tres cosas, tres lugares.
 */
export default function VentasInstagramPage() {
  const t = useT();
  const settings = useProactiveSettings();
  const connected = useIgConnected();

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


      <OutreachToggle settings={settings} />

      <OutreachSection />

      <ProactiveLimits settings={settings} />
      <AttributedOrders />
    </div>
  );
}
