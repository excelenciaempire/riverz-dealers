import { describe, expect, it } from 'vitest'
import { esInerte, getCapability } from './registry'
import type { CapabilityContext } from './types'

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

  it.each(['es', 'en'] as const)('muestra preparación y resultado en %s', async (locale) => {
    const ctx = { workspaceId: 'b814e934-d832-4be9-bad4-79cca51c1e23', locale } as CapabilityContext
    const cap = getCapability('rasmiaw.verificar_preparacion_cuenta')
    const view = cap.vista!(ctx, {}, {
      shopify: { connected: true }, whatsapp: { ready: false },
      templates: { approved: 3, expected: 8 }, mercadopago_connected: true,
    })
    expect(JSON.stringify(view)).toContain('3 / 8')
    expect(JSON.stringify(view)).toContain(locale === 'es' ? 'Pendiente' : 'Pending')
    const arm = getCapability('rasmiaw.armar_operacion_rasmiaw')
    expect(await arm.preview!(ctx, {})).toContain(locale === 'es' ? 'apagados' : 'switched off')
    const result = arm.artifact!(ctx, {}, { group: { total: 4 } })
    expect(result?.kind).toBe('cambio')
    expect(JSON.stringify(result)).toContain('"despues":"4"')
  })

  it('rechaza preparar una cuenta ajena antes de consultar o escribir', async () => {
    const ctx = { workspaceId: 'other', db: null } as unknown as CapabilityContext
    for (const key of ['rasmiaw.armar_operacion_rasmiaw', 'rasmiaw.armar_grupo_de_automatizaciones']) {
      await expect(getCapability(key).preview!(ctx, {})).rejects.toThrow('Rasmiaw')
      await expect(getCapability(key).run(ctx, {})).rejects.toThrow('Rasmiaw')
    }
  })
})
