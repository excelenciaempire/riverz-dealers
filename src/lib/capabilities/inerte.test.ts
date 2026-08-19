import { describe, it, expect } from 'vitest'

import { ALL_CAPABILITIES, esInerte, getCapability } from './registry'

/**
 * La línea entre lo que el Operador construye solo y lo que pide permiso.
 *
 * Es la prueba más importante de la capa. En modo automático, todo lo `inerte`
 * se ejecuta sin que nadie lo mire — y el Operador lee mensajes escritos por
 * clientes del comercio, donde alguien puede esconder instrucciones. La defensa
 * entera se apoya en que nada marcado inerte alcance a una persona, salga a
 * Meta o mueva dinero.
 *
 * Marcar algo inerte por error no rompe un test de otra cosa: rompe éste, o no
 * rompe nada y se entera un cliente.
 */

/** Lo que sí puede construirse solo, con su motivo. */
const INERTES: Record<string, string> = {
  'automatizaciones.crear': 'nace pausada',
  'automatizaciones.crear_desde_receta': 'nace pausada y sin plantilla',
  'automatizaciones.editar_espera': 'cambia un tiempo, no manda nada',
  'agentes.crear_borrador': 'nace pausado, no le contesta a nadie',
}

describe('qué puede construirse sin preguntar', () => {
  it('sólo lo declarado, y nada más', () => {
    const marcadas = ALL_CAPABILITIES.filter(
      (c) => c.risk !== 'lectura' && esInerte(c, {}),
    ).map((c) => c.key)
    expect(marcadas.sort()).toEqual(Object.keys(INERTES).sort())
  })

  it('toda lectura es inerte: no cambia nada por definición', () => {
    for (const c of ALL_CAPABILITIES.filter((x) => x.risk === 'lectura')) {
      expect(esInerte(c, {}), c.key).toBe(true)
    }
  })

  it('prender NO es inerte; pausar sí', () => {
    // La misma capacidad y dos cosas distintas: prender una automatización la
    // pone a escribirle a clientes con cada evento.
    const auto = getCapability('automatizaciones.activar')
    expect(esInerte(auto, { activa: true })).toBe(false)
    expect(esInerte(auto, { activa: false })).toBe(true)

    const agente = getCapability('agentes.activar')
    expect(esInerte(agente, { activo: true })).toBe(false)
    expect(esInerte(agente, { activo: false })).toBe(true)
  })

  it('lo que le llega a una persona o mueve dinero nunca es inerte', () => {
    expect(esInerte(getCapability('mensajes.enviar'), {})).toBe(false)
    // Aprobar puede marcar un pedido como pagado en Shopify.
    expect(esInerte(getCapability('aprobaciones.decidir'), { aprobar: true })).toBe(false)
    expect(esInerte(getCapability('aprobaciones.decidir'), { aprobar: false })).toBe(false)
  })

  it('sin declaración, se propone', () => {
    // El default tiene que ser el seguro: una capacidad nueva que se olvide de
    // declararse pasa por aprobación, no al revés.
    const inventada = { key: 'x.y', risk: 'reversible' as const }
    expect(esInerte(inventada as never, {})).toBe(false)
  })
})
