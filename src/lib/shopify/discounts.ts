import { randomBytes } from 'crypto'
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

/**
 * Marca los cupones que un pedido usó.
 *
 * Sin esto la fila se quedaba con `redeemed_at` en null para siempre, y el
 * dedupe —que busca justamente por eso— le devolvía a la clienta el MISMO
 * código la próxima vez que pidiera. Un código que en Shopify ya está agotado
 * (`usage_limit: 1`): el agente se lo daba con seguridad y el checkout lo
 * rechazaba, justo en el momento que el descuento venía a rescatar.
 *
 * Lo llama el webhook de pedidos. Best-effort: no puede tumbar el webhook.
 */
export async function marcarCuponesUsados(
  db: SupabaseClient,
  workspaceId: string,
  codigos: string[],
): Promise<void> {
  const limpios = codigos.map((c) => (c ?? '').trim()).filter(Boolean)
  if (limpios.length === 0) return
  await db
    .from('agent_discounts')
    .update({ redeemed_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .in('code', limpios)
    .is('redeemed_at', null)
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
    // Paginado. Una sola página de 250 alcanzaba sólo para una tienda chica: con
    // una app de combos instalada se pasan de 250 reglas sin esfuerzo, la
    // nuestra quedaba fuera de la primera página y se creaba una `Riverz 10%`
    // nueva en cada emisión, hasta llenarle el panel de reglas idénticas.
    let desde = 0
    for (let pagina = 0; pagina < 12; pagina++) {
      const existentes = await client.rest<{
        price_rules?: Array<{ id?: number; title?: string }>
      }>(`/price_rules.json?limit=250${desde ? `&since_id=${desde}` : ''}`)
      const lote = existentes.price_rules ?? []
      const ya = lote.find((r) => r.title === titulo)
      if (ya?.id) return String(ya.id)
      if (lote.length < 250) break
      desde = Number(lote[lote.length - 1]?.id ?? 0)
      if (!desde) break
    }

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

/** Cinco caracteres al azar, sin los que se confunden al dictarlos por chat. */
function azar(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(5)
  let out = ''
  for (const b of bytes) out += alfabeto[b % alfabeto.length]
  return out
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

  // Un porcentaje ilegible cae al MÍNIMO, no al máximo. El número lo escribe el
  // modelo: con `percent: "quince"` o `null` el resultado era `NaN`, y el
  // respaldo era el tope entero — o sea, un argumento mal formado regalaba el
  // descuento más grande que el comercio autoriza.
  const pedido = Math.floor(Number(args.pedido))
  const pct = Number.isFinite(pedido) ? Math.max(1, Math.min(tope, pedido)) : 1

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

  // Todos los códigos llevan una parte al azar, siempre.
  //
  // El primer candidato era `NOMBRE + porcentaje`, y un visitante anónimo del
  // chat web no tiene nombre: el primer cupón de una tienda salía literalmente
  // `HOLA10`. Como la regla vale para cualquier cliente (`customer_selection:
  // 'all'`) y se gasta con un solo uso, adivinarlo no era leer el descuento
  // ajeno: era quemárselo a la persona a la que se lo acabábamos de prometer.
  const base = slug(args.contactName)
  const candidatos = [0, 1, 2].map(() => `${base}${pct}${azar()}`)

  for (const code of candidatos) {
    try {
      await tienda.client.rest(`/price_rules/${ruleId}/discount_codes.json`, {
        method: 'POST',
        body: { discount_code: { code } },
      })
      const { error: errInsert } = await db.from('agent_discounts').insert({
        workspace_id: args.workspaceId,
        contact_id: args.contactId,
        conversation_id: args.conversationId ?? null,
        agent_id: args.agentId ?? null,
        code,
        percent: pct,
        shop_domain: tienda.shopDomain,
        price_rule_id: ruleId,
      })
      if (errInsert) {
        // Choque contra el índice único por contacto: otra llamada del mismo
        // turno ya le emitió uno. El bucle de herramientas puede pedir dos
        // `tool_use` a la vez, así que esto pasa de verdad.
        //
        // Antes se devolvía error, y quedaba lo peor de los dos mundos: el
        // cupón vivo en la tienda y el modelo diciéndole a la clienta que no se
        // pudo. Se le entrega el que ya tiene.
        if (errInsert.code === '23505') {
          const { data: gemelo } = await db
            .from('agent_discounts')
            .select('code, percent')
            .eq('workspace_id', args.workspaceId)
            .eq('contact_id', args.contactId)
            .is('redeemed_at', null)
            .maybeSingle()
          if (gemelo) {
            const g = gemelo as { code: string; percent: number }
            return { code: g.code, percent: g.percent }
          }
        }
        // Cualquier otro fallo: sin la fila se pierden las dos cosas para las
        // que existe la tabla —medir cuánto se regaló y no acuñarle otro a la
        // misma persona—, así que no se entrega el cupón.
        console.error('[descuentos] no se registró el cupón:', errInsert.message)
        return {
          error: 'shopify_rechazo',
          message: 'No se pudo registrar el descuento.',
        }
      }
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
