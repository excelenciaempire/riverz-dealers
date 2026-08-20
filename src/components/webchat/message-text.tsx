'use client';

import { Fragment, useState } from 'react';

/**
 * El texto de una burbuja, con los enlaces vivos — y con el de compra
 * convertido en un botón que compra de verdad.
 *
 * El agente ya sabe armar un carrito: su herramienta de checkout devuelve un
 * enlace de la tienda del tipo `/cart/{variante}:{cantidad}`. Mostrado como
 * texto azul, ese enlace saca a la persona del chat y la deja en otra página
 * con la conversación cerrada detrás.
 *
 * Acá se lo trata como lo que es —una intención de compra— y se resuelve sin
 * salir: el botón le pide al cargador, que sí corre en el dominio de la
 * tienda, que agregue el producto al carrito por la API del storefront. La
 * persona sigue conversando y el carrito ya tiene lo suyo. Si algo falla, el
 * enlace sigue estando y se abre como siempre.
 */

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

/** ¿Es un enlace de carrito de la tienda de este comercio? Sólo esos se
 *  convierten en botón: cualquier otro enlace es un enlace. */
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
  const parts = text.split(URL_RE);

  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const cart = parseCartLink(part, storeOrigin);
        if (cart) return <BuyButton key={i} path={cart.path} href={part} color={color} ink={ink} />;
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {part}
          </a>
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
    // El cargador contesta con el resultado real; si en dos segundos no dice
    // nada —tienda que no es Shopify, API bloqueada— se abre el enlace, que
    // hace lo mismo por el camino largo.
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
