import { describe, expect, it } from 'vitest'
import { cfgDeDato, datoDeCfg } from './condition-config'
import {
  conditionDataPoints,
  dataPointById,
} from './data-points'

describe('payment method automation condition', () => {
  it('round-trips the persisted COD condition through the visual editor', () => {
    const available = conditionDataPoints('shopify_order_created')
    const paymentMethod = dataPointById('payment_gateway')

    expect(paymentMethod).toBeDefined()
    expect(cfgDeDato(paymentMethod!)).toMatchObject({
      subject: 'context_var',
      operand: 'payment_gateway',
      op: 'eq',
    })
    expect(
      datoDeCfg('context_var', 'payment_gateway', available),
    ).toBe('payment_gateway')
    expect(paymentMethod?.options).toContainEqual({
      value: 'Cash on Delivery',
      labelKey: 'automations.paymentMethodCashOnDelivery',
    })
  })
})
