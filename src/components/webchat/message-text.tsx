'use client';

import { Fragment, type ReactNode } from 'react';
import { ProductCard } from './product-card';

/**
 * El texto de una burbuja: con formato, con los enlaces vivos, y con el de
 * compra convertido en un botón que compra de verdad.
 *
 * **El formato no es un adorno.** El modelo escribe en Markdown —negritas para
 * el nombre del producto y para el precio, viñetas para enumerar— porque así
 * lo escribe para todos los canales. WhatsApp lo interpreta; una página web no,
 * y el cliente terminaba leyendo `**Cuesta $69.000**` con los asteriscos a la
 * vista. Se ve descuidado justo en la línea del precio.
 *
 * Se interpreta un subconjunto mínimo y se construye con nodos de React, nunca
 * con HTML crudo: el texto viene de un modelo de lenguaje y de lo que escriba
 * el visitante, así que insertarlo como HTML sería un XSS con pasos extra.
 *
 * El enlace de compra: el agente devuelve un enlace de carrito de la tienda.
 * Mostrado como texto azul, saca a la persona del chat. Acá se lo trata como
 * lo que es —una intención de compra— y el botón le pide al cargador, que sí
 * corre en el dominio de la tienda, que agregue el producto por la API del
 * storefront. Si algo falla, el enlace se abre como siempre.
 */

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;
/** Negrita, itálica y código. La cursiva exige `_` o `*` pegados a la palabra
 *  para no comerse un asterisco suelto en medio de una frase. */
const INLINE_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\s][^*\n]*\*)/g;

function parseCartLink(
  href: string,
  storeOrigin: string | null,
): { path: string; variantId: string } | null {
  if (!storeOrigin) return null;
  try {
    const url = new URL(href);
    if (url.origin !== storeOrigin) return null;
    const m = /^\/cart\/(\d+):\d+/.exec(url.pathname);
    if (!m) return null;
    return { path: url.pathname + url.search, variantId: m[1] };
  } catch {
    return null;
  }
}

/** Negritas / itálicas / código dentro de un fragmento sin enlaces. */
function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE_RE).map((part, i) => {
    const k = `${keyBase}-${i}`;
    if (/^\*\*[^*\n]+\*\*$/.test(part) || /^__[^_\n]+__$/.test(part)) {
      return <strong key={k}>{part.slice(2, -2)}</strong>;
    }
    if (/^`[^`\n]+`$/.test(part)) {
      return (
        <code key={k} className="rounded bg-black/5 px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (/^\*[^*\s][^*\n]*\*$/.test(part)) {
      return <em key={k}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={k}>{part}</Fragment>;
  });
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
  // Se trabaja por líneas para poder reconocer viñetas sin un parser entero.
  const lineas = text.split('\n');

  return (
    <>
      {lineas.map((linea, li) => {
        const vineta = /^\s*[-*•]\s+(.*)$/.exec(linea);
        const numerada = /^\s*(\d+)[.)]\s+(.*)$/.exec(linea);
        const contenido = vineta ? vineta[1] : numerada ? numerada[2] : linea;

        const nodos = contenido.split(URL_RE).map((part, i) => {
          const k = `${li}-${i}`;
          if (i % 2 === 0) return <Fragment key={k}>{inline(part, k)}</Fragment>;
          const cart = parseCartLink(part, storeOrigin);
          if (cart) {
            return (
              <ProductCard
                key={k}
                path={cart.path}
                href={part}
                variantId={cart.variantId}
                session={session}
                color={color}
                ink={ink}
              />
            );
          }
          return (
            <a
              key={k}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {part}
            </a>
          );
        });

        if (vineta || numerada) {
          return (
            <span key={li} className="flex gap-1.5">
              <span className="shrink-0 opacity-60">{numerada ? `${numerada[1]}.` : '•'}</span>
              <span>{nodos}</span>
            </span>
          );
        }
        // Una línea vacía es un salto de párrafo; se conserva porque el modelo
        // separa ideas con ella y sin eso el mensaje queda en un bloque.
        return (
          <Fragment key={li}>
            {linea.trim() === '' ? <span className="block h-2" /> : <span>{nodos}</span>}
          </Fragment>
        );
      })}
    </>
  );
}
