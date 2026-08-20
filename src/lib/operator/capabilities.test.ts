import { describe, it, expect } from 'vitest'

import { ALL_CAPABILITIES, esInerte } from '@/lib/capabilities/registry'
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
  it('puede escribirle a un cliente, y por eso mismo siempre pide permiso', () => {
    // La lista de capacidades nunca fue la barrera: la barrera es `esInerte`.
    // Mandar un mensaje es irreversible y no inerte, así que tenerla a mano no
    // le saca un click a nada — sólo le permite ofrecerse en vez de contestar
    // "eso no se puede desde acá".
    expect(operatorCanUse('mensajes.enviar')).toBe(true)
    const cap = ALL_CAPABILITIES.find((c) => c.key === 'mensajes.enviar')!
    expect(cap.risk).toBe('irreversible')
    expect(esInerte(cap, {}), 'mandar un mensaje NUNCA se construye solo').toBe(false)
  })

  it('toda exclusión trae su motivo escrito', () => {
    // Hoy no hay ninguna, y el bucle no corre. Queda porque la puerta sigue
    // existiendo: el día que alguien saque algo del alcance del chat, sin
    // motivo escrito nadie va a saber en seis meses si sigue valiendo.
    for (const c of ALL_CAPABILITIES.filter((x) => !operatorCanUse(x.key))) {
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
