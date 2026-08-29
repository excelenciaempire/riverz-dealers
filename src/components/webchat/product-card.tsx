'use client';

import { useEffect, useState } from 'react';
import type { TextosChat } from './chat-app';
import { rearmar } from './rearmar-carrito';

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

interface Variante {
  id: string;
  label: string;
  price: number | null;
  available: boolean;
}

interface Producto {
  title: string;
  image: string | null;
  url: string | null;
  price: number | null;
  currency: string | null;
  variants?: Variante[];
  /** Sólo cuando se resolvió por ficha: con qué variante y con qué enlace
   *  comprar. Sin esto la tarjeta de una recomendación no tendría con qué
   *  agregar nada. */
  variant?: string | null;
  cart_url?: string | null;
}

export function ProductCard({
  path,
  href,
  variantId,
  fichaUrl,
  lineas = 1,
  unidades = 1,
  session,
  color,
  ink,
  T,
}: {
  path: string;
  href: string;
  /** Vacío cuando el enlace es la FICHA del producto: ahí la variante la
   *  resuelve el servidor. */
  variantId: string;
  /** La ficha, cuando el agente recomendó sin cerrar la venta. */
  fichaUrl?: string;
  /** Cuántos productos distintos trae el carrito. */
  lineas?: number;
  /** Cuántas unidades en total. Con más de una, el unitario no es el total. */
  unidades?: number;
  session?: string | null;
  color: string;
  ink: string;
  /** El marco del chat, en el idioma del agente. La tarjeta era lo único que
   *  quedaba cableado en español: una tienda inglesa le mostraba "Agregar" y
   *  "Ir a pagar" a sus clientes. */
  T: TextosChat;
}) {
  const [prod, setProd] = useState<Producto | null>(null);
  // Lo que la persona elige ACA, sin volver a escribirle al agente.
  const [variante, setVariante] = useState(variantId);
  const [cuantos, setCuantos] = useState(Math.max(1, unidades));
  const [estado, setEstado] = useState<'idle' | 'adding' | 'added'>('idle');

  useEffect(() => {
    if (!session) return;
    let vivo = true;
    // Por variante cuando el enlace es un carrito; por ficha cuando el agente
    // recomendó el producto sin cerrar la venta.
    const pregunta = variante
      ? `variant=${encodeURIComponent(variante)}`
      : `url=${encodeURIComponent(fichaUrl ?? href)}`;
    fetch(`/api/widget/product?${pregunta}`, {
      headers: { Authorization: `Bearer ${session}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!vivo || !d?.title) return;
        setProd(d);
        // Resuelto por ficha: recién ahora se sabe qué variante ofrecer. Al
        // fijarla, este efecto vuelve a correr por variante y el resto de la
        // tarjeta funciona igual que la de un carrito.
        if (!variante && d.variant) setVariante(String(d.variant));
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [variante, session, fichaUrl, href]);

  // El enlace que se va a usar: el que armó el agente, con la variante y la
  // cantidad que la persona eligió en la tarjeta. Si el enlace trae varios
  // productos no se toca —ahí "la cantidad" no significa nada— y se usa el
  // original.
  // Con una ficha, el enlace que compra no es el que mandó el agente: lo arma
  // el servidor con la variante por defecto. Recién con ese enlace la tarjeta
  // puede agregar al carrito en vez de sólo abrir la página.
  const base = prod?.cart_url || href;
  const rutaBase = (() => {
    try {
      const u = new URL(base);
      return u.pathname + u.search;
    } catch {
      return path;
    }
  })();
  const elegido = rearmar(base, { variantId: variante, cantidad: cuantos });
  const rutaViva = elegido?.path ?? rutaBase;
  const hrefVivo = elegido?.href ?? base;
  const ajustable = !!elegido && lineas === 1;

  /** Le pide al cargador —que corre en el dominio de la tienda— que agregue.
   *  `after` decide si además lo lleva al checkout. */
  const pedir = (after: 'stay' | 'checkout') => {
    if (estado === 'adding') return;

    // Ya agregado y ahora quiere pagar: el producto está en el carrito, así que
    // volver a agregarlo le cobraba dos unidades de algo que pidió una vez.
    // Antes esto no llegaba a pasar por otro motivo peor — el botón quedaba
    // vivo a la vista y no hacía nada, que es el último clic del embudo.
    if (estado === 'added') {
      if (after === 'checkout') window.parent?.postMessage({ type: 'riverz:go_checkout', path: rutaViva }, '*');
      return;
    }

    setEstado('adding');
    const timer = setTimeout(() => {
      window.removeEventListener('message', onReply);
      setEstado('idle');
      window.open(hrefVivo, '_blank', 'noopener');
    }, 3000);

    function onReply(event: MessageEvent) {
      // Sólo del contenedor: cualquier página que embeba el chat podía fingir
      // un "listo, agregado" sin que nada se hubiera agregado.
      if (event.source !== window.parent) return;
      if (event.data?.type !== 'riverz:cart_result') return;
      clearTimeout(timer);
      window.removeEventListener('message', onReply);
      if (event.data.ok) setEstado(after === 'checkout' ? 'idle' : 'added');
      else {
        setEstado('idle');
        window.open(hrefVivo, '_blank', 'noopener');
      }
    }
    window.addEventListener('message', onReply);
    window.parent?.postMessage({ type: 'riverz:add_to_cart', path: rutaViva, after }, '*');
  };

  // Sin moneda no se inventa una: con `currency` vacío se caía a USD y un
  // precio de 69.900 pesos se mostraba como "US$ 69.900". Mejor el número solo
  // que un número en la moneda de otro país.
  const plata = (n: number) =>
    prod?.currency
      ? new Intl.NumberFormat('es', {
          style: 'currency',
          currency: prod.currency,
          maximumFractionDigits: 0,
        }).format(n)
      : new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(n);

  const precio = prod?.price == null ? null : plata(prod.price);

  // Las opciones con nombre. Una sola no es una opción: mostrar un selector
  // con un único valor es pedirle a alguien que elija lo que ya está elegido.
  const opciones = (prod?.variants ?? []).filter((v) => v.label);

  // Lo que se va a llevar, cuando es más de uno. El unitario ahí se lee como
  // el total y la sorpresa llega en el checkout.
  const totalVisible =
    prod?.price != null && cuantos > 1 && lineas === 1 ? plata(prod.price * cuantos) : null;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-black/10 bg-white">
      {prod?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={prod.image} alt="" className="h-32 w-full object-cover" loading="lazy" />
      ) : null}
      <div className="p-2.5">
        {prod?.title ? (
          <p className="text-sm font-semibold leading-tight text-neutral-900">
            {prod.title}
            {/* Con varios productos la tarjeta muestra el primero, y decirlo
                evita que la persona crea que el botón agrega sólo ése. */}
            {lineas > 1 ? (
              <span className="font-normal text-neutral-500"> {T.yMas(lineas - 1)}</span>
            ) : null}
          </p>
        ) : null}
        {/* Sólo si el precio que se muestra ES lo que se va a cobrar: con
            varios productos o varias unidades, el unitario engaña. */}
        {precio && lineas === 1 && cuantos === 1 ? (
          <p className="mt-0.5 text-sm text-neutral-600">{precio}</p>
        ) : null}

        {/* Elegir el talle acá y no volviendo a escribirle al agente.
            Sólo si hay más de una opción CON nombre: un selector que dice
            "Default Title" es ruido. */}
        {ajustable && opciones.length > 1 ? (
          <select
            aria-label={T.opcion}
            value={variante}
            onChange={(e) => {
              setVariante(e.target.value);
              // Cambió de producto: lo que ya estaba agregado era el otro.
              setEstado('idle');
            }}
            className="mt-2 w-full rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-900"
          >
            {opciones.map((v) => (
              <option key={v.id} value={v.id} disabled={!v.available}>
                {v.label}
                {v.available ? '' : ` — ${T.sinStock}`}
              </option>
            ))}
          </select>
        ) : null}

        {/* Cuántos. Mover un número no debería costar dos turnos de chat. */}
        {ajustable ? (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] text-neutral-500">{T.cantidad}</span>
            <div className="flex items-center rounded-lg border border-neutral-300">
              <button
                type="button"
                aria-label={T.menos}
                disabled={cuantos <= 1 || estado === 'adding'}
                onClick={() => {
                  setCuantos((n) => Math.max(1, n - 1));
                  setEstado('idle');
                }}
                className="px-2 py-1 text-sm text-neutral-700 disabled:opacity-40"
              >
                −
              </button>
              <span className="min-w-6 text-center text-xs tabular-nums text-neutral-900">
                {cuantos}
              </span>
              <button
                type="button"
                aria-label={T.mas}
                disabled={cuantos >= 20 || estado === 'adding'}
                onClick={() => {
                  setCuantos((n) => Math.min(20, n + 1));
                  setEstado('idle');
                }}
                className="px-2 py-1 text-sm text-neutral-700 disabled:opacity-40"
              >
                +
              </button>
            </div>
            {/* El total de lo que se va a llevar, cuando es más de uno: el
                unitario ahí se lee como el total y decepciona en el checkout. */}
            {totalVisible ? (
              <span className="ml-auto text-xs font-medium text-neutral-900">{totalVisible}</span>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            onClick={() => pedir('stay')}
            disabled={estado !== 'idle'}
            className="flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-xs font-semibold text-neutral-900 transition hover:bg-neutral-50 disabled:opacity-60"
          >
            {estado === 'added' ? T.agregado : estado === 'adding' ? T.agregando : T.agregar}
          </button>
          <button
            type="button"
            onClick={() => pedir('checkout')}
            disabled={estado === 'adding'}
            className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition disabled:opacity-60"
            style={{ background: ink, color }}
          >
            {T.pagar}
          </button>
        </div>
      </div>
    </div>
  );
}
