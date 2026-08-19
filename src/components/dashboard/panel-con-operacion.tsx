'use client'

import { useRiverz2 } from '@/hooks/use-feature-flags'
import { PanelDashboard } from '@/components/dashboard/panel-dashboard'
import {
  ConversacionesPendientes,
  QueEstaCorriendo,
  useOperacion,
} from '@/components/operacion/centro'

/**
 * Inicio, con lo que sabe la operación adentro.
 *
 * Eran dos pantallas mostrando mitades del mismo cuadro: el panel contaba lo
 * que pasó —conversaciones, mensajes, gráficos— y el centro de operación
 * contaba lo que Riverz está haciendo solo. Ahora es una: los bloques de la
 * operación se meten donde corresponde —quién escribió y espera, arriba con lo
 * que necesita a una persona; qué está trabajando solo, junto a las cifras— en
 * vez de apilar dos paneles con las mismas métricas repetidas.
 *
 * Con el flag apagado es el panel de siempre, sin una consulta de más: el hook
 * de la operación ni se monta.
 */
export function PanelConOperacion() {
  const riverz2 = useRiverz2()
  return riverz2 ? <PanelEnriquecido /> : <PanelDashboard />
}

function PanelEnriquecido() {
  const { data } = useOperacion()
  return (
    <PanelDashboard
      ocultarChecklist
      slotAtencion={<ConversacionesPendientes data={data} />}
      slotEstado={<QueEstaCorriendo data={data} />}
    />
  )
}
