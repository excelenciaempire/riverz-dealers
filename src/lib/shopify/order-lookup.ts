/**
 * Shopify order-lookup helper for the AI agent's `lookup_order` tool.
 *
 * Goal: dado un teléfono y/o número de pedido del cliente, devolver
 * un resumen compacto (top 5) que el modelo pueda parafrasear en
 * lenguaje natural. Usamos exclusivamente la REST Admin API porque
 * /orders.json soporta filtros directos por `name` y `customer_id`
 * sin necesitar GraphQL — más simple y suficiente para este caso.
 *
 * Estrategia:
 *   1. Si llega un `orderNumber`, intentamos primero por nombre
 *      directo (Shopify acepta `name=1042` o `name=#1042`).
 *   2. Si no llega o no hay match, buscamos al cliente por phone/email
 *      y traemos sus últimos pedidos.
 *
 * Errores de red, 401, 403 → devolvemos `{ found:false, orders:[] }`
 * en vez de tirar. El modelo se encarga de decirle al cliente que no
 * pudo consultar — nunca dejamos caer el turno por una falla de
 * Shopify.
 */

import { resolveCarrierTrackingUrl } from './carrier-tracking'
import { markShopifyConnectionExpired } from './admin-client'

interface ShopifyLineItem {
  title: string
  quantity: number
}

interface ShopifyFulfillment {
  tracking_number: string | null
  tracking_url: string | null
  tracking_numbers?: string[] | null
  tracking_urls?: string[] | null
  tracking_company?: string | null
}

interface ShopifyOrder {
  id: number
  name: string
  created_at: string
  financial_status: string | null
  fulfillment_status: string | null
  total_price: string
  currency: string
  line_items: ShopifyLineItem[]
  fulfillments?: ShopifyFulfillment[]
  // Sólo para el control de pertenencia (ver `belongsToCustomer`). Nunca
  // salen en `OrderSummary`, así que el modelo no los ve.
  email?: string | null
  phone?: string | null
  customer?: { email?: string | null; phone?: string | null } | null
  shipping_address?: { phone?: string | null } | null
}

interface ShopifyCustomer {
  id: number
  email: string | null
  phone: string | null
}

export interface OrderSummary {
  name: string
  created_at: string
  financial_status: string
  fulfillment_status: string | null
  total_price: string
  currency: string
  line_items: Array<{ title: string; quantity: number }>
  tracking_number: string | null
  tracking_url: string | null
}

export interface LookupOrdersResult {
  found: boolean
  orders: OrderSummary[]
}

const ORDER_FIELDS =
  'id,name,created_at,financial_status,fulfillment_status,total_price,currency,line_items,fulfillments'

/**
 * Los campos de arriba MÁS los identificadores del comprador. Se piden sólo
 * en la búsqueda por número de pedido, donde hay que comprobar que el pedido
 * sea de quien está escribiendo; nunca se devuelven al modelo.
 */
const ORDER_FIELDS_WITH_OWNER = `${ORDER_FIELDS},email,phone,customer,shipping_address`

/** Últimos 8 dígitos: sortea prefijos de país y formatos locales. */
function phoneKey(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits.slice(-8) : null
}

/**
 * ¿El pedido es de quien está hablando con el agente?
 *
 * La búsqueda por número (`name=1042`) no filtra por cliente: sin esta
 * comprobación, cualquiera que le escriba al bot podía pedir "el pedido
 * #1042" y recibir el total, los productos y el número de seguimiento de otra
 * compradora de la misma tienda. Comparamos correo (exacto, case-insensitive)
 * y teléfono (últimos 8 dígitos) contra los del contacto.
 *
 * Sin teléfono ni correo del contacto no hay nada que comparar: se rechaza.
 */
function belongsToCustomer(
  order: ShopifyOrder,
  customerPhone: string | undefined,
  customerEmail: string | undefined,
): boolean {
  const email = customerEmail?.trim().toLowerCase()
  if (email) {
    const orderEmails = [order.email, order.customer?.email]
      .map((e) => e?.trim().toLowerCase())
      .filter(Boolean)
    if (orderEmails.includes(email)) return true
  }
  const phone = phoneKey(customerPhone)
  if (phone) {
    const orderPhones = [
      order.phone,
      order.customer?.phone,
      order.shipping_address?.phone,
    ]
      .map(phoneKey)
      .filter(Boolean)
    if (orderPhones.includes(phone)) return true
  }
  return false
}

/**
 * Punto de entrada del tool. Toda la lógica vive acá para que el
 * agentic loop sólo tenga que importar una cosa.
 */
export async function lookupCustomerOrders(opts: {
  shopDomain: string
  accessToken: string
  apiVersion: string
  customerPhone?: string
  customerEmail?: string
  orderNumber?: string
}): Promise<LookupOrdersResult> {
  const base = `https://${opts.shopDomain}/admin/api/${opts.apiVersion}`
  const headers = {
    'X-Shopify-Access-Token': opts.accessToken,
    'Content-Type': 'application/json',
  }

  try {
    // 1) Lookup directo por número de pedido (si llega).
    if (opts.orderNumber && opts.orderNumber.trim()) {
      const raw = opts.orderNumber.trim().replace(/^#/, '')
      const url = `${base}/orders.json?status=any&limit=5&name=${encodeURIComponent(
        raw,
      )}&fields=${encodeURIComponent(ORDER_FIELDS_WITH_OWNER)}`
      const res = await fetch(url, { headers })
      if (res.ok) {
        const data = (await res.json()) as { orders?: ShopifyOrder[] }
        // Se devuelven SÓLO los pedidos del propio cliente: el número de
        // pedido es un identificador adivinable y no prueba nada.
        const orders = (data.orders ?? [])
          .filter((o) => belongsToCustomer(o, opts.customerPhone, opts.customerEmail))
          .map(toSummary)
        if (orders.length > 0) {
          return { found: true, orders }
        }
      } else if (res.status === 401) {
        void markShopifyConnectionExpired(opts.shopDomain)
      }
      // Si no encontró por nombre, seguimos al fallback por cliente
      // (la clienta puede haber dado un número parcial o equivocado).
    }

    // 2) Buscar cliente por teléfono o email, después sus pedidos.
    const query = buildCustomerQuery(opts.customerPhone, opts.customerEmail)
    if (!query) return { found: false, orders: [] }

    const searchUrl = `${base}/customers/search.json?query=${encodeURIComponent(
      query,
    )}&limit=5`
    const customerRes = await fetch(searchUrl, { headers })
    if (!customerRes.ok) {
      if (customerRes.status === 401) {
        void markShopifyConnectionExpired(opts.shopDomain)
      }
      return { found: false, orders: [] }
    }
    const customerData = (await customerRes.json()) as {
      customers?: ShopifyCustomer[]
    }
    const customer = (customerData.customers ?? [])[0]
    if (!customer) return { found: false, orders: [] }

    const ordersUrl = `${base}/orders.json?status=any&customer_id=${
      customer.id
    }&limit=5&fields=${encodeURIComponent(ORDER_FIELDS)}`
    const ordersRes = await fetch(ordersUrl, { headers })
    if (!ordersRes.ok) {
      if (ordersRes.status === 401) {
        void markShopifyConnectionExpired(opts.shopDomain)
      }
      return { found: false, orders: [] }
    }
    const ordersData = (await ordersRes.json()) as { orders?: ShopifyOrder[] }
    const orders = (ordersData.orders ?? []).map(toSummary)
    return { found: orders.length > 0, orders }
  } catch (err) {
    console.error('[shopify] lookupCustomerOrders failed:', err)
    return { found: false, orders: [] }
  }
}

/**
 * El operador `phone:` de Shopify customer-search es estricto con el
 * formato — preferimos buscar por email cuando lo tenemos. Si sólo
 * hay phone, lo pasamos tal cual (Shopify normaliza E.164 internamente
 * pero acepta variantes razonables).
 */
function buildCustomerQuery(
  phone: string | undefined,
  email: string | undefined,
): string | null {
  const trimmedEmail = email?.trim()
  const trimmedPhone = phone?.trim()
  if (trimmedEmail) return `email:${trimmedEmail}`
  if (trimmedPhone) return `phone:${trimmedPhone}`
  return null
}

function toSummary(o: ShopifyOrder): OrderSummary {
  const fulfillment = (o.fulfillments ?? [])[0]
  const tracking_number =
    fulfillment?.tracking_number ??
    fulfillment?.tracking_numbers?.[0] ??
    null
  const trackingCompany = fulfillment?.tracking_company ?? null
  // Shopify only auto-fills tracking_url for built-in carriers (UPS,
  // FedEx, DHL, etc). For AR carriers (Andreani, Correo Argentino,
  // OCA) it's empty — fall back to our resolver so the AI gets a
  // working URL to paraphrase to the customer.
  const tracking_url =
    fulfillment?.tracking_url ??
    fulfillment?.tracking_urls?.[0] ??
    resolveCarrierTrackingUrl(trackingCompany, tracking_number) ??
    null
  return {
    name: o.name,
    created_at: o.created_at,
    financial_status: o.financial_status ?? 'unknown',
    fulfillment_status: o.fulfillment_status,
    total_price: o.total_price,
    currency: o.currency,
    line_items: (o.line_items ?? []).map((li) => ({
      title: li.title,
      quantity: li.quantity,
    })),
    tracking_number,
    tracking_url,
  }
}
