import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact } from '@/types';
import { linkUnifiedContact } from '@/lib/contacts/dedupe';

/**
 * Atar una compra al chat que la produjo.
 *
 * El problema que resuelve: quien habla por el chat web es anónimo —un id que
 * guardó su navegador— y quien compra es un nombre con correo y dirección. Son
 * la misma persona y hasta acá eran dos desconocidos distintos. El comercio
 * veía una conversación por un lado y una venta por el otro, sin forma de
 * saber que una llevó a la otra.
 *
 * Cómo se cierra el círculo: el cargador deja el id del visitante pegado al
 * carrito de la tienda (`riverz_wvid`). Shopify arrastra los atributos del
 * carrito hasta el pedido, así que el webhook los recibe. Con ese id se
 * encuentra al contacto del chat, se le completan los datos reales que trajo
 * la compra y se lo fusiona con el cliente que el comercio ya conocía por
 * WhatsApp o por compras anteriores (`linkUnifiedContact`, migración 050).
 *
 * De yapa, el agente deja de hablarle a un desconocido: a partir de la próxima
 * pregunta lee su historial y sus pedidos como los de cualquier cliente.
 *
 * El pedido queda espejado en `orders` con su `conversation_id`, que es lo que
 * después permite medir cuánto vendió el chat sin inventar ninguna tabla.
 *
 * Todo es best-effort: un fallo acá no puede tumbar el webhook de pedidos, que
 * tiene cosas más urgentes que hacer.
 */

interface ShopifyNoteAttribute {
  name?: string;
  value?: string;
}

/** El id de visitante que viajó pegado al carrito, si viajó. */
export function visitorIdFromOrder(order: Record<string, unknown>): string | null {
  const attrs = Array.isArray(order.note_attributes)
    ? (order.note_attributes as ShopifyNoteAttribute[])
    : [];
  const found = attrs.find((a) => a?.name === 'riverz_wvid')?.value;
  const value = (found ?? '').trim();
  return /^wv_[0-9a-f-]{36}$/.test(value) ? value : null;
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : null;
}

export async function attributeWebchatOrder(
  admin: SupabaseClient,
  args: {
    workspaceId: string;
    shopDomain: string;
    order: Record<string, unknown>;
  },
): Promise<{ attributed: boolean }> {
  const visitorId = visitorIdFromOrder(args.order);
  if (!visitorId) return { attributed: false };

  const { data } = await admin
    .from('contacts')
    .select('*')
    .eq('workspace_id', args.workspaceId)
    .eq('channel', 'webchat')
    .eq('external_id', visitorId)
    .maybeSingle();
  const contact = data as Contact | null;
  // Un carrito estampado por alguien que abrió el widget y nunca escribió no
  // tiene contacto. No se crea uno: mirar no es hablar.
  if (!contact) return { attributed: false };

  const order = args.order;
  const customer = (order.customer ?? {}) as Record<string, unknown>;
  const shipping = (order.shipping_address ?? {}) as Record<string, unknown>;
  const email = String(order.email ?? customer.email ?? '').trim().toLowerCase();
  const phone = String(
    order.phone ?? customer.phone ?? shipping.phone ?? '',
  ).trim();
  const name = [customer.first_name, customer.last_name]
    .filter((p) => p && String(p).trim())
    .join(' ')
    .trim();

  // Sólo se completa lo que falta: la compra trae datos ciertos, pero no puede
  // pisar lo que el comercio ya corrigió a mano.
  const patch: Record<string, string> = {};
  if (email && !contact.email) patch.email = email;
  if (phone && !contact.phone) patch.phone = phone;
  if (name && !contact.name) patch.name = name;

  let enriched = contact;
  if (Object.keys(patch).length > 0) {
    const { data: updated } = await admin
      .from('contacts')
      .update(patch)
      .eq('id', contact.id)
      .select('*')
      .single();
    if (updated) enriched = updated as Contact;
  }

  // Acá el visitante anónimo deja de serlo: si su correo o su teléfono ya
  // existían en otro canal, los dos contactos pasan a ser el mismo cliente.
  await linkUnifiedContact(admin, enriched).catch(() => enriched.id);

  const { data: conversation } = await admin
    .from('conversations')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('contact_id', contact.id)
    .eq('channel', 'webchat')
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const conversationId = (conversation as { id?: string } | null)?.id ?? null;

  // Espejo del pedido. Si la IA ya lo había creado con su herramienta, esa
  // fila existe y sólo se le completa la conversación; si la compra la hizo la
  // persona sola en el checkout —el caso normal— se crea acá.
  const shopifyOrderId = order.id != null ? String(order.id) : null;
  if (!shopifyOrderId) return { attributed: true };

  // Acotado al workspace, además de a la tienda. La misma tienda puede estar
  // conectada a dos cuentas —pasa con el reclamo diferido y con las de prueba—,
  // y sin este corte la actualización de abajo le pisaba `contact_id` y
  // `channel` a la fila de la OTRA cuenta; con dos filas coincidiendo,
  // `maybeSingle` devolvía error y el pedido terminaba duplicado.
  const { data: existing } = await admin
    .from('orders')
    .select('id')
    .eq('workspace_id', args.workspaceId)
    .eq('shop_domain', args.shopDomain)
    .eq('shopify_order_id', shopifyOrderId)
    .maybeSingle();

  if (existing) {
    await admin
      .from('orders')
      .update({
        contact_id: contact.id,
        conversation_id: conversationId,
        channel: 'webchat',
        updated_at: new Date().toISOString(),
      })
      .eq('id', (existing as { id: string }).id);
    return { attributed: true };
  }

  await admin.from('orders').insert({
    workspace_id: args.workspaceId,
    contact_id: contact.id,
    conversation_id: conversationId,
    channel: 'webchat',
    shop_domain: args.shopDomain,
    shopify_order_id: shopifyOrderId,
    order_number: order.order_number != null ? String(order.order_number) : null,
    order_status_url: (order.order_status_url as string | null) ?? null,
    currency: (order.currency as string | null) ?? null,
    total_price: num(order.total_price),
    line_items: Array.isArray(order.line_items) ? order.line_items : [],
    customer_name: name || null,
    customer_phone: phone || null,
    customer_email: email || null,
    shipping_address: Object.keys(shipping).length > 0 ? shipping : null,
    financial_status: (order.financial_status as string | null) ?? 'pending',
    fulfillment_status: (order.fulfillment_status as string | null) ?? null,
    status: order.financial_status === 'paid' ? 'paid' : 'created',
    // 'sync' y no 'webchat': la columna admite sólo ai | sync | manual, y de
    // las tres ésta es la correcta — el pedido lo hizo el cliente en el
    // checkout de la tienda y acá se está espejando, no creando. Que haya
    // salido del chat lo dice `channel`, que es por donde se cuenta.
    created_by: 'sync',
  });

  return { attributed: true };
}
