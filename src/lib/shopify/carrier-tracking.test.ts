import { describe, expect, it } from 'vitest'
import { displayCarrierName, resolveCarrierTrackingUrl } from './carrier-tracking'

describe('resolveCarrierTrackingUrl', () => {
  it('detecta Envía aunque Shopify cambie mayúsculas o acentos', () => {
    expect(resolveCarrierTrackingUrl('ENVÍA', '024034940186')).toBe(
      'https://hub.envia.co/landingrastreo/Rastreo/Index?guia=024034940186',
    )
  })

  it('codifica la guía antes de insertarla en el enlace', () => {
    expect(resolveCarrierTrackingUrl('Envia', 'AB 12/34')).toBe(
      'https://hub.envia.co/landingrastreo/Rastreo/Index?guia=AB%2012%2F34',
    )
  })

  it('no inventa un enlace para una transportadora desconocida', () => {
    expect(resolveCarrierTrackingUrl('Transportadora nueva', 'ABC123')).toBeNull()
  })

  it('presenta el nombre de Envía con su escritura correcta', () => {
    expect(displayCarrierName('ENVIA')).toBe('Envía')
  })

  it('conserva nombres desconocidos y cubre nombres ausentes', () => {
    expect(displayCarrierName('Mensajería regional')).toBe('Mensajería regional')
    expect(displayCarrierName(null)).toBe('Transportadora asignada')
  })
})
