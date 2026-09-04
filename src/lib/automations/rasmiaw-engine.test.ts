import { describe, expect, it } from 'vitest'
import { validateStepsForActivation } from './validate'
import { planDesdeIA } from './ai-steps'
import { isButtonUrlVariable, resolveButtonUrlFromVars } from '@/lib/whatsapp/dynamic-links'

describe('motor de Rasmiaw', () => {
  it('acepta la espera exacta de tres segundos y conserva el contexto de oferta', () => {
    expect(validateStepsForActivation([
      { step_type: 'set_context', step_config: { values: { benefit_percent: 5 } } },
      { step_type: 'wait', step_config: { amount: 3, unit: 'seconds' } },
    ])).toEqual([])
  })

  it('puede construir un flujo pausado con una espera de tres segundos', () => {
    const { plan, problemas } = planDesdeIA({
      nombre: 'Contra entrega', disparador: 'shopify_order_created', pasos: [
        { tipo: 'wait', cantidad: 3, unidad: 'seconds' },
        { tipo: 'send_message', texto: 'Beneficio listo.' },
      ],
    })
    expect(problemas).toEqual([])
    expect(plan?.pasos[0]?.step_config).toEqual({ amount: 3, unit: 'seconds' })
  })

  it('resuelve checkout_url para el botón dinámico de carrito', () => {
    const checkoutUrl = 'https://rasmiaw.shop/checkouts/abc123'
    expect(isButtonUrlVariable('abandoned_checkout')).toBe(true)
    expect(resolveButtonUrlFromVars('abandoned_checkout', { checkout_url: checkoutUrl }))
      .toBe(checkoutUrl)
  })
})
