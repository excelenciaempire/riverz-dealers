import { describe, expect, it } from 'vitest'
import { operationalStateFor } from './activation'

const templatePending = [{
  path: 'steps',
  key: 'automations.issuePlantillaNoAprobada',
  message: 'template pending',
}]

describe('estado operativo de automatizaciones', () => {
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
