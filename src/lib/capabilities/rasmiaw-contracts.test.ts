import { describe, expect, it } from 'vitest'
import { esInerte, getCapability } from './registry'

describe('contratos seguros del Operador', () => {
  it('construye borradores locales sin publicar ni activar', () => {
    expect(esInerte(getCapability('plantillas.crear_borrador'), {})).toBe(true)
    expect(esInerte(getCapability('automatizaciones.crear'), {})).toBe(true)
    expect(esInerte(getCapability('agentes.crear_borrador'), {})).toBe(true)
  })

  it('mantiene Meta y la activación agrupada detrás de confirmación', () => {
    expect(esInerte(getCapability('plantillas.enviar_lote_a_meta'), {})).toBe(false)
    expect(esInerte(getCapability('automatizaciones.activar_lote'), {})).toBe(false)
  })

  it('arma la operación de Rasmiaw sin abrir el motor', () => {
    expect(esInerte(getCapability('rasmiaw.armar_operacion_rasmiaw'), {})).toBe(true)
    expect(esInerte(getCapability('rasmiaw.armar_grupo_de_automatizaciones'), {})).toBe(true)
    expect(esInerte(getCapability('rasmiaw.verificar_preparacion_cuenta'), {})).toBe(true)
  })
})
