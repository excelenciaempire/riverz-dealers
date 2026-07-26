import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { lookupCustomerOrders } from '@/lib/shopify/order-lookup';

/**
 * "¿Dónde está mi pedido?" bajo un post.
 *
 * El Asistente ya sabía contestarlo: tiene la tool `lookup_order`. El agente de
 * comentarios no, así que prometía "lo reviso y seguimos por aquí" sin poder
 * mirarlo — y peor, como esa pregunta no es intención de compra, el filtro la
 * descartaba y a veces ni se respondía.
 *
 * Aquí se reusa EXACTAMENTE la misma consulta a Shopify que usa la tool del
 * agente (`lookupCustomerOrders`), sin loop de herramientas: es una búsqueda
 * determinista antes de redactar. Si el pedido aparece, el DM responde con el
 * estado real; si no, pide el número en vez de inventarlo.
 */

/** Señales de post-venta: preguntan por SU pedido, no por comprar. */
const POST_SALE = [
  /\bpedido\b/i,
  /\borden\b/i,
  /\bcompr[ée]\b/i,
  /\benv[íi]o\b/i,
  /\bencomienda\b/i,
  /\bpaquete\b/i,
  /\bgu[íi]a\b/i,
  /\brastre/i,
  /\btracking\b/i,
  /\bcu[áa]ndo (me )?(llega|lleg[óo]|env[íi]an)\b/i,
  /\bno (me )?(ha )?lleg[óa]\b/i,
  /\bdevoluci[óo]n\b/i,
  /\bcambio de (talla|producto)\b/i,
  /\bfactura\b/i,
];

export function looksPostSale(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  return POST_SALE.some((re) => re.test(t));
}

/** Número de pedido si lo mencionó ("#1042", "pedido 1042"). */
function orderNumberFrom(text: string): string | undefined {
  const m = text.match(/#\s?(\d{3,10})|\b(?:pedido|orden)\s*(?:n[°º]?\s*)?(\d{3,10})\b/i);
  return m ? (m[1] ?? m[2]) : undefined;
}

/**
 * Estado real del pedido para meter en el prompt, o null si no aplica (no es
 * post-venta, no hay Shopify, o no sabemos identificar a la persona).
 */
export async function loadOrderStatus(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
  text: string | null | undefined,
): Promise<string | null> {
  if (!looksPostSale(text)) return null;

  try {
    const [{ data: connRow }, { data: contactRow }] = await Promise.all([
      db
        .from('shopify_connections')
        .select('shop_domain, access_token')
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .order('installed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from('contacts').select('email, phone').eq('id', contactId).maybeSingle(),
    ]);
    const conn = connRow as { shop_domain: string; access_token: string } | null;
    const contact = contactRow as { email: string | null; phone: string | null } | null;
    const orderNumber = orderNumberFrom(text ?? '');

    // Sin tienda no hay nada que mirar. Sin forma de identificarla tampoco,
    // salvo que ella misma haya dado el número de pedido.
    if (!conn) return null;
    if (!contact?.email && !contact?.phone && !orderNumber) {
      return 'PREGUNTA POR SU PEDIDO pero no podemos identificarla: pídele el número de pedido (ej. #1042) o el correo/teléfono con el que compró. NO inventes ningún estado.';
    }

    let accessToken: string;
    try {
      accessToken = decrypt(conn.access_token);
    } catch {
      return null;
    }

    const result = await lookupCustomerOrders({
      shopDomain: conn.shop_domain,
      accessToken,
      apiVersion: '2024-10',
      customerPhone: contact?.phone ?? undefined,
      customerEmail: contact?.email ?? undefined,
      orderNumber,
    });

    if (!result.found || !result.orders?.length) {
      return 'PREGUNTA POR SU PEDIDO y no encontramos ninguno con sus datos: pídele el número de pedido o el correo/teléfono con el que compró. NO inventes estado, envío ni fecha.';
    }

    const o = result.orders[0];
    const parts = [
      'ESTADO REAL DE SU PEDIDO (respóndele ESTO, no inventes nada más):',
      `- Pedido: ${o.name}`,
      o.financial_status ? `- Pago: ${o.financial_status}` : '',
      o.fulfillment_status ? `- Envío: ${o.fulfillment_status}` : '',
      o.tracking_url
        ? `- Seguimiento: ${o.tracking_url}`
        : o.tracking_number
          ? `- Guía: ${o.tracking_number}`
          : '',
      o.line_items?.length
        ? `- Productos: ${o.line_items
            .slice(0, 3)
            .map((l) => l.title)
            .join(', ')}`
        : '',
      'Esto NO es una venta: resuelve su duda y no ofrezcas productos ni descuentos.',
    ].filter(Boolean);
    return parts.join('\n');
  } catch {
    return null;
  }
}
