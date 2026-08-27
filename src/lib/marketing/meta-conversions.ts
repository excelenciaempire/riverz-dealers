import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getLogger } from '@/lib/log/logger'

/**
 * Contarle a Meta las ventas que se cierran DENTRO del chat.
 *
 * El píxel del navegador dispara `Purchase` en la página de gracias del
 * checkout. Cuando el agente crea el pedido en la conversación —contra-entrega,
 * sobre todo— esa página no existe nunca: para Meta la venta no ocurrió. El
 * algoritmo optimiza a ciegas, el ROAS se ve más bajo de lo que es, y el
 * comercio termina apagando una campaña que estaba funcionando. En un mercado
 * donde se paga al recibir, eso no es un caso raro: es la mayoría de las
 * ventas.
 *
 * La API de Conversiones es la única forma de contarlo desde el servidor.
 *
 * **Lo que decide si sirve es el matcheo.** Un evento sin señales llega y no se
 * le puede atribuir a nadie, así que no mejora nada. Por eso se manda todo lo
 * que se tenga: `_fbp` y `_fbc` del navegador (que el widget captura en la
 * tienda), el correo y el teléfono hasheados, el agente de usuario y la IP.
 *
 * **Y lo que evita el doble conteo es `event_id`.** Meta descarta el segundo
 * evento con el mismo `(event_name, event_id)`, así que si además la persona
 * pasa por el checkout, la venta se cuenta una sola vez. El id es el del
 * pedido, que es lo único estable entre los dos caminos.
 */

const log = getLogger('marketing.meta')
const VERSION = 'v21.0'

/** SHA-256 en minúsculas, que es lo que Meta espera. */
function hash(valor: string): string {
  return createHash('sha256').update(valor, 'utf8').digest('hex')
}

/** Correo: sin espacios y en minúsculas antes de hashear. */
export function correoNormalizado(v: string | null | undefined): string | null {
  const t = (v ?? '').trim().toLowerCase()
  return t.includes('@') ? hash(t) : null
}

/**
 * Teléfono: sólo dígitos, con código de país, sin `+`.
 *
 * Sin el país no matchea: un `3105554433` colombiano y uno argentino son el
 * mismo número para Meta, así que descarta los dos.
 */
export function telefonoNormalizado(v: string | null | undefined): string | null {
  const d = (v ?? '').replace(/\D/g, '')
  return d.length >= 10 ? hash(d) : null
}

/** Nombre, ciudad, provincia, país: minúsculas y sin espacios de más. */
function textoNormalizado(v: string | null | undefined): string | null {
  const t = (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return t ? hash(t) : null
}

export interface SenalesDelNavegador {
  /** `_fbp`. Va SIN hashear: hashearlo rompe el matcheo por completo. */
  fbp?: string | null
  /** `_fbc`, o armado desde el `fbclid` de la URL. Tampoco se hashea. */
  fbc?: string | null
  userAgent?: string | null
  ip?: string | null
  /** Dónde estaba la persona cuando empezó la conversación. */
  url?: string | null
}

export interface VentaParaMeta {
  workspaceId: string
  /**
   * El id del pedido EN LA TIENDA. Es lo que deduplica contra el píxel del
   * checkout, y por eso viaja como `event_id` — texto, no uuid.
   */
  orderId: string
  /**
   * El uuid de la fila espejo en `orders`, cuando se conoce. Es OTRO id: la
   * columna es una clave foránea, y meterle el de la tienda hace fallar el
   * insert entero con "invalid input syntax for type uuid" — o sea, la venta
   * no se cuenta y nadie se entera.
   */
  orderRowId?: string | null
  conversationId?: string | null
  value: number
  currency: string
  contenidos?: Array<{ id: string; quantity: number; item_price?: number | null }>
  cliente: {
    email?: string | null
    phone?: string | null
    nombre?: string | null
    apellido?: string | null
    ciudad?: string | null
    provincia?: string | null
    pais?: string | null
  }
  senales?: SenalesDelNavegador | null
  /**
   * Cómo llegó la venta. `website` cuando la persona estaba en la tienda;
   * `business_messaging` cuando se cerró por WhatsApp o Instagram, que es
   * justamente el caso de la contra-entrega.
   */
  origen?: 'website' | 'business_messaging' | 'phone_call' | 'other'
}

interface ConfigMeta {
  pixelId: string
  token: string
}

/** El píxel del comercio, si lo conectó. */
export async function configDeMeta(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ConfigMeta | null> {
  const { data } = await db
    .from('workspace_integrations')
    .select('external_account_id, api_key_encrypted, is_active')
    .eq('workspace_id', workspaceId)
    .eq('provider', 'meta_pixel')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  const fila = data as {
    external_account_id?: string | null
    api_key_encrypted?: string | null
  } | null
  if (!fila?.external_account_id || !fila.api_key_encrypted) return null
  try {
    return { pixelId: fila.external_account_id, token: decrypt(fila.api_key_encrypted) }
  } catch {
    // Token ilegible (se rotó ENCRYPTION_KEY). Mejor no mandar nada que mandar
    // con una credencial rota y llenar el registro de fallos.
    return null
  }
}

/** El cuerpo del evento, tal como lo espera Meta. Separado para poder probarlo. */
export function armarEvento(v: VentaParaMeta, ahora = Date.now()) {
  const s = v.senales ?? {}
  const user: Record<string, unknown> = {}
  const em = correoNormalizado(v.cliente.email)
  const ph = telefonoNormalizado(v.cliente.phone)
  if (em) user.em = [em]
  if (ph) user.ph = [ph]
  const fn = textoNormalizado(v.cliente.nombre)
  const ln = textoNormalizado(v.cliente.apellido)
  const ct = textoNormalizado(v.cliente.ciudad)
  const st = textoNormalizado(v.cliente.provincia)
  const country = textoNormalizado(v.cliente.pais)
  if (fn) user.fn = [fn]
  if (ln) user.ln = [ln]
  if (ct) user.ct = [ct]
  if (st) user.st = [st]
  if (country) user.country = [country]
  // Estos NO se hashean. Hashearlos rompe el matcheo entero.
  if (s.fbp) user.fbp = s.fbp
  if (s.fbc) user.fbc = s.fbc
  if (s.ip) user.client_ip_address = s.ip
  if (s.userAgent) user.client_user_agent = s.userAgent

  return {
    data: [
      {
        event_name: 'Purchase',
        event_time: Math.floor(ahora / 1000),
        // El mismo id que usaría el píxel del checkout: así Meta cuenta UNA.
        event_id: v.orderId,
        action_source: v.origen ?? 'business_messaging',
        ...(s.url ? { event_source_url: s.url } : {}),
        user_data: user,
        custom_data: {
          currency: (v.currency || 'USD').toUpperCase(),
          value: Number(v.value) || 0,
          order_id: v.orderId,
          ...(v.contenidos?.length
            ? {
                contents: v.contenidos.map((c) => ({
                  id: c.id,
                  quantity: c.quantity,
                  ...(c.item_price != null ? { item_price: c.item_price } : {}),
                })),
                content_type: 'product',
              }
            : {}),
        },
      },
    ],
  }
}

/**
 * Manda un cuerpo YA ARMADO y deja constancia de lo que contestaron.
 *
 * Lo comparten el envío y el reintento, y a propósito: si el reintento armara
 * su propio cuerpo, le estamparía la hora del reintento en vez de la de la
 * venta, y Meta atribuye por `event_time` — la venta se mudaría de día y, con
 * suerte, de campaña.
 *
 * Nunca lanza: una venta registrada no puede fallar porque Meta no conteste.
 */
async function despachar(
  db: SupabaseClient,
  a: {
    workspaceId: string
    eventName: string
    eventId: string
    config: ConfigMeta
    cuerpo: unknown
    intentos: number
  },
): Promise<{ ok: boolean; motivo?: string }> {
  const marcar = (parche: Record<string, unknown>) =>
    db
      .from('conversion_events')
      .update({ ...parche, intentos: a.intentos, sent_at: new Date().toISOString() })
      .eq('workspace_id', a.workspaceId)
      .eq('event_name', a.eventName)
      .eq('event_id', a.eventId)

  try {
    const res = await fetch(
      `https://graph.facebook.com/${VERSION}/${a.config.pixelId}/events`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(a.cuerpo as Record<string, unknown>),
          access_token: a.config.token,
        }),
      },
    )
    const texto = await res.text()
    let respuesta: unknown = texto
    try {
      respuesta = JSON.parse(texto)
    } catch {
      /* Meta contestó algo que no es JSON: se guarda tal cual. */
    }
    await marcar({
      status: res.ok ? 'enviado' : 'fallido',
      response: respuesta as Record<string, unknown>,
      error: res.ok ? null : `HTTP ${res.status}`,
    })
    if (!res.ok) {
      log.warn('meta_rechazo', {
        workspaceId: a.workspaceId,
        status: res.status,
        intentos: a.intentos,
        cuerpo: texto.slice(0, 300),
      })
      return { ok: false, motivo: `http_${res.status}` }
    }
    return { ok: true }
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'error'
    await marcar({ status: 'fallido', error: motivo.slice(0, 300) })
    log.warn('meta_sin_respuesta', { workspaceId: a.workspaceId, error: motivo })
    return { ok: false, motivo: 'sin_respuesta' }
  }
}

/**
 * Manda la venta y deja constancia.
 *
 * Lo que no salga queda en `conversion_events` con su cuerpo y su error, y el
 * barrido de `reintentar-conversiones.ts` lo vuelve a intentar.
 */
export async function contarVentaEnMeta(
  db: SupabaseClient,
  v: VentaParaMeta,
): Promise<{ ok: boolean; motivo?: string }> {
  const config = await configDeMeta(db, v.workspaceId)
  if (!config) return { ok: false, motivo: 'sin_pixel' }

  const cuerpo = armarEvento(v)

  // La fila primero, con su índice único: si dos caminos intentan contar el
  // mismo pedido a la vez, el segundo rebota acá y no llega a mandar nada.
  const { error: choque } = await db.from('conversion_events').insert({
    workspace_id: v.workspaceId,
    destino: 'meta',
    event_name: 'Purchase',
    event_id: v.orderId,
    order_id: v.orderRowId ?? null,
    conversation_id: v.conversationId ?? null,
    value: v.value,
    currency: v.currency,
    status: 'pendiente',
    // El cuerpo exacto, para que el reintento no tenga que adivinarlo y para
    // que el comercio pueda ver qué se mandó en su nombre.
    payload: cuerpo,
    intentos: 1,
  })
  if (choque) {
    if (choque.code === '23505') return { ok: true, motivo: 'ya_contada' }
    log.warn('no_pude_anotar', { workspaceId: v.workspaceId, error: choque.message })
    return { ok: false, motivo: 'error_db' }
  }

  return despachar(db, {
    workspaceId: v.workspaceId,
    eventName: 'Purchase',
    eventId: v.orderId,
    config,
    cuerpo,
    intentos: 1,
  })
}

/** Reenvía un evento que quedó a medias, con el mismo cuerpo de la primera vez. */
export async function reenviarEvento(
  db: SupabaseClient,
  fila: {
    workspace_id: string
    event_name: string
    event_id: string
    payload: unknown
    intentos: number
  },
): Promise<{ ok: boolean; motivo?: string }> {
  if (!fila.payload) return { ok: false, motivo: 'sin_cuerpo' }
  const config = await configDeMeta(db, fila.workspace_id)
  // Sin píxel no hay a quién mandarle: el comercio lo desconectó después de la
  // venta. No se gasta un intento — si lo reconecta, esto vuelve a salir.
  if (!config) return { ok: false, motivo: 'sin_pixel' }
  return despachar(db, {
    workspaceId: fila.workspace_id,
    eventName: fila.event_name,
    eventId: fila.event_id,
    config,
    cuerpo: fila.payload,
    intentos: fila.intentos + 1,
  })
}

/**
 * Que Meta se entere de que alguien ABRIO una conversacion.
 *
 * La venta ya se cuenta (`contarVentaEnMeta`), pero entre el clic en el anuncio
 * y la compra hay un paso que para el algoritmo no existia: la persona que
 * llega, pregunta y todavia no compro. Sin ese evento Meta no puede optimizar a
 * "gente que conversa" — la campana entera se juega a la conversion final, que
 * en contra-entrega tarda dias en confirmarse.
 *
 * `Contact` es el evento estandar de Meta para esto y no hace falta declararlo
 * en ningun lado. `action_source: 'chat'` es literalmente este caso.
 *
 * El id es el de la conversacion: el mismo que dispara el pixel del navegador
 * desde la tienda, asi que Meta descarta el duplicado y cuenta UNA. Y el indice
 * unico de `conversion_events` garantiza que se mande una sola vez por
 * conversacion, aunque esta funcion se llame en cada mensaje.
 */
export interface ContactoParaMeta {
  workspaceId: string
  conversationId: string
  cliente?: { email?: string | null; phone?: string | null } | null
  senales?: SenalesDelNavegador | null
}

/** El id que comparten el evento del navegador y el del servidor. */
export function idDeContacto(conversationId: string): string {
  return `wc_${conversationId}`
}

export function armarContacto(c: ContactoParaMeta, ahora = Date.now()) {
  const s = c.senales ?? {}
  const user: Record<string, unknown> = {}
  const em = correoNormalizado(c.cliente?.email)
  const ph = telefonoNormalizado(c.cliente?.phone)
  if (em) user.em = [em]
  if (ph) user.ph = [ph]
  if (s.fbp) user.fbp = s.fbp
  if (s.fbc) user.fbc = s.fbc
  if (s.ip) user.client_ip_address = s.ip
  if (s.userAgent) user.client_user_agent = s.userAgent

  return {
    data: [
      {
        event_name: 'Contact',
        event_time: Math.floor(ahora / 1000),
        event_id: idDeContacto(c.conversationId),
        action_source: 'chat',
        ...(s.url ? { event_source_url: s.url } : {}),
        user_data: user,
      },
    ],
  }
}

/**
 * Reserva el evento y lo despacha sin esperar.
 *
 * Devuelve `nuevo: false` cuando esta conversacion ya se conto — asi quien
 * llama sabe que no tiene que volver a disparar el pixel del navegador. El
 * despacho a Meta va suelto: un mensaje del visitante no puede esperar a que
 * Graph conteste.
 */
export async function contarContactoEnMeta(
  db: SupabaseClient,
  c: ContactoParaMeta,
): Promise<{ nuevo: boolean }> {
  const config = await configDeMeta(db, c.workspaceId)
  if (!config) return { nuevo: false }

  const eventId = idDeContacto(c.conversationId)
  const cuerpo = armarContacto(c)

  const { error: choque } = await db.from('conversion_events').insert({
    workspace_id: c.workspaceId,
    destino: 'meta',
    event_name: 'Contact',
    event_id: eventId,
    conversation_id: c.conversationId,
    status: 'pendiente',
    payload: cuerpo,
    intentos: 1,
  })
  // 23505 = ya contada. Es el caso normal a partir del segundo mensaje.
  if (choque) return { nuevo: false }

  void despachar(db, {
    workspaceId: c.workspaceId,
    eventName: 'Contact',
    eventId,
    config,
    cuerpo,
    intentos: 1,
  }).catch(() => {})

  return { nuevo: true }
}
