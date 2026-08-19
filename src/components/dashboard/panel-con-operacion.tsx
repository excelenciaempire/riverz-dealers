'use client'

import { useState } from 'react'
import { useRiverz2 } from '@/hooks/use-feature-flags'
import { PanelDashboard } from '@/components/dashboard/panel-dashboard'
import {
  ConversacionesPendientes,
  PlantillasYCampanas,
  QueEstaCorriendo,
  TarjetasOperacion,
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
  // El panel manda el período; la operación lo sigue. Si no, el filtro diría
  // "30 días" y la mitad de las tarjetas seguirían mostrando 7.
  const [dias, setDias] = useState(7)
  const { data } = useOperacion(dias)

  return (
    <PanelDashboard
      ocultarChecklist
      onRango={setDias}
      slotAtencion={<ConversacionesPendientes data={data} />}
      tarjetasExtra={<TarjetasOperacion data={data} />}
      slotEstado={<QueEstaCorriendo data={data} />}
      slotDatos={<PlantillasYCampanas data={data} />}
    />
  )
}
