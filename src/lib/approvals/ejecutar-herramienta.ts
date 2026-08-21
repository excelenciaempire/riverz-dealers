import type { SupabaseClient } from '@supabase/supabase-js'
import type { Contact } from '@/types'

/**
 * Correr la herramienta que el comercio acaba de autorizar.
 *
 * El agente la había preparado con un argumento concreto —este pedido, este
 * monto, estos productos— y ese argumento es el que se ejecuta: no se le
 * vuelve a preguntar al modelo. Entre que se pidió y que se aprobó pueden
 * pasar horas, y volver a generarlo con la conversación más larga daría otra
 * cosa que la que la persona leyó y aprobó.
 *
 * El contexto sí se reconstruye, porque no se puede guardar: las credenciales
 * de la tienda rotan y un token viejo en una fila de la base es una filtración
 * esperando. Se arma de nuevo desde la cuenta, igual que en una conversación.
 */

export interface HerramientaAprobada {
  tool: string
  input: Record<string, unknown>
  contact_id?: string | null
  conversation_id?: string | null
  agent_id?: string | null
}

export function leerHerramienta(payload: Record<string, unknown>): HerramientaAprobada | null {
  const tool = typeof payload.tool === 'string' ? payload.tool : ''
  if (!tool) return null
  const input =
    payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
      ? (payload.input as Record<string, unknown>)
      : {}
  return {
    tool,
    input,
    contact_id: typeof payload.contact_id === 'string' ? payload.contact_id : null,
    conversation_id: typeof payload.conversation_id === 'string' ? payload.conversation_id : null,
    agent_id: typeof payload.agent_id === 'string' ? payload.agent_id : null,
  }
}

export async function ejecutarHerramienta(
  db: SupabaseClient,
  workspaceId: string,
  h: HerramientaAprobada,
): Promise<{ ok: boolean; message: string }> {
  if (!h.contact_id) {
    return { ok: false, message: 'La solicitud no dice de qué contacto era.' }
  }

  const { data } = await db
    .from('contacts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', h.contact_id)
    .maybeSingle()
  const contacto = data as Contact | null
  if (!contacto) {
    return { ok: false, message: 'El contacto de esa solicitud ya no existe.' }
  }

  const { resolveShopifyContext } = await import('@/lib/ai/runner')
  const { resolveStoreForLookup } = await import('@/lib/commerce/order-lookup')
  const { runTool } = await import('@/lib/ai/tools')

  const shopify = await resolveShopifyContext(db, workspaceId, contacto, null)
  if (shopify) {
    shopify.workspaceId = workspaceId
    shopify.contactId = contacto.id
    shopify.agentId = h.agent_id ?? null
    shopify.conversationId = h.conversation_id ?? null
    shopify.canCreateOrders = true
  }
  const otherStore = shopify ? null : await resolveStoreForLookup(db, workspaceId)

  // Sin `requiereAprobacion`: acá ya se aprobó. Dejarlo puesto haría que la
  // herramienta se frene otra vez y abriría una solicitud por cada sí.
  const salida = await runTool(
    h.tool,
    h.input,
    shopify,
    null,
    {
      db,
      workspaceId,
      contactId: contacto.id,
      conversationId: h.conversation_id ?? null,
      agentId: h.agent_id ?? null,
    },
    otherStore,
  )

  let leido: Record<string, unknown> = {}
  try {
    leido = JSON.parse(salida) as Record<string, unknown>
  } catch {
    return { ok: true, message: 'Hecho.' }
  }

  if (leido.ok === false || typeof leido.error === 'string') {
    const detalle = typeof leido.message === 'string' ? leido.message : 'No se pudo.'
    return { ok: false, message: detalle }
  }
  return { ok: true, message: resumen(h.tool, leido) }
}

/** Lo que el comercio lee cuando salió bien. Sin jerga y sin el JSON crudo. */
function resumen(tool: string, out: Record<string, unknown>): string {
  switch (tool) {
    case 'crear_pedido':
      return `Pedido creado${out.order_number ? ` (#${String(out.order_number)})` : ''}.`
    case 'crear_checkout':
      return 'Link de compra generado y listo para mandarle.'
    case 'crear_link_de_pago':
      return 'Link de pago generado.'
    case 'ofrecer_descuento':
      return `Cupón emitido${out.code ? `: ${String(out.code)}` : ''}.`
    case 'registrar_pago':
      return 'Pago registrado.'
    case 'editar_pedido':
      return `Pedido actualizado${out.added_units ? ` (+${String(out.added_units)})` : ''}.`
    case 'abrir_devolucion':
      return 'Devolución registrada.'
    default:
      return 'Hecho.'
  }
}
