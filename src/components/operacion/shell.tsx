'use client'

import { PanelDashboard } from '@/components/dashboard/panel-dashboard'
import {
  ConversacionesPendientes,
  QueEstaCorriendo,
  useOperacion,
} from './centro'

/**
 * La pestaña Panel: el panel de siempre con lo de la operación adentro.
 *
 * No son dos paneles apilados. El de siempre trae lo que pasó —métricas,
 * gráficos, actividad— y la operación mete lo suyo donde corresponde: quién
 * escribió y espera, arriba con lo que necesita a una persona; qué está
 * trabajando solo, junto a las cifras. Juntar "Inicio" con "Panel" era esto:
 * dos pantallas que mostraban mitades del mismo cuadro.
 */
export function OperacionShell() {
  const { data } = useOperacion()

  return (
    <PanelDashboard
      ocultarChecklist
      slotAtencion={<ConversacionesPendientes data={data} />}
      slotEstado={<QueEstaCorriendo data={data} />}
    />
  )
}
