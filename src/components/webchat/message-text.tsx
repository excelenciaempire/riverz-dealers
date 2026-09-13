'use client';

import { ProductCard } from './product-card';
import { BotonDePago, esEnlaceDePago } from './boton-de-pago';
import type { TextosChat } from './chat-app';
import { TextoRico } from '@/components/ui/texto-rico';
import type { Locale } from '@/lib/i18n/config';

/**
 * El texto de una burbuja: con formato, con los enlaces vivos, y con el de
 * compra convertido en un botón que compra de verdad.
 *
 * El formato lo pone `TextoRico`, que es compartido con el chat que opera la
 * cuenta: los dos pintan texto escrito por un modelo y los dos lo mostraban con
 * los asteriscos a la vista. Acá queda sólo lo que es propio de la tienda.
 *
 * El enlace de compra: el agente devuelve un enlace de carrito de la tienda.
 * Mostrado como texto azul, saca a la persona del chat. Acá se lo trata como
 * lo que es —una intención de compra— y el botón le pide al cargador, que sí
 * corre en el dominio de la tienda, que agregue el producto por la API del
 * storefront. Si algo falla, el enlace se abre como siempre.
 */

function parseCartLink(
  href: string,
  origenes: string[],
): { path: string; variantId: string; lineas: number; unidades: number } | null {
  if (origenes.length === 0) return null;
  try {
    const url = new URL(href);
    if (!origenes.includes(url.origin)) return null;

    // Tiendanube y WooCommerce. El link que manda el agente es el de la ficha
    // del producto —el único que sobrevive a un copiar y pegar por WhatsApp—
    // con una marca que dice qué agregar. Sin esto, en esas dos tiendas el
    // enlace se veía como texto azul y sacaba a la persona del chat.
    const marca = /^(tn|wc):(\d+):(\d+)$/.exec(url.searchParams.get('riverz_cart') ?? '');
    if (marca) {
      return {
        path: url.pathname + url.search,
        variantId: marca[2],
        lineas: 1,
        unidades: Number(marca[3]) || 1,
      };
    }
    // El propio link de WooCommerce ya dice qué agregar.
    const woo = url.searchParams.get('add-to-cart');
    if (woo && /^\d+$/.test(woo)) {
      return {
        path: url.pathname + url.search,
        variantId: woo,
        lineas: 1,
        unidades: Number(url.searchParams.get('quantity')) || 1,
      };
    }

    // Un carrito puede traer VARIAS líneas: `/cart/111:2,222:1`.
    const m = /^\/cart\/((?:\d+:\d+)(?:,\d+:\d+)*)\/?$/.exec(url.pathname);
    if (!m) return null;
    const lineas = m[1].split(',');
    return {
      path: url.pathname + url.search,
      // La tarjeta muestra el primero: con varios productos no hay UNA foto que
      // represente el carrito, y el botón agrega todo igual.
      variantId: lineas[0].split(':')[0],
      lineas: lineas.length,
      // Las unidades importan para el precio: `/cart/111:3` es UNA línea pero
      // tres unidades, y mostrar el unitario ahí se lee como el total.
      unidades: lineas.reduce((n, l) => n + (Number(l.split(':')[1]) || 1), 0),
    };
  } catch {
    return null;
  }
}

/**
 * ¿Este enlace es la FICHA de un producto de la tienda?
 *
 * El agente manda dos clases de enlace: el de carrito, cuando cierra la venta,
 * y el de la ficha, cuando recomienda algo ("el Serum Pilar sale $39.990"). El
 * primero ya se dibujaba como tarjeta; el segundo salía como un enlace azul
 * con sus UTM a la vista y sacaba a la persona del chat — que es justo lo que
 * la tarjeta viene a evitar.
 *
 * Se reconoce por la forma del camino, que es igual en las tres plataformas:
 * la palabra de la sección y después el nombre del producto.
 */
function esFichaDeProducto(href: string, origenes: string[]): boolean {
  if (origenes.length === 0) return false;
  try {
    const url = new URL(href);
    if (!origenes.includes(url.origin)) return false;
    const tramos = url.pathname.split('/').filter(Boolean);
    if (tramos.length < 2) return false;
    const seccion = tramos[tramos.length - 2].toLowerCase();
    return ['products', 'productos', 'product', 'producto'].includes(seccion);
  } catch {
    return false;
  }
}

export function MessageText({
  text,
  storeOrigins,
  color,
  ink,
  session,
  T,
  locale = 'es',
  onIrAPagar,
}: {
  text: string;
  /** Los dominios de la tienda. Un enlace fuera de ellos nunca es una tarjeta:
   *  el agente lee mensajes de desconocidos. */
  storeOrigins: string[];
  color: string;
  ink: string;
  /** Token del chat: la tarjeta lo necesita para resolver el producto. */
  session?: string | null;
  /** El marco en el idioma del agente, para los botones de la tarjeta. */
  T: TextosChat;
  locale?: Locale;
  /** Que Meta se entere de que arrancó el pago. */
  onIrAPagar?: () => void;
}) {
  return (
    <TextoRico
      text={text}
      enlace={(href, k) => {
        // La caja va primero: el checkout de Woo lleva `add-to-cart` en la
        // dirección, así que si se mirara antes el carrito, el último clic de
        // la venta se dibujaría como una tarjeta para volver a elegir.
        if (esEnlaceDePago(href, storeOrigins)) {
          return (
            <BotonDePago
              key={k}
              href={href}
              color={color}
              ink={ink}
              T={T}
              onIr={onIrAPagar}
            />
          );
        }
        if (esFichaDeProducto(href, storeOrigins)) {
          return (
            <ProductCard
              key={k}
              path={new URL(href).pathname}
              href={href}
              fichaUrl={href}
              locale={locale}
              storeOrigin={storeOrigins[0] ?? null}
              variantId=""
              session={session}
              color={color}
              ink={ink}
              T={T}
            />
          );
        }
        const cart = parseCartLink(href, storeOrigins);
        if (cart) {
          return (
            <ProductCard
              key={k}
              path={cart.path}
              href={href}
              variantId={cart.variantId}
              locale={locale}
              lineas={cart.lineas}
              unidades={cart.unidades}
              session={session}
              color={color}
              ink={ink}
              T={T}
            />
          );
        }
        return (
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {href}
          </a>
        );
      }}
    />
  );
}
