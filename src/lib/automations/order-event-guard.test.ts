import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supersededCancellationReason } from './order-event-guard'

function database(rows: Record<string, unknown>[], error: unknown = null) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'eq', 'order']) {
    query[method] = vi.fn(() => query)
  }
  query.limit = vi.fn(async () => ({ data: rows, error }))
  return {
    db: { from: vi.fn(() => query) } as unknown as SupabaseClient,
    query,
  }
}

const cancelled = {
  shopify_order_id: '1009',
  shop_domain: 'shop.myshopify.com',
  created_at: '2026-09-21T00:14:07Z',
  total_price: 249900,
  currency: 'COP',
  status: 'cancelled',
  fulfillment_status: null,
  tracking_number: null,
  line_items: [{ title: 'Puma Suede XL', quantity: 2 }],
}

describe('cancelled order event guard', () => {
  it('suppresses a cancelled duplicate when the real purchase remains active', async () => {
    const active = {
      ...cancelled,
      shopify_order_id: '1008',
      created_at: '2026-09-20T23:54:29Z',
      status: 'fulfilled',
      fulfillment_status: 'fulfilled',
      tracking_number: '114015579121',
      line_items: [
        { title: 'Puma Suede XL', quantity: 1 },
        { title: 'Puma Suede XL', quantity: 1 },
      ],
    }
    const { db } = database([cancelled, active])

    await expect(
      supersededCancellationReason(db, {
        workspaceId: 'workspace',
        contactId: 'contact',
        orderId: '1009',
      }),
    ).resolves.toBe('cancelled_duplicate_has_active_order')
  })

  it('allows a real cancellation when there is no matching active order', async () => {
    const unrelated = {
      ...cancelled,
      shopify_order_id: '1008',
      status: 'fulfilled',
      line_items: [{ title: 'Otro producto', quantity: 2 }],
    }
    const { db } = database([cancelled, unrelated])

    await expect(
      supersededCancellationReason(db, {
        workspaceId: 'workspace',
        contactId: 'contact',
        orderId: '1009',
      }),
    ).resolves.toBeNull()
  })

  it('does not suppress two purchases made more than a day apart', async () => {
    const oldOrder = {
      ...cancelled,
      shopify_order_id: '1008',
      created_at: '2026-09-18T00:00:00Z',
      status: 'fulfilled',
    }
    const { db } = database([cancelled, oldOrder])

    await expect(
      supersededCancellationReason(db, {
        workspaceId: 'workspace',
        contactId: 'contact',
        orderId: '1009',
      }),
    ).resolves.toBeNull()
  })
})

