'use client';

import { Fragment, useState, type ReactNode } from 'react';

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

function parseCartLink(href: string, storeOrigin: string | null): { path: string } | null {
  if (!storeOrigin) return null;
  try {
    const url = new URL(href);
    if (url.origin !== storeOrigin) return null;
    if (!/^\/cart\/[\w-]+:\d+/.test(url.pathname)) return null;
    return { path: url.pathname + url.search };
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
}: {
  text: string;
  storeOrigin: string | null;
  color: string;
  ink: string;
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
            return <BuyButton key={k} path={cart.path} href={part} color={color} ink={ink} />;
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

function BuyButton({
  path,
  href,
  color,
  ink,
}: {
  path: string;
  href: string;
  color: string;
  ink: string;
}) {
  const [state, setState] = useState<'idle' | 'adding' | 'added'>('idle');

  const add = () => {
    if (state !== 'idle') return;
    setState('adding');
    // El cargador contesta con el resultado real; si en dos segundos y medio no
    // dice nada —tienda que no es Shopify, API bloqueada— se abre el enlace,
    // que hace lo mismo por el camino largo.
    const timer = setTimeout(() => {
      window.removeEventListener('message', onReply);
      setState('idle');
      window.open(href, '_blank', 'noopener');
    }, 2500);

    function onReply(event: MessageEvent) {
      if (event.data?.type !== 'riverz:cart_result') return;
      clearTimeout(timer);
      window.removeEventListener('message', onReply);
      if (event.data.ok) setState('added');
      else {
        setState('idle');
        window.open(href, '_blank', 'noopener');
      }
    }
    window.addEventListener('message', onReply);
    window.parent?.postMessage({ type: 'riverz:add_to_cart', path }, '*');
  };

  return (
    <button
      type="button"
      onClick={add}
      disabled={state !== 'idle'}
      className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold transition disabled:opacity-70"
      style={{ background: ink, color }}
    >
      {state === 'added' ? (
        <>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          Agregado al carrito
        </>
      ) : state === 'adding' ? (
        'Agregando…'
      ) : (
        <>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="20" r="1" />
            <circle cx="18" cy="20" r="1" />
            <path d="M2 3h3l2.4 12.1a2 2 0 0 0 2 1.6h8.5a2 2 0 0 0 2-1.6L21 7H6" />
          </svg>
          Agregar al carrito
        </>
      )}
    </button>
  );
}
