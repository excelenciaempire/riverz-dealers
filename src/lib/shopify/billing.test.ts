import { describe, expect, it } from 'vitest'
import {
  shopifyBillingPortalUrl,
  shopifySubscriptionName,
  signShopifyBillingState,
  verifyShopifyBillingState,
} from './billing'

describe('Shopify billing state', () => {
  const secret = 'review-secret'
  const state = {
    workspaceId: 'ws-1',
    shopDomain: 'riverz-demo.myshopify.com',
    planId: 'plan-1',
    expiresAt: 2_000,
  }

  it('round-trips a valid short-lived callback state', () => {
    const token = signShopifyBillingState(state, secret)
    expect(verifyShopifyBillingState(token, secret, 1_000)).toEqual(state)
  })

  it('rejects tampering and expiration', () => {
    const token = signShopifyBillingState(state, secret)
    expect(verifyShopifyBillingState(`${token}x`, secret, 1_000)).toBeNull()
    expect(verifyShopifyBillingState(token, secret, 2_001)).toBeNull()
  })
})

it('uses stable plan names and the native Shopify billing page', () => {
  expect(shopifySubscriptionName({ slug: 'contactos-500' })).toBe('Riverz · contactos-500')
  expect(shopifyBillingPortalUrl('riverz-demo.myshopify.com')).toBe(
    'https://admin.shopify.com/store/riverz-demo/settings/billing',
  )
})
