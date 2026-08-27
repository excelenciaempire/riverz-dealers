import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { encolarVentasRecientes } from './encolar-ventas-recientes'

/**
 * Lo que se recupera al conectar el píxel.
 *
 * Nadie lo conecta el primer día: para cuando lo hace ya tiene una semana de
 * ventas que Meta nunca vio. Lo delicado es la HORA — un evento estampado hoy
 * le atribuye a la campaña de hoy una venta de la semana pasada — y el tope de
 * 7 días, que si se pasa Meta no rechaza: acepta y no cuenta.
 */

vi.mock('@/lib/log/logger', () => ({
  getLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

const AHORA = Date.parse('2026-08-27T12:00:00Z')
const haceDias = (d: number) => new Date(AHORA - d * 86_400_000).toISOString()

let insertado: Array<Record<string, unknown>> = []
let piso = ''

const PEDIDO = {
  id: '11111111-2222-3333-4444-555555555555',
  conversation_id: 'c1',
  shopify_order_id: '9001',
  total_price: '69000',
  currency: 'COP',
  customer_name: 'Ana Ruiz',
  customer_email: 'ana@example.com',
  customer_phone: '+573105554433',
  shipping_address: { city: 'Bogotá', province: 'Cundinamarca', country: 'Colombia' },
  created_at: haceDias(3),
}

/** Una base de mentira que devuelve lo que se le pasa y guarda lo que se le manda. */
function dbCapturando(pedidos: unknown[], marketing: unknown[] = []): SupabaseClient {
  const cadena = (filas: unknown[]) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'order', 'in']) c[m] = () => c
    c.gt = (_col: string, v: string) => {
      piso = v
      return c
    }
    c.limit = async () => ({ data: filas, error: null })
    // `conversations` no llama a .limit(): se resuelve al await del .in().
    c.then = (r: (v: { data: unknown[]; error: null }) => unknown) =>
      r({ data: filas, error: null })
    return c
  }
  return {
    from: (tabla: string) => {
      if (tabla === 'orders') return cadena(pedidos)
      if (tabla === 'conversations') return cadena(marketing)
      return {
        upsert: (filas: Array<Record<string, unknown>>) => {
          insertado = filas
          return { select: async () => ({ data: filas, error: null }) }
        },
      }
    },
  } as unknown as SupabaseClient
}

beforeEach(() => {
  insertado = []
  piso = ''
})

describe('el rescate al conectar el píxel', () => {
  it('estampa la hora de la VENTA, no la de ahora', async () => {
    // Estamparlo hoy le atribuiría a la campaña de hoy una venta de hace tres
    // días. Es el error que no se ve: el evento entra y el número queda mal.
    await encolarVentasRecientes(dbCapturando([PEDIDO]), 'w1', AHORA)
    const cuerpo = insertado[0]?.payload as { data: Array<{ event_time: number }> }
    expect(cuerpo.data[0].event_time).toBe(Math.floor(Date.parse(PEDIDO.created_at) / 1000))
  })

  it('no mira más atrás de 7 días, que es lo que Meta acepta', async () => {
    // Más viejo no falla: entra, contesta que sí, y no cuenta nada.
    await encolarVentasRecientes(dbCapturando([]), 'w1', AHORA)
    expect(Date.parse(piso)).toBe(AHORA - 7 * 86_400_000)
  })

  it('lleva el id de la tienda como event_id y el uuid del espejo como order_id', async () => {
    await encolarVentasRecientes(dbCapturando([PEDIDO]), 'w1', AHORA)
    expect(insertado[0]?.event_id).toBe('9001')
    expect(insertado[0]?.order_id).toBe(PEDIDO.id)
  })

  it('arranca en cero intentos: todavía no se intentó nada', async () => {
    await encolarVentasRecientes(dbCapturando([PEDIDO]), 'w1', AHORA)
    expect(insertado[0]?.intentos).toBe(0)
    expect(insertado[0]?.status).toBe('pendiente')
  })

  it('le pega las señales del navegador de su propia conversación', async () => {
    await encolarVentasRecientes(
      dbCapturando([PEDIDO], [{ id: 'c1', marketing: { fbp: 'fb.1.2.3', ua: 'Mozilla' } }]),
      'w1',
      AHORA,
    )
    const cuerpo = insertado[0]?.payload as {
      data: Array<{ user_data: Record<string, unknown> }>
    }
    expect(cuerpo.data[0].user_data.fbp).toBe('fb.1.2.3')
    expect(cuerpo.data[0].user_data.client_user_agent).toBe('Mozilla')
  })

  it('descarta el pedido sin total: un Purchase de cero no le sirve a nadie', async () => {
    const r = await encolarVentasRecientes(
      dbCapturando([{ ...PEDIDO, total_price: '0' }]),
      'w1',
      AHORA,
    )
    expect(insertado).toEqual([])
    expect(r.encoladas).toBe(0)
  })
})
