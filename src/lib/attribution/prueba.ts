import type { ShopifyOrder } from './shopify';

/**
 * Cuándo una venta es de Riverz, y cuándo sólo pasó cerca.
 *
 * El problema: "le hablamos a esta persona y después compró" no prueba nada.
 * Esa misma persona vio un anuncio de Meta, buscó la marca en Google y le
 * llegó un correo de la tienda. Si Riverz se cuelga el cartel de la venta por
 * haber hablado antes, le está robando el crédito al anuncio — y el comercio
 * lo descubre el día que apaga Riverz y las ventas no se mueven. Una cifra
 * inflada que se cae sola vale menos que una chica que aguanta.
 *
 * Así que hay dos categorías y no se mezclan:
 *
 *   PROBADA — el pedido trae una marca que puso Riverz. No hay interpretación
 *   posible: el link de pago lo armó el asistente, o el pedido lo creó él, o
 *   el carrito salía de la conversación del chat web, o entró con un cupón
 *   que se le emitió a esa persona y a nadie más. Aunque el anuncio la haya
 *   traído, el pedido pasó por acá.
 *
 *   INFLUIDA — habló con Riverz en las horas previas y compró, sin marca. Es
 *   una correlación temporal, igual que la que reporta cualquier panel de
 *   anuncios. Se muestra, se explica y NO se suma a la cifra principal.
 *
 * Este módulo resuelve la primera. La segunda se calcula en el endpoint de
 * atribución, que es donde viven las ventanas y las lentes.
 */

/** Qué marca dejó Riverz en el pedido. */
export type ProofKind =
  /** El asistente creó el pedido con su herramienta (tag `riverz-ia`). */
  | 'order_created'
  /** La persona pagó por un link que armó el asistente (`riverz_origin=ai`). */
  | 'checkout_link'
  /** El carrito venía de la conversación del chat web (`riverz_wvid`). */
  | 'webchat_cart'
  /** Entró con un cupón emitido para esa persona y nadie más. */
  | 'coupon';

export interface Proof {
  kind: ProofKind;
  /** El dato concreto que lo prueba: el cupón usado, el id del visitante. */
  detail?: string;
}

function noteAttr(order: ShopifyOrder, name: string): string | null {
  const attrs = Array.isArray(order.note_attributes) ? order.note_attributes : [];
  const found = attrs.find((a) => a?.name === name)?.value;
  const value = (found ?? '').trim();
  return value.length > 0 ? value : null;
}

function hasTag(order: ShopifyOrder, tag: string): boolean {
  return String(order.tags ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .includes(tag);
}

/**
 * Las marcas de Riverz en un pedido. Vacío = no hay prueba, y entonces la
 * venta no cuenta como propia por más que la conversación diga otra cosa.
 *
 * `mirror` es la fila espejo de `orders` cuando existe: cubre a las tiendas
 * que no son Shopify (Tiendanube, WooCommerce, Mercado Libre), donde la marca
 * no viaja en el pedido sino que la escribió Riverz al crearlo.
 *
 * `couponOwners` mapea cupón → a quién se lo emitimos, en minúsculas. Hoy lo
 * llena el Agente de IG, que emite uno por destinatario; cualquier otro emisor
 * de cupones personales entra por el mismo lugar.
 */
export function provenBy(
  order: ShopifyOrder,
  mirror: { created_by?: string | null; channel?: string | null } | null,
  couponOwners: Map<string, string>,
): Proof[] {
  const proofs: Proof[] = [];

  if (hasTag(order, 'riverz-ia') || mirror?.created_by === 'ai') {
    proofs.push({ kind: 'order_created' });
  }
  if (noteAttr(order, 'riverz_origin') === 'ai') {
    proofs.push({ kind: 'checkout_link' });
  }
  const wvid = noteAttr(order, 'riverz_wvid');
  if (wvid || mirror?.channel === 'webchat') {
    proofs.push({ kind: 'webchat_cart', detail: wvid ?? undefined });
  }
  for (const dc of order.discount_codes ?? []) {
    const code = (dc?.code ?? '').trim().toLowerCase();
    if (code && couponOwners.has(code)) {
      proofs.push({ kind: 'coupon', detail: dc?.code ?? code });
      break;
    }
  }

  return proofs;
}
