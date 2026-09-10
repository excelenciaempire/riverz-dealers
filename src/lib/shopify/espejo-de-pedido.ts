import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * EL ESPEJO DE LOS PEDIDOS DE SHOPIFY.
 *
 * Hasta ahora la tabla `orders` sólo tenía los pedidos que creaba Riverz: el
 * webhook de Shopify hacía un UPDATE y, si el pedido lo había hecho una
 * persona sola en la tienda, no matcheaba ninguna fila y el pedido no
 * quedaba en ningún lado. Medido el 2026-08-28 en el comercio piloto: 109
 * pedidos de Mercado Libre espejados contra 1 solo de Shopify, de junio,
 * mientras la tienda llevaba más de 230 ventas.
 *
 * Eso no se veía como un error. Se veía como números bajos: el historial de
 * compras del contacto vacío, las métricas sin las ventas de la tienda, y la
 * atribución sin poder cruzar un pedido con la conversación que lo originó.
 *
 * Acá se arregla en un solo lugar, con una regla clara:
 *
 *   - Si la fila YA existe (pedido creado por Riverz), se hace el mismo
 *     UPDATE angosto de siempre. Nunca se pisan las columnas que son
 *     nuestras y que Shopify no conoce: `contact_id`, `conversation_id`,
 *     `agent_id`, `channel`, `created_by`, `note`. Un upsert a secas las
 *     dejaría en null y perdería de qué charla salió cada venta.
 *   - Si NO existe, se inserta el pedido entero como `created_by: 'sync'`.
 *
 * Vale para el webhook (pedidos nuevos) y para el relleno de los viejos:
 * las dos entradas pasan por acá para que no haya dos formas distintas de
 * escribir la misma fila.
 */

/** Lo que hizo el espejo con este pedido. */
export type ResultadoDelEspejo = 'creado' | 'actualizado' | 'sin_id';

interface ArgsDelEspejo {
  platform?: 'shopify' | 'tiendanube' | 'woocommerce';
  workspaceId: string;
  shopDomain: string;
  /** El pedido tal como lo manda Shopify (webhook o Admin API). */
  order: Record<string, unknown>;
}

/**
 * El ciclo de vida del pedido del lado de Riverz. Los valores están atados al
 * CHECK de la migración 080: 'created' es el estado inicial, no existe
 * 'pending'.
 *
 * Un pedido devuelto entra como 'cancelled' y no 'refunded' por la misma
 * razón que en el resto del producto: ese valor no pasa el CHECK y el
 * escritura entera fallaba.
 */
function estadoDelPedido(order: Record<string, unknown>): string {
  const financial = (order.financial_status as string | null) ?? null;
  const fulfillment = (order.fulfillment_status as string | null) ?? null;
  if (order.cancelled_at) return 'cancelled';
  if (financial === 'refunded' || financial === 'voided') return 'cancelled';
  if (fulfillment === 'fulfilled') return 'fulfilled';
  if (financial === 'paid') return 'paid';
  return 'created';
}

function aNumero(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isNaN(n) ? null : n;
}

/**
 * El teléfono del comprador, mirando los tres lugares donde Shopify lo puede
 * dejar. Es el dato con el que después se cruza la venta con el WhatsApp de
 * esa persona, así que buscarlo en uno solo perdía la mitad de los casos.
 */
function telefonoDelPedido(order: Record<string, unknown>): string | null {
  const cliente = (order.customer ?? null) as Record<string, unknown> | null;
  const envio = (order.shipping_address ?? null) as Record<
    string,
    unknown
  > | null;
  const candidatos = [order.phone, cliente?.phone, envio?.phone];
  for (const c of candidatos) {
    const s = String(c ?? '').trim();
    if (s) return s;
  }
  return null;
}

function nombreDelCliente(order: Record<string, unknown>): string | null {
  const cliente = (order.customer ?? null) as Record<string, unknown> | null;
  const nombre = [cliente?.first_name, cliente?.last_name]
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' ');
  if (nombre) return nombre;
  const envio = (order.shipping_address ?? null) as Record<
    string,
    unknown
  > | null;
  const deEnvio = String(envio?.name ?? '').trim();
  return deEnvio || null;
}

function emailDelPedido(order: Record<string, unknown>): string | null {
  const cliente = (order.customer ?? null) as Record<string, unknown> | null;
  const e = String(order.email ?? cliente?.email ?? '').trim();
  return e || null;
}

/** El seguimiento, si Shopify ya lo cargó. */
function envioDelPedido(order: Record<string, unknown>): {
  numero: string | null;
  empresa: string | null;
  url: string | null;
} {
  const fs = Array.isArray(order.fulfillments)
    ? (order.fulfillments as Array<Record<string, unknown>>)
    : [];
  const f = fs[0];
  if (!f) return { numero: null, empresa: null, url: null };
  const numeros = Array.isArray(f.tracking_numbers) ? f.tracking_numbers : [];
  const urls = Array.isArray(f.tracking_urls) ? f.tracking_urls : [];
  return {
    numero:
      (f.tracking_number as string | null) ?? (numeros[0] as string) ?? null,
    empresa: (f.tracking_company as string | null) ?? null,
    url: (f.tracking_url as string | null) ?? (urls[0] as string) ?? null,
  };
}

/**
 * De quién es este pedido, si ya lo conocemos.
 *
 * Sólo BUSCA; nunca crea un contacto. Espejar un pedido no puede tener como
 * efecto secundario llenar la agenda del comercio de gente que jamás le
 * escribió: quien crea contactos es el canal por donde la persona habla.
 */
async function contactoDelPedido(
  db: SupabaseClient,
  workspaceId: string,
  email: string | null,
  telefono: string | null
): Promise<string | null> {
  if (email) {
    const { data } = await db
      .from('contacts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .ilike('email', email)
      .limit(1)
      .maybeSingle();
    const fila = data as { id: string } | null;
    if (fila?.id) return fila.id;
  }
  if (telefono) {
    // Por los últimos 8 dígitos, que es la regla que ya usa el resto del
    // producto para el mismo número escrito de cinco formas distintas
    // (con +54, sin el 9, con el 15 del celular argentino).
    const cola = telefono.replace(/\D/g, '').slice(-8);
    if (cola.length === 8) {
      const { data } = await db
        .from('contacts')
        .select('id')
        .eq('workspace_id', workspaceId)
        .like('phone', `%${cola}`)
        .limit(1)
        .maybeSingle();
      const fila = data as { id: string } | null;
      if (fila?.id) return fila.id;
    }
  }
  return null;
}

/**
 * Deja el pedido de Shopify en `orders`, creando la fila si no existía.
 *
 * Best-effort de punta a punta para los llamadores: lanzar acá no puede
 * tumbar el webhook que ya confirmó el pedido en la tienda.
 */
export async function espejarPedidoDeShopify(
  db: SupabaseClient,
  { workspaceId, shopDomain, order, platform = 'shopify' }: ArgsDelEspejo
): Promise<ResultadoDelEspejo> {
  const orderId = String(order.id ?? '').trim();
  if (!orderId || orderId === '0') return 'sin_id';

  const { data: existente } = await db
    .from('orders')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('shop_domain', shopDomain)
    .eq('shopify_order_id', orderId)
    .maybeSingle();

  const financial = (order.financial_status as string | null) ?? null;
  const fulfillment = (order.fulfillment_status as string | null) ?? null;
  const checkoutToken = String(
    order.checkout_token ?? order.cart_token ?? ''
  ).trim();
  const envio = envioDelPedido(order);
  const lineItems = (
    Array.isArray(order.line_items) ? order.line_items : []
  ).map((li) => {
    const item = li as Record<string, unknown>;
    return {
      title: String(item.title ?? ''),
      variant_title: String(item.variant_title ?? ''),
      variant_id: item.variant_id == null ? null : String(item.variant_id),
      quantity: Number(item.quantity ?? 1),
      price: aNumero(item.price) ?? 0,
      properties: Array.isArray(item.properties) ? item.properties : [],
    };
  });

  if (existente) {
    // La fila ya es de Riverz: se toca lo que Shopify sabe y nada más.
    const parche: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (financial) parche.financial_status = financial;
    if (fulfillment) parche.fulfillment_status = fulfillment;
    if (order.order_status_url)
      parche.order_status_url = order.order_status_url;
    if (checkoutToken) parche.checkout_token = checkoutToken;
    const total = aNumero(order.total_price);
    if (total != null) parche.total_price = total;
    parche.line_items = lineItems;
    if (envio.numero) parche.tracking_number = envio.numero;
    if (envio.empresa) parche.tracking_company = envio.empresa;
    if (envio.url) parche.tracking_url = envio.url;
    parche.status = estadoDelPedido(order);

    const { error } = await db
      .from('orders')
      .update(parche)
      .eq('id', (existente as { id: string }).id);
    if (error) throw new Error(`espejo (update): ${error.message}`);
    return 'actualizado';
  }

  const email = emailDelPedido(order);
  const telefono = telefonoDelPedido(order);
  const contactId = await contactoDelPedido(db, workspaceId, email, telefono);

  const fila = {
    workspace_id: workspaceId,
    platform,
    shop_domain: shopDomain,
    shopify_order_id: orderId,
    order_number: String(order.name ?? order.order_number ?? orderId),
    order_status_url: (order.order_status_url as string | null) ?? null,
    contact_id: contactId,
    currency: (order.currency as string | null) ?? null,
    total_price: aNumero(order.total_price) ?? 0,
    line_items: lineItems,
    customer_name: nombreDelCliente(order),
    customer_email: email,
    customer_phone: telefono,
    shipping_address: (order.shipping_address as unknown) ?? null,
    financial_status: financial,
    fulfillment_status: fulfillment,
    status: estadoDelPedido(order),
    tracking_number: envio.numero,
    tracking_company: envio.empresa,
    tracking_url: envio.url,
    checkout_token: checkoutToken || null,
    // 'sync' y no 'ai': este pedido lo hizo la persona en la tienda. Decir
    // que lo hizo la IA inflaría la atribución con ventas que no son suyas.
    created_by: 'sync',
    created_at: (order.created_at as string | null) ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await db
    .from('orders')
    .upsert(fila, { onConflict: 'workspace_id,shop_domain,shopify_order_id' });
  if (error) throw new Error(`espejo (insert): ${error.message}`);
  return 'creado';
}
