'use client';

import type { TextosChat } from './chat-app';

/**
 * El enlace de pago, como botón.
 *
 * Cuando el agente cierra la venta manda la dirección de la caja: el checkout
 * de la tienda, o un link de cobro cuando esa tienda no tiene caja propia.
 * Mostrado como texto es una tira de sesenta caracteres con parámetros a la
 * vista —`?riverz=webchat&utm_source=…`— que además de fea le pide a la persona
 * que confíe en algo que no puede leer. Justo en el último clic de la venta.
 *
 * Acá es un botón: dice a dónde va y se toca. La dirección sigue existiendo
 * debajo, así que copiar el enlace y abrirlo en otra pestaña funciona igual.
 */

/** ¿Esta dirección es una caja? */
export function esEnlaceDePago(href: string, storeOrigin: string | null): boolean {
  try {
    const url = new URL(href);
    const ruta = url.pathname.toLowerCase();

    // La caja de la tienda donde está el widget.
    if (storeOrigin && url.origin === storeOrigin) {
      // `/checkout` en Shopify y WooCommerce, `/comprar/` en Tiendanube.
      return ruta.startsWith('/checkout') || ruta.startsWith('/comprar');
    }

    // Un cobro de Mercado Pago, para las tiendas sin caja propia. Es de otro
    // dominio a propósito: ahí no se puede comparar contra el de la tienda.
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'mpago.la' || host === 'mpago.li') return true;
    if (host.endsWith('mercadopago.com') || host.endsWith('mercadopago.com.ar')) {
      return ruta.includes('/checkout') || ruta.includes('/payment');
    }
    return false;
  } catch {
    return false;
  }
}

export function BotonDePago({
  href,
  color,
  ink,
  T,
  onIr,
}: {
  href: string;
  color: string;
  ink: string;
  T: TextosChat;
  /** Para contarle a Meta que arrancó el pago. */
  onIr?: () => void;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onIr?.()}
      className="my-1 flex w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold no-underline"
      style={{ background: color, color: ink }}
    >
      {T.pagar}
    </a>
  );
}
