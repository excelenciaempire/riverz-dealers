/**
 * Dar por cobrado un pedido en Shopify.
 *
 * Para los pedidos que se pagan por transferencia, Shopify los crea con el
 * pago pendiente y espera que alguien confirme que la plata llegó. Ese
 * "alguien" era el comercio, entrando al panel. Cuando el comprobante llega
 * por WhatsApp, esto lo hace desde acá.
 *
 * **Se hace con `orderMarkAsPaid` (GraphQL), no con una transacción REST.**
 * Registrar una transacción `sale` sobre el pedido parece lo correcto —es lo
 * que hace el pago real— y Shopify lo rechaza: medido el 2026-08-30 contra
 * `riverz-demo`, un pedido sin pasarela devuelve **422 `sale is not a valid
 * transaction`**, y `capture` devuelve **409** porque no hay ninguna
 * autorización que capturar. Una transacción necesita una pasarela que la
 * respalde; un pedido cobrado por transferencia no tiene ninguna. La mutación
 * es justamente el camino para ese caso: deja el pedido en `paid` con pasarela
 * `manual`, igual que si el comercio hubiera apretado "Marcar como pagado".
 *
 * `financial_status` sigue sin escribirse a mano: es derivado. Lo recalcula
 * Shopify y lo devuelve la propia mutación.
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

interface MarkAsPaidResponse {
  data?: {
    orderMarkAsPaid?: {
      order?: { displayFinancialStatus?: string } | null
      userErrors?: { field?: string[] | null; message?: string }[]
    }
  }
  errors?: { message?: string }[]
}

/**
 * Da por cobrado `orderId`.
 *
 * `amount` no es cuánto cobrar —Shopify cobra el saldo entero o nada— sino
 * cuánto esperaba cobrar quien llama. Si no coincide con lo que falta, no se
 * cobra: dar por pagado un pedido de más plata que la que respalda el
 * comprobante es exactamente el error que este camino existe para no cometer.
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
    // puede tener una seña ya registrada, y darlo por cobrado entero cuando
    // quien llama creía estar cubriendo sólo el resto es plata que nadie vio.
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

    const falta = String(order.total_outstanding ?? order.total_price ?? '')
    if (!falta || Number(falta) <= 0) {
      return { ok: false, error: 'no queda nada por cobrar' }
    }

    // Lo que se esperaba cobrar contra lo que Shopify dice que falta. La
    // mutación no sabe de montos parciales, así que la única forma de no
    // cobrar de más es no llamarla.
    if (amount !== undefined && amount !== null && String(amount) !== '') {
      const esperado = Number(amount)
      if (!Number.isFinite(esperado) || Math.abs(esperado - Number(falta)) > 0.01) {
        return {
          ok: false,
          error: `el comprobante cubre ${amount} y quedan ${falta} por cobrar`,
        }
      }
    }

    const gql = await fetch(`${base}/graphql.json`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query:
          'mutation RiverzMarcarPagado($id: ID!) {' +
          '  orderMarkAsPaid(input: { id: $id }) {' +
          '    order { displayFinancialStatus }' +
          '    userErrors { field message }' +
          '  }' +
          '}',
        variables: { id: `gid://shopify/Order/${orderId}` },
      }),
    })
    if (!gql.ok) {
      const cuerpo = await gql.text()
      return { ok: false, error: `Shopify rechazó el cobro: ${cuerpo.slice(0, 200)}` }
    }
    const body = (await gql.json()) as MarkAsPaidResponse
    // GraphQL contesta 200 con el error adentro: sin esto, un permiso faltante
    // se lee como un cobro exitoso y el pedido queda pendiente en silencio.
    const errores = [
      ...(body.errors ?? []).map((e) => e.message),
      ...(body.data?.orderMarkAsPaid?.userErrors ?? []).map((e) => e.message),
    ].filter(Boolean)
    if (errores.length > 0) {
      return { ok: false, error: `Shopify rechazó el cobro: ${errores.join('; ').slice(0, 200)}` }
    }
    const estado = body.data?.orderMarkAsPaid?.order?.displayFinancialStatus
    if (!estado) {
      return { ok: false, error: 'Shopify no confirmó el cobro' }
    }

    // `PAID` / `PARTIALLY_PAID` → como se guarda en la base.
    return { ok: true, financialStatus: estado.toLowerCase(), amount: falta }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'error inesperado',
    }
  }
}
