import { describe, expect, it } from 'vitest'
import { cartRecoverySource, compareCartRecoveryCandidates } from './cart-recovery'

describe('cart recovery candidates', () => {
  it('recognizes drafts stored with the stable draft prefix', () => {
    expect(cartRecoverySource('draft_123')).toBe('draft')
    expect(cartRecoverySource('checkout-token')).toBe('checkout')
  })

  it('puts a draft ahead of a checkout for the same recovery run', () => {
    const rows = [
      { checkout_id: 'checkout-token', created_at: '2026-09-04T10:00:00.000Z' },
      { checkout_id: 'draft_123', created_at: '2026-09-04T11:00:00.000Z' },
    ]
    expect(rows.sort(compareCartRecoveryCandidates).map((row) => row.checkout_id)).toEqual([
      'draft_123',
      'checkout-token',
    ])
  })
})
