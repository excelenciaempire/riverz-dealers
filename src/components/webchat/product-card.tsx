'use client';

import { useEffect, useState } from 'react';

/**
 * La tarjeta de compra.
 *
 * Cuando el agente ofrece un producto, devuelve un enlace de carrito de la
 * tienda. Mostrado como texto azul saca a la persona del chat; mostrado como
 * un botón pelado no dice qué está por comprar. Acá se resuelve el producto de
 * ese enlace y se arma lo que uno espera en una tienda: la foto, el nombre, el
 * precio y dos caminos —seguir mirando o ir a pagar.
 *
 * Los dos botones existen porque son dos intenciones distintas: "agregar" deja
 * seguir la conversación (y es donde el chat gana contra un botón de la
 * página), "ir a pagar" es para quien ya decidió y no quiere una charla más.
 *
 * Si el producto no se puede resolver —catálogo sin sincronizar, variante que
 * ya no existe— cae a la versión simple con el botón, y si eso también falla,
 * al enlace de siempre. Nunca se queda sin salida.
 */

interface Producto {
  title: string;
  image: string | null;
  url: string | null;
  price: number | null;
  currency: string | null;
}

export function ProductCard({
  path,
  href,
  variantId,
  session,
  color,
  ink,
}: {
  path: string;
  href: string;
  variantId: string;
  session?: string | null;
  color: string;
  ink: string;
}) {
  const [prod, setProd] = useState<Producto | null>(null);
  const [estado, setEstado] = useState<'idle' | 'adding' | 'added'>('idle');

  useEffect(() => {
    if (!session) return;
    let vivo = true;
    fetch(`/api/widget/product?variant=${encodeURIComponent(variantId)}`, {
      headers: { Authorization: `Bearer ${session}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d?.title) setProd(d);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [variantId, session]);

  /** Le pide al cargador —que corre en el dominio de la tienda— que agregue.
   *  `after` decide si además lo lleva al checkout. */
  const pedir = (after: 'stay' | 'checkout') => {
    if (estado !== 'idle') return;
    setEstado('adding');
    const timer = setTimeout(() => {
      window.removeEventListener('message', onReply);
      setEstado('idle');
      window.open(href, '_blank', 'noopener');
    }, 3000);

    function onReply(event: MessageEvent) {
      if (event.data?.type !== 'riverz:cart_result') return;
      clearTimeout(timer);
      window.removeEventListener('message', onReply);
      if (event.data.ok) setEstado(after === 'checkout' ? 'idle' : 'added');
      else {
        setEstado('idle');
        window.open(href, '_blank', 'noopener');
      }
    }
    window.addEventListener('message', onReply);
    window.parent?.postMessage({ type: 'riverz:add_to_cart', path, after }, '*');
  };

  const precio =
    prod?.price != null
      ? new Intl.NumberFormat('es', {
          style: 'currency',
          currency: prod.currency || 'USD',
          maximumFractionDigits: 0,
        }).format(prod.price)
      : null;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-black/10 bg-white">
      {prod?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={prod.image} alt="" className="h-32 w-full object-cover" loading="lazy" />
      ) : null}
      <div className="p-2.5">
        {prod?.title ? (
          <p className="text-sm font-semibold leading-tight text-neutral-900">{prod.title}</p>
        ) : null}
        {precio ? <p className="mt-0.5 text-sm text-neutral-600">{precio}</p> : null}
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => pedir('stay')}
            disabled={estado !== 'idle'}
            className="flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-50 disabled:opacity-60"
          >
            {estado === 'added' ? 'Agregado' : estado === 'adding' ? 'Agregando…' : 'Agregar'}
          </button>
          <button
            type="button"
            onClick={() => pedir('checkout')}
            disabled={estado === 'adding'}
            className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition disabled:opacity-60"
            style={{ background: ink, color }}
          >
            Ir a pagar
          </button>
        </div>
      </div>
    </div>
  );
}
