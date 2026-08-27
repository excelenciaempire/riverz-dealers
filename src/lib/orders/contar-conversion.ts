import type { SupabaseClient } from '@supabase/supabase-js'
import { contarVentaEnMeta, type SenalesDelNavegador } from '@/lib/marketing/meta-conversions'

/**
 * Avisarle a Meta que se vendió, venga el pedido de donde venga.
 *
 * Vive acá y no dentro de la herramienta del agente porque los pedidos se
 * crean por VARIOS caminos —el bot que atiende, el chat que opera la cuenta,
 * la API— y una venta que no se cuenta es una campaña que se apaga por parecer
 * mala. Poner el aviso en uno solo de esos caminos es dejar los otros mudos.
 *
 * Nunca lanza y nunca se espera: el pedido ya está hecho en la tienda, y que
 * Meta conteste tarde no puede trabar la respuesta al cliente.
 */
export async function contarLaVenta(
  db: SupabaseClient,
  args: {
    workspaceId?: string | null
    /** El id del pedido EN LA TIENDA. Ver el comentario de abajo. */
    orderId?: string | null
    conversationId?: string | null
    total?: number | string | null
    currency?: string | null
    cliente?: {
      email?: string | null
      phone?: string | null
      nombre?: string | null
      ciudad?: string | null
      provincia?: string | null
      pais?: string | null
    } | null
    /** Contra-entrega y cualquier venta cerrada en el chat. */
    porMensajeria?: boolean
  },
): Promise<void> {
  const valor = Number(args.total ?? 0)
  if (!args.workspaceId || !args.orderId || !Number.isFinite(valor) || valor <= 0) return

  // Las señales que el widget capturó en la tienda. Sin ellas el evento llega
  // y no matchea con nadie, así que no mejora la optimización: por eso se
  // buscan aunque el pedido venga de otro canal.
  let senales: SenalesDelNavegador | null = null
  if (args.conversationId) {
    const { data } = await db
      .from('conversations')
      .select('marketing')
      .eq('id', args.conversationId)
      .maybeSingle()
    const m = (data as { marketing?: Record<string, unknown> | null } | null)?.marketing
    if (m) {
      senales = {
        fbp: typeof m.fbp === 'string' ? m.fbp : null,
        fbc: typeof m.fbc === 'string' ? m.fbc : null,
        url: typeof m.url === 'string' ? m.url : null,
        userAgent: typeof m.ua === 'string' ? m.ua : null,
        ip: typeof m.ip === 'string' ? m.ip : null,
      }
    }
  }

  const partes = (args.cliente?.nombre ?? '').trim().split(/\s+/)
  await contarVentaEnMeta(db, {
    workspaceId: args.workspaceId,
    // El id DE LA TIENDA, no el de Riverz. Es el que también usa el píxel del
    // navegador cuando la compra sí pasa por el checkout, así que es lo único
    // que permite que Meta descarte el duplicado y cuente la venta una vez.
    orderId: String(args.orderId),
    conversationId: args.conversationId ?? null,
    value: valor,
    currency: args.currency || 'USD',
    cliente: {
      email: args.cliente?.email ?? null,
      phone: args.cliente?.phone ?? null,
      nombre: partes[0] || null,
      apellido: partes.length > 1 ? partes.slice(1).join(' ') : null,
      ciudad: args.cliente?.ciudad ?? null,
      provincia: args.cliente?.provincia ?? null,
      pais: args.cliente?.pais ?? null,
    },
    senales,
    origen: args.porMensajeria === false ? 'website' : 'business_messaging',
  }).catch(() => {})
}
