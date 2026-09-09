import { describe, expect, it } from 'vitest'
import { isTemplateReady, operationalStateFor } from './activation'

const templatePending = [{
  path: 'steps',
  key: 'automations.issuePlantillaNoAprobada',
  message: 'template pending',
}]

describe('estado operativo de automatizaciones', () => {
  it.each(['PAUSED', 'FLAGGED', 'DISABLED', 'REJECTED', 'PENDING'])('bloquea una plantilla con estado Meta %s aunque el resumen diga Approved', (meta_status) => {
    expect(isTemplateReady({ status: 'Approved', meta_status })).toBe(false)
  })

  it('acepta aprobadas y registros antiguos sin estado crudo', () => {
    expect(isTemplateReady({ status: 'Approved', meta_status: 'APPROVED' })).toBe(true)
    expect(isTemplateReady({ status: 'Approved', meta_status: null })).toBe(true)
    expect(isTemplateReady({ status: 'Pending', meta_status: 'APPROVED' })).toBe(false)
  })
  it('pasa de borrador a armado y a activo según sus dependencias', () => {
    expect(operationalStateFor('draft', [])).toBe('draft')
    expect(operationalStateFor('armed', templatePending)).toBe('armed')
    expect(operationalStateFor('armed', [])).toBe('active')
  })

  it('vuelve a armado si Meta o una integración falla después de activarse', () => {
    expect(operationalStateFor('active', templatePending)).toBe('armed')
    expect(operationalStateFor('active', [{
      path: 'whatsapp.health',
      key: 'automations.issueWhatsAppPagoPendiente',
      message: 'payment required',
    }])).toBe('armed')
    expect(operationalStateFor('active', [{
      path: 'trigger.integration',
      key: 'automations.issueMercadoPagoPendiente',
      message: 'Mercado Pago pending',
    }])).toBe('armed')
  })
})
