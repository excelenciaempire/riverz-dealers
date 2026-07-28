'use client';

import {
  AgentSettingsMenu,
  AttributedOrders,
  ConnectionPill,
  IgStats,
  OutreachSection,
  PausedBanner,
  useIgOverview,
  useProactiveSettings,
} from '@/components/instagram/sections';
import { useT } from '@/hooks/use-locale';

/**
 * Ventas por Instagram — SALIR A BUSCAR. Describes un objetivo y el agente
 * elige a quién escribirle primero, con qué, y mide lo que vendió.
 *
 * Tres objetos y nada más: lo que la funcionalidad logró, el cuadro del
 * objetivo y las campañas. Los interruptores del piloto automático viven en el
 * menú del encabezado —se tocan una vez y estorban el resto del tiempo— y el
 * plan generado se abre en su propio panel, con la decisión siempre a la vista.
 *
 * Responder comentarios ya no está aquí: tiene su propia entrada en el menú,
 * dentro de Servicio al cliente, porque atender a quien te habla y salir a
 * buscar a alguien son dos trabajos distintos. Y responder los DMs es el
 * Asistente IA. Tres cosas, tres lugares.
 */
export default function VentasInstagramPage() {
  const t = useT();
  const settings = useProactiveSettings();
  const overview = useIgOverview();
  const connected = overview.context
    ? !!overview.context.instagram_connected
    : undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="app-page-title">{t('igAgent.title')}</h1>
        <div className="flex items-center gap-1.5">
          <ConnectionPill connected={connected} />
          <AgentSettingsMenu settings={settings} />
        </div>
      </header>

      <PausedBanner settings={settings} />

      <IgStats overview={overview} />

      <OutreachSection overview={overview} />

      <AttributedOrders overview={overview} />
    </div>
  );
}
