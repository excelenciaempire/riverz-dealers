import type { ShopifyOrder } from './shopify';
import { marcaDelLanding } from '@/lib/marketing/enlaces';

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
  | 'coupon'
  /**
   * El pedido cierra el MISMO carrito que Riverz recordó, y se compró después
   * del recordatorio. No es "le hablamos y compró algo": es "le dijimos que se
   * había olvidado este carrito y volvió a terminar este carrito".
   */
  | 'cart_recovery'
  /**
   * A esta persona se le rechazó un pago en esta misma tienda, Riverz le
   * escribió, y este es el pedido con el que volvió. El motor de recuperación
   * de Mercado Pago ya lo dio por recuperado y guardó el id del pedido.
   */
  | 'payment_recovered'
  /**
   * La persona entró a la tienda por un link que mandó Riverz —una campaña, un
   * botón de plantilla, un mensaje del asistente— y compró en esa misma visita.
   * La tienda guarda con qué URL entró; ahí vuelve nuestra marca.
   */
  | 'link_click';

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
  mirror: {
    created_by?: string | null;
    channel?: string | null;
    checkout_token?: string | null;
  } | null,
  couponOwners: Map<string, string>,
  /**
   * Carritos que Riverz recordó: `checkout_id` → cuándo salió el recordatorio.
   * Sólo entran los que no dejaron error de envío.
   */
  recoveredCarts: Map<string, string> = new Map(),
  /** Ids de pedido que el motor de pagos rechazados dio por recuperados. */
  recoveredPayments: Set<string> = new Set(),
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

  // Carrito abandonado que volvió.
  //
  // El link que se manda es el de la tienda (`abandoned_checkout_url`), así
  // que el pedido NO trae marca nuestra. La prueba es otra y es más fuerte:
  // el pedido cierra el mismo checkout que recordamos, y lo cerró DESPUÉS del
  // recordatorio. Que compre después no alcanza —pudo volver solo—, pero que
  // termine ESE carrito, el que le dijimos que se había olvidado, sí.
  //
  // Hueco conocido: `recovery_dispatched_at` lo sella el cron aunque el envío
  // falle sin lanzar (una plantilla rechazada, por ejemplo). Los que fallaron
  // con error quedan afuera al armar el mapa; los que fallan en silencio
  // todavía pasan. Es el único punto flojo de esta prueba.
  const token = (
    order.checkout_token ??
    order.cart_token ??
    mirror?.checkout_token ??
    ''
  ).trim();
  const enviado = token ? recoveredCarts.get(token) : undefined;
  if (enviado && Date.parse(order.created_at) > Date.parse(enviado)) {
    proofs.push({ kind: 'cart_recovery' });
  }

  // Pago rechazado que volvió. El motor de Mercado Pago ya hizo el cruce y
  // guardó el id del pedido con el que la persona volvió: acá sólo se lee.
  // Es la más floja de las pruebas —empareja por persona dentro de 14 días,
  // no por carrito—, pero el disparador es un pago fallido en ESTA tienda:
  // ya había decidido comprar y lo único que faltó fue que entrara la plata.
  if (recoveredPayments.has(String(order.id))) {
    proofs.push({ kind: 'payment_recovered' });
  }

  // Entró por un link nuestro y compró en esa visita.
  //
  // `landing_site` es la URL con la que la tienda vio entrar a la persona en
  // la sesión que terminó en este pedido. Que ahí esté nuestra marca significa
  // que el click salió de un mensaje de Riverz. Y como la tienda guarda la
  // sesión de ESTA compra, si la persona volvió después por un anuncio, el
  // landing es el del anuncio y acá no aparece nada — el crédito queda donde
  // corresponde sin que tengamos que decidirlo nosotros.
  const marca =
    marcaDelLanding(order.landing_site) ?? marcaDelLanding(order.referring_site);
  if (marca) {
    proofs.push({
      kind: 'link_click',
      detail: marca.campana ? `${marca.medio}/${marca.campana}` : marca.medio,
    });
  }

  return proofs;
}
