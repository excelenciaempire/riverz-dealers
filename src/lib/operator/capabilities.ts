/**
 * Qué puede tocar el Operator.
 *
 * No es todo el catálogo. `mensajes.enviar` queda afuera a propósito: le
 * escribe a un cliente real del comercio, y esa conversación la tiene que
 * abrir una persona desde la bandeja, no un agente que está diagnosticando la
 * cuenta. Entra cuando exista el permiso por acción que lo gobierne.
 */
import { ALL_CAPABILITIES } from '@/lib/capabilities/registry'
import type { Capability } from '@/lib/capabilities/types'

const HABILITADAS = new Set([
  'operacion.estado',
  'metricas.resumen',
  'conversaciones.pendientes',
  'contactos.buscar',
  'mensajes.diagnostico',
  'pedidos.listar',
  'plantillas.estado',
  'campanas.estado',
  'agentes.listar',
  'automatizaciones.listar',
  'automatizaciones.recetas',
  'automatizaciones.activar',
  'automatizaciones.editar_espera',
  'automatizaciones.crear',
  'automatizaciones.crear_desde_receta',
  'aprobaciones.pendientes',
  'aprobaciones.decidir',
])

export const OPERATOR_CAPABILITIES: Capability[] = ALL_CAPABILITIES.filter((c) =>
  HABILITADAS.has(c.key),
)

export function operatorCanUse(key: string): boolean {
  return HABILITADAS.has(key)
}
