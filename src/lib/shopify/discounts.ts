import type { SupabaseClient } from '@supabase/supabase-js'
import { ShopifyAdminClient } from './admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * Un descuento que el agente puede ofrecer solo.
 *
 * Ante "¿me hacés un descuento?" —la objeción más común que existe en una
 * tienda— el agente sólo sabía decir que no. Ahora puede decir que sí, dentro
 * de un límite que pone el comercio.
 *
 * **El tope es lo que hace que esto sea seguro.** El agente lee mensajes de
 * desconocidos, y "dame 50% o me voy" es exactamente el mensaje que va a
 * recibir. El porcentaje que pida el modelo se recorta contra
 * `workspace_checkout_config.max_discount_percent` acá, en el servidor: no hay
 * instrucción, ni insistencia, ni mensaje bien armado que lo pase. Con el tope
 * en 0 —que es el default— la herramienta ni siquiera se le ofrece.
 *
 * Un cupón por persona: si vuelve a pedir, se le devuelve el mismo. Sin eso,
 * insistir sería una forma de juntar cupones.
 *
 * La maquinaria de acuñar códigos venía del agente de Instagram, donde estaba
 * atada a una campaña; acá vive suelta y sirve para cualquier conversación.
 */

export interface CuponEmitido {
  code: string
  percent: number
}

export interface CuponError {
  error: 'sin_tienda' | 'sin_tope' | 'shopify_rechazo'
  message: string
}

/** La tienda Shopify activa del comercio, o null. */
async function adminDeLaTienda(
  db: SupabaseClient,
  workspaceId: string,
): Promise<{ client: ShopifyAdminClient; shopDomain: string } | null> {
  const { data } = await db
    .from('shopify_connections')
    .select('shop_domain, access_token')
    .eq('platform', 'shopify')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const conn = data as { shop_domain: string; access_token: string } | null
  if (!conn) return null
  try {
    return {
      client: new ShopifyAdminClient(conn.shop_domain, decrypt(conn.access_token)),
      shopDomain: conn.shop_domain,
    }
  } catch {
    return null
  }
}

/** Cuánto puede descontar este comercio. 0 = no puede. */
export async function topeDeDescuento(
  db: SupabaseClient,
  workspaceId: string,
): Promise<number> {
  const { data } = await db
    .from('workspace_checkout_config')
    .select('max_discount_percent')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const n = Number((data as { max_discount_percent?: number } | null)?.max_discount_percent ?? 0)
  return Number.isFinite(n) && n > 0 ? Math.min(50, Math.floor(n)) : 0
}

/**
 * La regla de precio del comercio para ese porcentaje.
 *
 * Una por (tienda, %) y reutilizada: crear una regla nueva por conversación
 * llenaría el panel de Shopify de reglas idénticas en una semana.
 */
async function reglaDePrecio(
  client: ShopifyAdminClient,
  pct: number,
): Promise<string | null> {
  const titulo = `Riverz ${pct}%`
  try {
    const existentes = await client.rest<{
      price_rules?: Array<{ id?: number; title?: string }>
    }>('/price_rules.json?limit=250')
    const ya = (existentes.price_rules ?? []).find((r) => r.title === titulo)
    if (ya?.id) return String(ya.id)

    const creada = await client.rest<{ price_rule?: { id?: number } }>('/price_rules.json', {
      method: 'POST',
      body: {
        price_rule: {
          title: titulo,
          target_type: 'line_item',
          target_selection: 'all',
          allocation_method: 'across',
          value_type: 'percentage',
          value: `-${pct}.0`,
          customer_selection: 'all',
          // Un solo uso por código: el cupón es de esa persona, y sin esto
          // termina circulando por redes en una tarde.
          usage_limit: 1,
          once_per_customer: true,
          starts_at: new Date().toISOString(),
        },
      },
    })
    return creada.price_rule?.id != null ? String(creada.price_rule.id) : null
  } catch {
    return null
  }
}

function slug(nombre: string | null | undefined): string {
  const limpio = (nombre ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 8)
  return limpio || 'HOLA'
}

/**
 * Emite (o devuelve) el cupón de esta persona.
 *
 * `pedido` es lo que el modelo propuso; lo que sale es lo que el comercio
 * permite. Nunca al revés.
 */
export async function emitirCupon(
  db: SupabaseClient,
  args: {
    workspaceId: string
    contactId: string
    conversationId?: string | null
    agentId?: string | null
    contactName?: string | null
    /** Porcentaje que pidió el modelo. Se recorta contra el tope del comercio. */
    pedido: number
  },
): Promise<CuponEmitido | CuponError> {
  // Nunca lanza. Esto corre dentro del bucle de herramientas del agente, y una
  // excepción ahí no es un error de descuento: es una conversación que se corta
  // a la mitad y un cliente esperando una respuesta que no llega.
  try {
    return await emitir(db, args)
  } catch (e) {
    return {
      error: 'shopify_rechazo',
      message: e instanceof Error ? e.message.slice(0, 200) : 'No se pudo emitir el cupón.',
    }
  }
}

async function emitir(
  db: SupabaseClient,
  args: {
    workspaceId: string
    contactId: string
    conversationId?: string | null
    agentId?: string | null
    contactName?: string | null
    pedido: number
  },
): Promise<CuponEmitido | CuponError> {
  const tope = await topeDeDescuento(db, args.workspaceId)
  if (tope <= 0) {
    return {
      error: 'sin_tope',
      message: 'Este negocio no autoriza descuentos.',
    }
  }

  // Ya tiene uno sin usar: se le devuelve ese.
  const { data: previo } = await db
    .from('agent_discounts')
    .select('code, percent')
    .eq('workspace_id', args.workspaceId)
    .eq('contact_id', args.contactId)
    .is('redeemed_at', null)
    .maybeSingle()
  if (previo) {
    const p = previo as { code: string; percent: number }
    return { code: p.code, percent: p.percent }
  }

  const pedido = Math.floor(Number(args.pedido))
  const pct = Math.max(1, Math.min(tope, Number.isFinite(pedido) ? pedido : tope))

  const tienda = await adminDeLaTienda(db, args.workspaceId)
  if (!tienda) {
    return {
      error: 'sin_tienda',
      message: 'No hay una tienda Shopify conectada para emitir el cupón.',
    }
  }

  const ruleId = await reglaDePrecio(tienda.client, pct)
  if (!ruleId) {
    return { error: 'shopify_rechazo', message: 'No se pudo preparar el descuento.' }
  }

  const base = slug(args.contactName)
  const sufijo = args.contactId.replace(/-/g, '').toUpperCase()
  const candidatos = [
    `${base}${pct}`,
    `${base}${pct}${sufijo.slice(0, 3)}`,
    `${base}${pct}${sufijo.slice(3, 8)}`,
  ]

  for (const code of candidatos) {
    try {
      await tienda.client.rest(`/price_rules/${ruleId}/discount_codes.json`, {
        method: 'POST',
        body: { discount_code: { code } },
      })
      await db.from('agent_discounts').insert({
        workspace_id: args.workspaceId,
        contact_id: args.contactId,
        conversation_id: args.conversationId ?? null,
        agent_id: args.agentId ?? null,
        code,
        percent: pct,
        shop_domain: tienda.shopDomain,
        price_rule_id: ruleId,
      })
      return { code, percent: pct }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // 422 con "ya existe" = el código está tomado: se prueba el siguiente.
      // Cualquier otro error es real y no vale quemar los candidatos.
      if (/\b422\b/.test(msg) && /(already|taken|exists|been used)/i.test(msg)) continue
      return { error: 'shopify_rechazo', message: msg.slice(0, 200) }
    }
  }
  return { error: 'shopify_rechazo', message: 'No se pudo generar un código libre.' }
}
