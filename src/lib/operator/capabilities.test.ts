import { describe, it, expect } from 'vitest'

import { ALL_CAPABILITIES } from '@/lib/capabilities/registry'
import { MERCHANT_TOOLS } from '@/lib/mcp/merchant-tools'
import {
  OPERATOR_CAPABILITIES,
  motivoFueraDeAlcance,
  operatorCanUse,
} from './capabilities'

/**
 * Qué puede tocar el Operator.
 *
 * La lista se invirtió: el chat ve TODO el catálogo salvo lo que quede
 * explícitamente afuera. Estas pruebas cuidan las dos puntas de esa decisión —
 * que lo excluido siga excluido, y que nada quede huérfano por olvido.
 */
describe('capacidades del Operator', () => {
  it('no puede escribirle a un cliente', () => {
    // Esa conversación la abre una persona desde la bandeja. Entra cuando
    // exista el permiso por acción que lo gobierne.
    expect(operatorCanUse('mensajes.enviar')).toBe(false)
    expect(OPERATOR_CAPABILITIES.some((c) => c.key === 'mensajes.enviar')).toBe(false)
  })

  it('toda exclusión trae su motivo escrito', () => {
    // Sin motivo, dentro de seis meses nadie sabe si sigue valiendo. Es la
    // diferencia entre una decisión y un olvido.
    const excluidas = ALL_CAPABILITIES.filter((c) => !operatorCanUse(c.key))
    expect(excluidas.length).toBeGreaterThan(0)
    for (const c of excluidas) {
      expect(motivoFueraDeAlcance(c.key)?.length ?? 0, c.key).toBeGreaterThan(20)
    }
  })

  it('el chat ve todo el catálogo menos lo excluido', () => {
    // Esta es la prueba que faltaba. Antes la lista se escribía a mano y se
    // quedó atrás dos veces: ocho capacidades construidas y probadas no las
    // veía el chat, y el síntoma era "no puedo hacer eso" sobre algo que sí
    // estaba hecho.
    const visibles = new Set(OPERATOR_CAPABILITIES.map((c) => c.key))
    for (const c of ALL_CAPABILITIES) {
      if (motivoFueraDeAlcance(c.key)) continue
      expect(visibles.has(c.key), `${c.key} está en el catálogo y el chat no la ve`).toBe(
        true,
      )
    }
  })

  it('ninguna capacidad queda sin un consumidor', () => {
    // Una capacidad que no alcanza ni el chat, ni el MCP, ni una pantalla es
    // código muerto que pasa todos los tests: existe, está probada, y no la
    // puede llamar nadie. Pasó con contactos.etiquetar y segmentos.crear.
    const porMcp = new Set(MERCHANT_TOOLS.map((t) => t.capabilityKey).filter(Boolean))
    const huerfanas = ALL_CAPABILITIES.filter(
      (c) => !operatorCanUse(c.key) && !porMcp.has(c.key),
    ).map((c) => c.key)
    // Las excluidas a propósito valen si alguien más las alcanza.
    expect(huerfanas.filter((k) => !motivoFueraDeAlcance(k))).toEqual([])
  })

  it('lo que cambia algo trae preview o es reversible', () => {
    // Una irreversible sin vista previa se aprobaría a ciegas.
    for (const c of OPERATOR_CAPABILITIES.filter((x) => x.risk === 'irreversible')) {
      expect(typeof c.preview, c.key).toBe('function')
    }
  })

  it('la puerta se cierra por clave y no sólo por la lista de tools', () => {
    // El nombre de la herramienta lo elige el modelo: el loop vuelve a
    // preguntar antes de ejecutar.
    expect(operatorCanUse('no.existe')).toBe(false)
    expect(operatorCanUse('metricas.resumen')).toBe(true)
  })
})
