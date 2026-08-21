import type { SupabaseClient } from '@supabase/supabase-js'
import { freshAccessToken } from './oauth'
import { webhookToken } from './webhook-url'
import { publicBaseUrl } from '@/lib/base-url'

/**
 * Cobrar sin Shopify.
 *
 * Hasta acá el único "link de pago" del producto era el permalink de carrito de
 * Shopify, así que un comercio de Tiendanube, de WooCommerce o de Mercado Libre
 * podía conversar y no podía cobrar: la venta terminaba en "pasame el alias".
 *
 * Mercado Pago ya estaba integrado, pero de sólo lectura — se usaba para
 * rescatar pagos rechazados. El OAuth, el token y su renovación ya funcionaban;
 * lo único que faltaba era pedir una preferencia de pago. Eso es este archivo.
 *
 * Se cobra en la moneda de la cuenta de Mercado Pago del comercio, y el dinero
 * va a esa cuenta: Riverz no toca la plata, sólo arma el link.
 */

export interface ItemDePago {
  title: string
  quantity: number
  unit_price: number
}

export interface LinkDePago {
  /** A dónde mandar a la clienta. */
  url: string
  /** Id de la preferencia, para poder casar el pago cuando llegue el aviso. */
  preferenceId: string
}

export interface PreferenceError {
  error: 'sin_conexion' | 'sin_items' | 'mp_rechazo'
  message: string
}

const API = 'https://api.mercadopago.com/checkout/preferences'

/**
 * Arma el link de pago.
 *
 * `external_reference` lleva el pedido de Riverz: es lo que después permite
 * saber qué se pagó cuando Mercado Pago avisa, sin adivinar por monto y fecha.
 */
export async function crearLinkDePago(
  db: SupabaseClient,
  args: {
    workspaceId: string
    items: ItemDePago[]
    /** Pedido de Riverz al que corresponde, si ya existe. */
    orderId?: string | null
    payerEmail?: string | null
    /** Se muestra en el resumen de Mercado Pago. */
    statementDescriptor?: string | null
  },
): Promise<LinkDePago | PreferenceError> {
  const items = (args.items ?? [])
    .map((i) => ({
      title: String(i.title ?? '').slice(0, 250) || 'Compra',
      quantity: Math.max(1, Math.floor(Number(i.quantity ?? 1)) || 1),
      unit_price: Number(i.unit_price),
    }))
    // Un precio que no es un número o es cero convierte el link en un cobro de
    // cero pesos: mejor no armarlo que cobrar mal.
    .filter((i) => Number.isFinite(i.unit_price) && i.unit_price > 0)

  if (items.length === 0) {
    return { error: 'sin_items', message: 'No hay nada que cobrar.' }
  }

  const token = await freshAccessToken(db, args.workspaceId)
  if (!token) {
    return {
      error: 'sin_conexion',
      message: 'Mercado Pago no está conectado en esta cuenta.',
    }
  }

  const base = publicBaseUrl()
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items,
        ...(args.payerEmail ? { payer: { email: args.payerEmail } } : {}),
        ...(args.orderId ? { external_reference: args.orderId } : {}),
        // La URL de aviso lleva el comercio y su firma, así que el pago llega
        // sabiendo de quién es sin tener que deducirlo por el `user_id` de
        // Mercado Pago. Es la misma ruta que ya existe para los avisos.
        notification_url: `${base}/api/mercadopago/webhook/${args.workspaceId}/${webhookToken(
          args.workspaceId,
        )}`,
        statement_descriptor: (args.statementDescriptor ?? 'RIVERZ').slice(0, 22),
        // Sin vencimiento: una preferencia que caduca deja a la clienta con un
        // link muerto y sin forma de saber por qué.
        binary_mode: false,
      }),
    })

    if (!res.ok) {
      const texto = await res.text().catch(() => '')
      return {
        error: 'mp_rechazo',
        message: `Mercado Pago rechazó la solicitud (${res.status}): ${texto.slice(0, 200)}`,
      }
    }

    const body = (await res.json()) as {
      id?: string
      init_point?: string
      sandbox_init_point?: string
    }
    const url = body.init_point || body.sandbox_init_point
    if (!url || !body.id) {
      return { error: 'mp_rechazo', message: 'Mercado Pago no devolvió un link.' }
    }
    return { url, preferenceId: String(body.id) }
  } catch (err) {
    return {
      error: 'mp_rechazo',
      message: err instanceof Error ? err.message : 'No se pudo crear el link.',
    }
  }
}
