import { ShopifyAdminClient, ShopifyUnauthorizedError } from './admin-client'
import { planRefund, verifiedRefundTransactions, type RefundTransaction } from './refund-plan'

/**
 * Cancelar y reembolsar un pedido.
 *
 * Es lo que le faltaba al agente para poder atender de verdad: hasta acá, ante
 * "quiero cancelar" o "me llegó roto" sólo sabía escalar. Escalar está bien
 * cuando no hay nada que hacer; acá sí lo hay, y dejarlo en manos de una
 * persona convierte un minuto de trabajo en una espera de horas.
 *
 * **Nada de esto se ejecuta por decisión del modelo.** Las dos operaciones
 * mueven dinero y no se deshacen, así que el agente sólo puede PROPONERLAS: la
 * tool arma la solicitud, `askForApproval` se la manda al comercio por WhatsApp
 * y esto corre recién cuando alguien dice que sí. La razón no es de producto
 * sino de seguridad: quien escribe en el chat es un desconocido, y el día que
 * un modelo se deje convencer, lo peor que puede conseguir es que al comercio
 * le llegue una pregunta.
 */

export interface ShopifyAdmin {
  shopDomain: string
  accessToken: string
  apiVersion: string
}

export interface CancelResult {
  ok: boolean
  /** Estado financiero tras la operación, tal como lo informa Shopify. */
  financialStatus?: string | null
  refundId?: string
  refundedAmount?: string
  currency?: string
  error?: string
}

function client(admin: ShopifyAdmin): ShopifyAdminClient {
  return new ShopifyAdminClient(admin.shopDomain, admin.accessToken, admin.apiVersion)
}

/**
 * Cancela el pedido en Shopify.
 *
 * `restock` a propósito: un pedido cancelado cuya mercadería no vuelve al stock
 * deja al comercio sin poder vender algo que sí tiene. Y `refund` para que
 * Shopify devuelva lo cobrado en el mismo movimiento — cancelar sin reembolsar
 * deja al cliente sin producto y sin plata, que es el peor resultado posible.
 */
export async function cancelOrder(
  admin: ShopifyAdmin,
  orderId: string,
  opts?: { reason?: string; refund?: boolean; restock?: boolean },
): Promise<CancelResult> {
  try {
    const body = await client(admin).rest<{ order?: { financial_status?: string } }>(
      `/orders/${orderId}/cancel.json`,
      {
        method: 'POST',
        body: {
          // Shopify sólo acepta este juego: customer | inventory | fraud |
          // declined | other. Cualquier otra cosa hace rebotar el pedido entero.
          reason: normalizarMotivo(opts?.reason),
          // El aviso lo da el agente en la conversación, con el contexto de lo
          // que se habló; un correo automático de Shopify encima es ruido.
          email: false,
          restock: opts?.restock !== false,
          refund: opts?.refund !== false,
        },
      },
    )
    return { ok: true, financialStatus: body.order?.financial_status ?? null }
  } catch (err) {
    return { ok: false, error: traducirError(err) }
  }
}

/**
 * Reembolsa un pedido que NO se cancela: la compra sigue en pie y se devuelve
 * dinero. Es el caso de "me llegó uno de los dos" o de una bonificación por un
 * problema de envío.
 *
 * Sin monto devuelve todo lo cobrado. Shopify exige decir de qué transacción
 * sale la plata, así que primero se leen las del pedido: mandar un reembolso a
 * ciegas rebota con un error que no explica nada.
 */
export async function refundOrder(
  admin: ShopifyAdmin,
  orderId: string,
  opts?: { amount?: number; reason?: string },
): Promise<CancelResult> {
  try {
    const c = client(admin)
    const { transactions } = await c.rest<{ transactions?: RefundTransaction[] }>(`/orders/${orderId}/transactions.json`)
    if (!Array.isArray(transactions)) return { ok: false, error: 'refund_history_unverified' }
    const plan = planRefund(transactions, opts?.amount)
    if (!plan.ok) return plan
    const response = await c.rest<{ refund?: { id?: string | number; transactions?: RefundTransaction[] } }>(`/orders/${orderId}/refunds.json`, {
      method: 'POST', body: { refund: { note: opts?.reason ?? 'Reembolso solicitado por el cliente', notify: false, transactions: plan.transactions } },
    })
    const refundId = response.refund?.id != null ? String(response.refund.id) : undefined
    if (!refundId || !verifiedRefundTransactions(response.refund?.transactions ?? [], plan.transactions)) {
      return { ok: false, refundId, error: 'refund_result_unverified' }
    }
    // Never label a partial refund as a total refund in Riverz's local mirror.
    try {
      const { order } = await c.rest<{ order?: { financial_status?: string; currency?: string } }>(`/orders/${orderId}.json?fields=id,financial_status,currency`)
      if (!order?.financial_status || !['refunded', 'partially_refunded'].includes(order.financial_status)) {
        return { ok: false, refundId, error: 'refund_result_unverified' }
      }
      return { ok: true, refundId, refundedAmount: plan.amount, financialStatus: order.financial_status, currency: order.currency }
    } catch {
      return { ok: false, refundId, error: 'refund_result_unverified' }
    }
  } catch (err) {
    // Approval claiming prevents automatic replay; an uncertain response needs provider review.
    return { ok: false, error: traducirError(err) }
  }
}

const MOTIVOS = new Set(['customer', 'inventory', 'fraud', 'declined', 'other'])

function normalizarMotivo(reason?: string): string {
  const r = (reason ?? '').trim().toLowerCase()
  return MOTIVOS.has(r) ? r : 'customer'
}

/**
 * Un error que se pueda leer. Distingue el caso que tiene arreglo —falta el
 * permiso de escritura, o sea que el comercio tiene que reconectar la tienda—
 * del resto, que es para mirar.
 */
function traducirError(err: unknown): string {
  if (err instanceof ShopifyUnauthorizedError) return 'missing_write_scope'
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('403')) return 'missing_write_scope'
  return msg.slice(0, 300)
}
