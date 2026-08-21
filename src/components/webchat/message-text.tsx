'use client';

import { ProductCard } from './product-card';
import { TextoRico } from '@/components/ui/texto-rico';

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
  storeOrigin: string | null,
): { path: string; variantId: string; lineas: number; unidades: number } | null {
  if (!storeOrigin) return null;
  try {
    const url = new URL(href);
    if (url.origin !== storeOrigin) return null;
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

export function MessageText({
  text,
  storeOrigin,
  color,
  ink,
  session,
}: {
  text: string;
  storeOrigin: string | null;
  color: string;
  ink: string;
  /** Token del chat: la tarjeta lo necesita para resolver el producto. */
  session?: string | null;
}) {
  return (
    <TextoRico
      text={text}
      enlace={(href, k) => {
        const cart = parseCartLink(href, storeOrigin);
        if (cart) {
          return (
            <ProductCard
              key={k}
              path={cart.path}
              href={href}
              variantId={cart.variantId}
              lineas={cart.lineas}
              unidades={cart.unidades}
              session={session}
              color={color}
              ink={ink}
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
