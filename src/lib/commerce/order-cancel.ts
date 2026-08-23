import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveStoreForLookup } from './order-lookup'

/**
 * Cancelar un pedido en una tienda que NO es Shopify.
 *
 * La cancelación existía sólo para Shopify, y eso convertía la herramienta en
 * una promesa incumplible: en una tienda Tiendanube o WooCommerce el agente
 * ofrecía cancelar, la clienta escuchaba "ya lo pasé al equipo", el comercio
 * recibía el aviso y apretaba que sí — y recién ahí fallaba, con "la tienda no
 * está conectada". El peor lugar para fallar es después de haber prometido.
 *
 * No devuelve dinero. Cancelar y reembolsar son cosas distintas, y mezclarlas
 * sería devolver plata que nadie autorizó.
 */

export interface CancelacionOk {
  ok: true
  platform: 'tiendanube' | 'woocommerce'
}

export interface CancelacionError {
  ok: false
  error: 'sin_tienda' | 'plataforma_no_soportada' | 'rechazo'
  message: string
}

const UA = 'Riverz (soporte@riverz.co)'

export async function cancelarPedidoEnLaTienda(
  db: SupabaseClient,
  args: { workspaceId: string; externalOrderId: string; reason?: string | null },
): Promise<CancelacionOk | CancelacionError> {
  const id = String(args.externalOrderId ?? '').trim()
  if (!id) {
    return { ok: false, error: 'rechazo', message: 'Falta el id del pedido.' }
  }

  const tienda = await resolveStoreForLookup(db, args.workspaceId)
  if (!tienda) {
    return { ok: false, error: 'sin_tienda', message: 'No hay una tienda conectada.' }
  }

  try {
    if (tienda.platform === 'tiendanube') {
      const res = await fetch(
        `https://api.tiendanube.com/v1/${tienda.externalStoreId}/orders/${encodeURIComponent(id)}/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tienda.accessToken}`,
            Authentication: `bearer ${tienda.accessToken}`,
            'User-Agent': UA,
            'Content-Type': 'application/json',
          },
          // `reason` acepta un conjunto cerrado; el texto libre del motivo ya
          // viaja en la solicitud de aprobación, que es donde se lee.
          body: JSON.stringify({ reason: 'customer' }),
        },
      )
      if (!res.ok) {
        const texto = await res.text().catch(() => '')
        return {
          ok: false,
          error: 'rechazo',
          message: `Tiendanube no canceló el pedido (${res.status}): ${texto.slice(0, 200)}`,
        }
      }
      return { ok: true, platform: 'tiendanube' }
    }

    if (tienda.platform === 'woocommerce') {
      if (!tienda.storeUrl || !tienda.apiSecret) {
        return { ok: false, error: 'sin_tienda', message: 'Faltan credenciales de la tienda.' }
      }
      const base = tienda.storeUrl.replace(/\/+$/, '')
      const auth = Buffer.from(`${tienda.accessToken}:${tienda.apiSecret}`).toString('base64')
      const res = await fetch(`${base}/wp-json/wc/v3/orders/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Basic ${auth}`,
          'User-Agent': UA,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) {
        const texto = await res.text().catch(() => '')
        return {
          ok: false,
          error: 'rechazo',
          message: `WooCommerce no canceló el pedido (${res.status}): ${texto.slice(0, 200)}`,
        }
      }
      return { ok: true, platform: 'woocommerce' }
    }

    return {
      ok: false,
      error: 'plataforma_no_soportada',
      message: `Cancelar no está disponible para ${tienda.platform}.`,
    }
  } catch (e) {
    return {
      ok: false,
      error: 'rechazo',
      message: e instanceof Error ? e.message.slice(0, 250) : 'La tienda rechazó la cancelación.',
    }
  }
}
