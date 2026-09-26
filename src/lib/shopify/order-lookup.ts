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

import { resolveCarrierTrackingUrl } from './carrier-tracking';
import { markShopifyConnectionExpired } from './admin-client';
import { claveDeTelefono, normalizePhone, phoneVariants } from '@/lib/whatsapp/phone-utils';

interface ShopifyLineItem {
  title: string;
  quantity: number;
  variant_title?: string | null;
  variant_id?: number | string | null;
  product_id?: number | string | null;
  properties?: Array<{ name?: string; value?: unknown }>;
}

interface ShopifyFulfillment {
  tracking_number: string | null;
  tracking_url: string | null;
  tracking_numbers?: string[] | null;
  tracking_urls?: string[] | null;
  tracking_company?: string | null;
}

interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  total_price: string;
  currency: string;
  line_items: ShopifyLineItem[];
  fulfillments?: ShopifyFulfillment[];
  // Sólo para el control de pertenencia (ver `belongsToCustomer`). Nunca
  // salen en `OrderSummary`, así que el modelo no los ve.
  email?: string | null;
  phone?: string | null;
  customer?: { email?: string | null; phone?: string | null } | null;
  shipping_address?: {
    phone?: string | null;
    address1?: string | null;
    city?: string | null;
    province?: string | null;
    zip?: string | null;
  } | null;
  cancelled_at?: string | null;
  order_status_url?: string | null;
  shipping_lines?: Array<{ title?: string | null }>;
}

interface ShopifyCustomer {
  id: number;
  email: string | null;
  phone: string | null;
}

export interface OrderSummary {
  name: string;
  created_at: string;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  currency: string;
  line_items: Array<{
    title: string;
    quantity: number;
    variant_title: string | null;
    variant_id: string | null;
    product_id?: string | null;
    properties: Array<{ name: string; value: string }>;
  }>;
  tracking_number: string | null;
  tracking_url: string | null;
  tracking_company?: string | null;
  /** La página de estado del pedido en la tienda, para mandarle al cliente. */
  order_status_url?: string | null;
  cancelled?: boolean;
  shipping_method?: string | null;
  shipping_address?: { address1: string | null; city: string | null; province: string | null; zip: string | null } | null;
}

export interface LookupOrdersResult {
  found: boolean;
  orders: OrderSummary[];
}

const ORDER_FIELDS =
  'id,name,created_at,cancelled_at,financial_status,fulfillment_status,total_price,currency,line_items,fulfillments,order_status_url,shipping_lines,shipping_address';

/**
 * Los campos de arriba MÁS los identificadores del comprador. Se piden sólo
 * en la búsqueda por número de pedido, donde hay que comprobar que el pedido
 * sea de quien está escribiendo; nunca se devuelven al modelo.
 */
const ORDER_FIELDS_WITH_OWNER = `${ORDER_FIELDS},email,phone,customer`;

/** Últimos 8 dígitos: sortea prefijos de país, formatos locales y el 15 argentino. */
const phoneKey = claveDeTelefono;

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
  customerEmail: string | undefined
): boolean {
  const email = customerEmail?.trim().toLowerCase();
  if (email) {
    const orderEmails = [order.email, order.customer?.email]
      .map((e) => e?.trim().toLowerCase())
      .filter(Boolean);
    if (orderEmails.includes(email)) return true;
  }
  const phone = phoneKey(customerPhone);
  if (phone) {
    const orderPhones = [
      order.phone,
      order.customer?.phone,
      order.shipping_address?.phone,
    ]
      .map(phoneKey)
      .filter(Boolean);
    if (orderPhones.includes(phone)) return true;
  }
  return false;
}

/**
 * Punto de entrada del tool. Toda la lógica vive acá para que el
 * agentic loop sólo tenga que importar una cosa.
 */
export async function lookupCustomerOrders(opts: {
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  customerPhone?: string;
  customerEmail?: string;
  orderNumber?: string;
}): Promise<LookupOrdersResult> {
  const base = `https://${opts.shopDomain}/admin/api/${opts.apiVersion}`;
  const headers = {
    'X-Shopify-Access-Token': opts.accessToken,
    'Content-Type': 'application/json',
  };

  try {
    // 1) Lookup directo por número de pedido (si llega).
    if (opts.orderNumber && opts.orderNumber.trim()) {
      const raw = opts.orderNumber.trim().replace(/^#/, '');
      const url = `${base}/orders.json?status=any&limit=5&name=${encodeURIComponent(
        raw
      )}&fields=${encodeURIComponent(ORDER_FIELDS_WITH_OWNER)}`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = (await res.json()) as { orders?: ShopifyOrder[] };
        // Se devuelven SÓLO los pedidos del propio cliente: el número de
        // pedido es un identificador adivinable y no prueba nada.
        const orders = (data.orders ?? [])
          .filter((o) =>
            belongsToCustomer(o, opts.customerPhone, opts.customerEmail)
          )
          .map(toSummary);
        if (orders.length > 0) {
          return { found: true, orders };
        }
      } else if (res.status === 401) {
        void markShopifyConnectionExpired(opts.shopDomain);
      }
      // Si no encontró por nombre, seguimos al fallback por cliente
      // (la clienta puede haber dado un número parcial o equivocado).
    }

    // 2) Buscar cliente por teléfono o email, después sus pedidos.
    const customer = await buscarCliente(opts.shopDomain, base, headers, opts.customerPhone, opts.customerEmail);
    if (!customer) return { found: false, orders: [] };

    const ordersUrl = `${base}/orders.json?status=any&customer_id=${
      customer.id
    }&limit=5&fields=${encodeURIComponent(ORDER_FIELDS)}`;
    const ordersRes = await fetch(ordersUrl, { headers });
    if (!ordersRes.ok) {
      if (ordersRes.status === 401) {
        void markShopifyConnectionExpired(opts.shopDomain);
      }
      return { found: false, orders: [] };
    }
    const ordersData = (await ordersRes.json()) as { orders?: ShopifyOrder[] };
    const orders = (ordersData.orders ?? []).map(toSummary);
    return { found: orders.length > 0, orders };
  } catch (err) {
    console.error('[shopify] lookupCustomerOrders failed:', err);
    return { found: false, orders: [] };
  }
}

/**
 * El cliente de Shopify que corresponde a este correo o teléfono.
 *
 * El operador `phone:` de la búsqueda de clientes compara el teléfono LITERAL
 * contra lo que se cargó en la tienda. Pasarle el de WhatsApp tal cual
 * ("5492954543767") no encontraba a quien compró como "2954543767" o
 * "+542954543767", que es como compra casi todo el mundo en Argentina. Se
 * prueban las formas conocidas y, al final, una búsqueda libre por los
 * últimos dígitos que sólo se acepta si el teléfono del cliente coincide.
 */
async function buscarCliente(
  shopDomain: string,
  base: string,
  headers: Record<string, string>,
  phone: string | undefined,
  email: string | undefined
): Promise<ShopifyCustomer | null> {
  const buscar = async (query: string, limit = 5): Promise<ShopifyCustomer[]> => {
    const res = await fetch(
      `${base}/customers/search.json?query=${encodeURIComponent(query)}&limit=${limit}`,
      { headers }
    );
    if (!res.ok) {
      if (res.status === 401) void markShopifyConnectionExpired(shopDomain);
      return [];
    }
    const data = (await res.json()) as { customers?: ShopifyCustomer[] };
    return data.customers ?? [];
  };

  const correo = email?.trim();
  if (correo) {
    const [c] = await buscar(`email:${correo}`);
    if (c) return c;
  }
  const digitos = normalizePhone(phone?.trim() ?? '');
  if (digitos.length < 8) return null;
  for (const forma of formasDelTelefono(digitos)) {
    const [c] = await buscar(`phone:${forma}`);
    if (c) return c;
  }
  const clave = claveDeTelefono(digitos);
  if (!clave) return null;
  const candidatos = await buscar(clave, 10);
  return candidatos.find((c) => claveDeTelefono(c.phone) === clave) ?? null;
}

/** Cómo puede estar cargado el mismo número en la tienda, lo más común primero. */
export function formasDelTelefono(digitos: string): string[] {
  const out = new Set<string>();
  const sumar = (d: string) => {
    if (d.length < 8) return;
    out.add(d);
    out.add(`+${d}`);
  };
  sumar(digitos);
  // Argentina: WhatsApp exige el 9 de celular; la tienda casi nunca lo guarda,
  // y muchas veces guarda el número nacional sin el 54.
  if (digitos.startsWith('549')) {
    sumar(`54${digitos.slice(3)}`);
    out.add(digitos.slice(3));
  } else if (digitos.startsWith('54')) {
    sumar(`549${digitos.slice(2)}`);
    out.add(digitos.slice(2));
  }
  for (const v of phoneVariants(digitos)) sumar(v);
  // Cada forma es una llamada a Shopify: las más probables alcanzan.
  return [...out].slice(0, 6);
}

function toSummary(o: ShopifyOrder): OrderSummary {
  // La guía del ÚLTIMO envío con guía: un pedido reenviado tiene dos, y la
  // primera es la del paquete que no llegó.
  const conGuia = (o.fulfillments ?? []).filter(
    (f) => f.tracking_number || f.tracking_numbers?.length
  );
  const fulfillment = conGuia[conGuia.length - 1] ?? (o.fulfillments ?? [])[0];
  const tracking_number =
    fulfillment?.tracking_number ?? fulfillment?.tracking_numbers?.[0] ?? null;
  const trackingCompany = fulfillment?.tracking_company ?? null;
  // Shopify only auto-fills tracking_url for built-in carriers (UPS,
  // FedEx, DHL, etc). For AR carriers (Andreani, Correo Argentino,
  // OCA) it's empty — fall back to our resolver so the AI gets a
  // working URL to paraphrase to the customer.
  const tracking_url =
    fulfillment?.tracking_url ??
    fulfillment?.tracking_urls?.[0] ??
    resolveCarrierTrackingUrl(trackingCompany, tracking_number) ??
    null;
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
      variant_title:
        li.variant_title && li.variant_title !== 'Default Title'
          ? li.variant_title
          : null,
      variant_id: li.variant_id == null ? null : String(li.variant_id),
      product_id: li.product_id == null ? null : String(li.product_id),
      properties: (li.properties ?? []).flatMap((property) => {
        const name = String(property.name ?? '').trim();
        const value = String(property.value ?? '').trim();
        return name && value && !name.startsWith('_') ? [{ name, value }] : [];
      }),
    })),
    tracking_number,
    tracking_url,
    tracking_company: trackingCompany,
    order_status_url: o.order_status_url ?? null,
    cancelled: Boolean(o.cancelled_at),
    shipping_method: o.shipping_lines?.[0]?.title ?? null,
    shipping_address: o.shipping_address
      ? {
          address1: o.shipping_address.address1 ?? null,
          city: o.shipping_address.city ?? null,
          province: o.shipping_address.province ?? null,
          zip: o.shipping_address.zip ?? null,
        }
      : null,
  };
}
