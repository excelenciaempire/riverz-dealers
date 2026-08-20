'use client'

import { useState } from 'react'
import { useRiverz2 } from '@/hooks/use-feature-flags'
import { PanelDashboard } from '@/components/dashboard/panel-dashboard'
import { useOperacion } from '@/lib/dashboard/use-operacion'

/**
 * Inicio, medido por lo que devuelve.
 *
 * Empezó siendo el panel de siempre con la operación colgada al costado, y eso
 * dejaba una pantalla de volumen: mensajes que entraron, mensajes que salieron,
 * contactos nuevos, automatizaciones prendidas, canales conectados, corridas de
 * las últimas 24 h. Ninguna de esas cifras contesta si conviene seguir pagando
 * —suben igual cuando la cuenta anda mal—, así que se fueron.
 *
 * Lo que queda es plata y atención: cuánto entró por Riverz sobre el total de
 * la tienda, cuánto vale un pedido, cuánto contestó la IA en lugar de una
 * persona, y cuánto tarda la primera respuesta.
 *
 * De la operación sobrevive un solo número —los mensajes que escribió la IA—
 * porque es el único que el panel no puede calcular por su cuenta.
 *
 * Con el flag apagado es el panel clásico, sin una consulta de más: el hook de
 * la operación ni se monta.
 */
export function PanelConOperacion() {
  const riverz2 = useRiverz2()
  return riverz2 ? <PanelDeRetorno /> : <PanelDashboard />
}

function PanelDeRetorno() {
  // El panel manda el período; la operación lo sigue. Si no, el filtro diría
  // "30 días" y la tarjeta de la IA seguiría mostrando 7.
  const [dias, setDias] = useState(7)
  const { data } = useOperacion(dias)

  return (
    // El checklist se queda. Esconderlo fue un error caro: con el flag prendido
    // para todos, cada comercio perdió su guía de arranque, y el asistente que
    // la reemplazaba no estaba enlazado desde ninguna pantalla. Ahora conviven —
    // el asistente es un atajo DENTRO del checklist, no su reemplazo.
    <PanelDashboard
      roi
      onRango={setDias}
      respuestasIa={data?.metricas?.ia.respondio ?? null}
    />
  )
}
