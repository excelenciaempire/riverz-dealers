/**
 * Dar por cobrado un pedido en Shopify.
 *
 * Para los pedidos que se pagan por transferencia, Shopify los crea con el
 * pago pendiente y espera que alguien confirme que la plata llegó. Ese
 * "alguien" era el comercio, entrando al panel. Cuando el comprobante llega
 * por WhatsApp, esto lo hace desde acá.
 *
 * La forma correcta en la API es registrar una transacción de venta sobre el
 * pedido, no editar `financial_status` (que es derivado y no se puede
 * escribir). Shopify recalcula el estado solo: con el total cubierto pasa a
 * `paid`, y con menos a `partially_paid`.
 *
 * Nunca lanza: quien llama decide qué hacer con el motivo.
 */
import type { ShopifyAdmin } from './order-tags'

export interface MarkPaidResult {
  ok: boolean
  /** Estado de pago que quedó, según Shopify. */
  financialStatus?: string
  amount?: string
  error?: string
}

/**
 * Registra el cobro de `amount` sobre `orderId`. Sin monto, cobra lo que falte
 * (`order.total_outstanding`), que es lo que corresponde cuando el
 * comprobante coincide con el pedido entero.
 */
export async function markOrderPaid(
  admin: ShopifyAdmin,
  orderId: string | number,
  amount?: string | number,
): Promise<MarkPaidResult> {
  const base = `https://${admin.shopDomain}/admin/api/${admin.apiVersion}`
  const headers = {
    'X-Shopify-Access-Token': admin.accessToken,
    'Content-Type': 'application/json',
  }

  try {
    // Cuánto falta cobrar. Se pregunta en vez de asumir el total: un pedido
    // puede tener una seña ya registrada, y volver a cobrar el total entero
    // dejaría el pedido sobrepagado.
    const res = await fetch(
      `${base}/orders/${encodeURIComponent(String(orderId))}.json` +
        `?fields=id,total_outstanding,total_price,currency,financial_status`,
      { headers },
    )
    if (!res.ok) {
      return { ok: false, error: `no se pudo leer el pedido (${res.status})` }
    }
    const order = (
      (await res.json()) as {
        order?: {
          total_outstanding?: string
          total_price?: string
          currency?: string
          financial_status?: string
        }
      }
    ).order
    if (!order) return { ok: false, error: 'el pedido no existe' }

    if (order.financial_status === 'paid') {
      // Ya estaba cobrado: no es un error, es que alguien se adelantó.
      return { ok: true, financialStatus: 'paid', amount: '0' }
    }

    const falta = String(amount ?? order.total_outstanding ?? order.total_price ?? '')
    if (!falta || Number(falta) <= 0) {
      return { ok: false, error: 'no queda nada por cobrar' }
    }

    const txRes = await fetch(
      `${base}/orders/${encodeURIComponent(String(orderId))}/transactions.json`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          transaction: {
            kind: 'sale',
            status: 'success',
            amount: falta,
            currency: order.currency,
            // Queda escrito de dónde salió: en el pedido se lee "Riverz" en
            // vez de una transacción sin dueño.
            gateway: 'Riverz (transferencia confirmada por WhatsApp)',
          },
        }),
      },
    )
    const txBody = await txRes.text()
    if (!txRes.ok) {
      return { ok: false, error: `Shopify rechazó el cobro: ${txBody.slice(0, 200)}` }
    }

    // Volver a preguntar el estado en vez de suponerlo: si el monto no cubría
    // todo, quedó `partially_paid` y quien llama tiene que enterarse.
    const after = await fetch(
      `${base}/orders/${encodeURIComponent(String(orderId))}.json?fields=financial_status`,
      { headers },
    )
    const estado = after.ok
      ? ((await after.json()) as { order?: { financial_status?: string } }).order
          ?.financial_status
      : undefined

    return { ok: true, financialStatus: estado, amount: falta }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'error inesperado',
    }
  }
}
