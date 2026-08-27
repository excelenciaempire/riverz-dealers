import type { SupabaseClient } from '@supabase/supabase-js'
import { armarEvento, type SenalesDelNavegador } from './meta-conversions'
import { getLogger } from '@/lib/log/logger'

/**
 * Las ventas del chat de los últimos días, al conectar el píxel.
 *
 * Nadie conecta el píxel el mismo día que instala Riverz: primero prueba el
 * agente, ve que cierra ventas, y recién entonces va a buscar por qué esas
 * ventas no aparecen en el administrador de anuncios. Para cuando conecta, ya
 * tiene una semana de ventas que Meta nunca vio — y son justo las que le
 * probarían que la campaña funciona.
 *
 * Meta acepta eventos de hasta 7 días atrás, así que esas se pueden recuperar.
 * Más viejo no: no falla, entra y no cuenta nada, que es peor porque deja la
 * fila en verde.
 *
 * No se mandan acá: se dejan encoladas con su cuerpo y las despacha el barrido
 * de `reintentar-conversiones.ts`. Conectar el píxel no puede tardar lo que
 * tarden cien llamadas a Meta.
 */

const log = getLogger('marketing.backfill')

const VENTANA_DIAS = 7
/** Tope por si la cuenta vende mucho: el resto ya no entra en la ventana. */
const TOPE = 300

interface FilaPedido {
  id: string
  conversation_id: string | null
  shopify_order_id: string | null
  total_price: number | string | null
  currency: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  shipping_address: Record<string, unknown> | null
  created_at: string
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export async function encolarVentasRecientes(
  db: SupabaseClient,
  workspaceId: string,
  ahora = Date.now(),
): Promise<{ encoladas: number; miradas: number }> {
  const piso = new Date(ahora - VENTANA_DIAS * 86_400_000).toISOString()

  const { data, error } = await db
    .from('orders')
    .select(
      'id, conversation_id, shopify_order_id, total_price, currency, customer_name, customer_email, customer_phone, shipping_address, created_at',
    )
    .eq('workspace_id', workspaceId)
    // Con conversación: son las que se cerraron en el chat, que son las que
    // Meta no vio. Las del checkout ya las contó el píxel del navegador.
    .not('conversation_id', 'is', null)
    .not('shopify_order_id', 'is', null)
    .gt('created_at', piso)
    .order('created_at', { ascending: false })
    .limit(TOPE)
  if (error) {
    log.warn('no_pude_leer_pedidos', { workspaceId, error: error.message })
    return { encoladas: 0, miradas: 0 }
  }

  const pedidos = (data ?? []) as FilaPedido[]
  if (pedidos.length === 0) return { encoladas: 0, miradas: 0 }

  // Las señales del navegador de cada conversación, de una sola vez.
  const ids = [...new Set(pedidos.map((p) => p.conversation_id).filter(Boolean))] as string[]
  const senalPorConv = new Map<string, SenalesDelNavegador>()
  if (ids.length > 0) {
    const { data: convs } = await db
      .from('conversations')
      .select('id, marketing')
      .in('id', ids)
    for (const c of (convs ?? []) as Array<{ id: string; marketing: Record<string, unknown> | null }>) {
      const m = c.marketing
      if (!m) continue
      senalPorConv.set(c.id, {
        fbp: texto(m.fbp),
        fbc: texto(m.fbc),
        url: texto(m.url),
        userAgent: texto(m.ua),
        ip: texto(m.ip),
      })
    }
  }

  const filas = pedidos.flatMap((p) => {
    const valor = Number(p.total_price ?? 0)
    if (!Number.isFinite(valor) || valor <= 0 || !p.shopify_order_id) return []
    // Sin fecha legible no hay `event_time`, y un NaN ahí lo rechaza Meta con
    // un error que no se parece en nada a la causa.
    const cuando = Date.parse(p.created_at)
    if (!Number.isFinite(cuando)) return []
    const dir = (p.shipping_address ?? {}) as Record<string, unknown>
    const partes = (p.customer_name ?? '').trim().split(/\s+/)
    const cuerpo = armarEvento(
      {
        workspaceId,
        orderId: String(p.shopify_order_id),
        conversationId: p.conversation_id,
        value: valor,
        currency: p.currency || 'USD',
        cliente: {
          email: p.customer_email,
          phone: p.customer_phone,
          nombre: partes[0] || null,
          apellido: partes.length > 1 ? partes.slice(1).join(' ') : null,
          ciudad: texto(dir.city),
          provincia: texto(dir.province),
          pais: texto(dir.country),
        },
        senales: p.conversation_id ? (senalPorConv.get(p.conversation_id) ?? null) : null,
      },
      // La hora de la VENTA, no la de ahora: Meta atribuye por `event_time`, y
      // estamparlo hoy mudaría de día una venta de la semana pasada.
      cuando,
    )
    return [
      {
        workspace_id: workspaceId,
        destino: 'meta',
        event_name: 'Purchase',
        event_id: String(p.shopify_order_id),
        order_id: p.id,
        conversation_id: p.conversation_id,
        value: valor,
        currency: p.currency || 'USD',
        status: 'pendiente',
        payload: cuerpo,
        // Cero y no uno: todavía no se intentó nada. El barrido lo toma en su
        // próxima vuelta, sin espera previa.
        intentos: 0,
        created_at: p.created_at,
      },
    ]
  })

  if (filas.length === 0) return { encoladas: 0, miradas: pedidos.length }

  // `ignoreDuplicates` es lo que hace que reconectar el píxel no vuelva a
  // contar nada: el índice único (cuenta, evento, id) rechaza lo ya anotado.
  const { data: puestas, error: errInsert } = await db
    .from('conversion_events')
    .upsert(filas, {
      onConflict: 'workspace_id,event_name,event_id',
      ignoreDuplicates: true,
    })
    .select('id')
  if (errInsert) {
    log.warn('no_pude_encolar', { workspaceId, error: errInsert.message })
    return { encoladas: 0, miradas: pedidos.length }
  }

  const encoladas = (puestas ?? []).length
  if (encoladas > 0) log.info('encoladas', { workspaceId, encoladas, miradas: pedidos.length })
  return { encoladas, miradas: pedidos.length }
}
