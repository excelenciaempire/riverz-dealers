import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { acreditarDesdeEvento } from './recarga'
import { COMISION_REAL, descontarComision } from './comision'
const mocks = vi.hoisted(() => ({ retrieve: vi.fn(), mover: vi.fn() }))
vi.mock('@/lib/billing/stripe', () => ({ stripe: () => ({ paymentIntents: { retrieve: mocks.retrieve } }) }))
vi.mock('./saldo', () => ({ mover: mocks.mover }))
const db = {} as SupabaseClient
const payment = () => ({ id: 'pi_1', status: 'succeeded', currency: 'usd', amount_received: 1000,
  metadata: { tipo: 'recarga_billetera', workspace_id: 'ws', comision: COMISION_REAL },
  latest_charge: { balance_transaction: { id: 'txn_1', currency: 'usd', fee: 59 } } })
const event = (type: string, object: unknown) => ({ type, data: { object } }) as Stripe.Event
beforeEach(() => {
  mocks.retrieve.mockResolvedValue(payment())
  mocks.mover.mockResolvedValue({ duplicado: false, saldoCentavos: 941 })
})
describe('actual Stripe fees', () => {
  it('uses the same ledger keys across automatic credit and repeated webhooks', async () => {
    const seen = new Set(['pi_1'])
    let balance = 1000
    mocks.mover.mockImplementation(async (_db, _ws, movement) => {
      const duplicado = seen.has(movement.stripeId)
      if (!duplicado) { seen.add(movement.stripeId); balance += movement.centavos }
      return { duplicado, saldoCentavos: balance }
    })
    await acreditarDesdeEvento(db, event('payment_intent.succeeded', payment()))
    await acreditarDesdeEvento(db, event('payment_intent.succeeded', payment()))
    expect(balance).toBe(1000)
    expect(seen.size).toBe(2)
  })
  it('records the operating cost without debiting the customer balance', async () => {
    await descontarComision(db, 'ws', 'pi_1')
    expect(mocks.mover).toHaveBeenCalledWith(db, 'ws', expect.objectContaining({
      centavos: 0, costoCentavos: 59, stripeId: 'pi_1:comision', concepto: 'comision_stripe',
    }))
  })
  it('does not charge historical payments', async () => {
    const pi = payment(); pi.metadata.comision = ''; mocks.retrieve.mockResolvedValue(pi)
    await descontarComision(db, 'ws', 'pi_1')
    expect(mocks.mover).not.toHaveBeenCalled()
  })
  it('credits gross funds even when processor settlement needs a retry', async () => {
    mocks.retrieve.mockResolvedValue({ ...payment(), latest_charge: null })
    await expect(acreditarDesdeEvento(db, event('payment_intent.succeeded', payment()))).rejects.toThrow('wallet_fee_pending')
    expect(mocks.mover).toHaveBeenCalledWith(db, 'ws', expect.objectContaining({centavos:1000,stripeId:'pi_1'}))
  })
  it('rejects currency mismatches instead of treating foreign cents as dollars', async () => {
    const pi = payment(); pi.latest_charge.balance_transaction.currency = 'eur'; mocks.retrieve.mockResolvedValue(pi)
    await expect(descontarComision(db, 'ws', 'pi_1')).rejects.toThrow('wallet_fee_invalid_transaction')
  })
  it.each(['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'payment_intent.succeeded'])(
    'credits the full amount and records operating costs for %s', async type => {
      const object = type.startsWith('checkout') ? { metadata: payment().metadata, currency:'usd', payment_status: 'paid', amount_total: 1000, payment_intent: 'pi_1', id: 'cs_1' } : payment()
      await acreditarDesdeEvento(db, event(type, object))
      expect(mocks.mover.mock.calls.map(c => c[2].centavos)).toEqual([1000, 0])
      expect(mocks.mover.mock.calls.map(c => c[2].stripeId)).toEqual(['pi_1', 'pi_1:comision'])
    })
  it('does not write a zero fee movement', async () => {
    const pi = payment(); pi.latest_charge.balance_transaction.fee = 0; mocks.retrieve.mockResolvedValue(pi)
    await descontarComision(db, 'ws', 'pi_1')
    expect(mocks.mover).not.toHaveBeenCalled()
  })
  it.each(['automatica', 'manual'])('preserves %s origin when the payment webhook credits first', async origen => {
    const pi = { ...payment(), metadata: { ...payment().metadata, origen } };
    mocks.retrieve.mockResolvedValue(pi);
    await acreditarDesdeEvento(db, event('payment_intent.succeeded', pi));
    expect(mocks.mover).toHaveBeenCalledWith(db, 'ws', expect.objectContaining({
      tipo: 'recarga', detalle: expect.objectContaining({ origen }),
    }));
  })
})
