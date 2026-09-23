'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

import { useT } from '@/hooks/use-locale';
import { useReducedMotion } from '@/components/landing/landing';
import { Rise } from './bits';

/**
 * Qué hace — el mosaico.
 *
 * Trece funcionalidades, trece ilustraciones. Ninguna repetida.
 *
 * Por acá pasaron tres versiones. Trece fichas idénticas con la misma vista
 * previa en el mismo marco de navegador: a la quinta se lee como una lista y se
 * saltea. Fotografía de objetos: linda y muda —una canasta volcada no explica
 * qué es recuperar un carrito—. Diagramas de interfaz dibujados en HTML:
 * precisos, pero al tamaño de una ficha se leen como una captura chica más.
 *
 * Lo que quedó es ilustración editorial plana, en el mismo registro que la del
 * hero: cuatro colores, formas geométricas, grano de risografía y una idea
 * gráfica por función que se entiende antes de leer el título. El carrito que
 * se escapa y el lazo amarillo que lo trae. El reloj cuyas horas son burbujas.
 * La clepsidra con tres granos. Son imágenes, no capturas, así que compiten en
 * el terreno donde una landing se gana: el primer segundo.
 *
 * Ninguna lleva texto adentro, a propósito: las letras generadas salen
 * deformes y además habría que dibujar cada imagen dos veces, una por idioma.
 *
 * Los anchos son cuatro y las filas suman seis columnas de formas distintas,
 * así que el ojo nunca encuentra el mismo ritmo dos veces. Los huecos los
 * rellena `grid-auto-flow: dense`.
 *
 * EL ORDEN NO ES CASUAL. Siete de las trece se mueven, y están puestas para
 * que en escritorio caiga **una animación por fila** —las siete filas de la
 * cuadrícula, una cada una— y en móvil, que es una sola columna, queden
 * alternadas: se mueve, quieta, se mueve, quieta. Trece cosas moviéndose a la
 * vez no se leen como riqueza, se leen como una vidriera de electrodomésticos.
 *
 * Cuáles se mueven: las ILUSTRADAS. Las tres que son interfaz de verdad
 * —bandeja, contactos, en vivo— se quedan quietas a propósito, porque un
 * modelo de video les derrite los logos, y porque una captura que tiembla se
 * lee como un error.
 *
 * Los textos salen del catálogo `landing`: son las trece funciones de la
 * portada principal, con sus palabras. Si mañana se corrige una, se corrige en
 * un solo lugar y las tres portadas quedan iguales.
 */

type Tile = {
  key: string;
  title: string;
  muted: string;
  body: string;
  /** Ancho en la cuadrícula de 2 columnas (tablet) y en la de 6 (escritorio). */
  sm: 1 | 2;
  lg: 2 | 3 | 4 | 6;
  /** La ilustración y su proporción, generada a esa misma medida. */
  img: string;
  ratio: string;
  /** Animación sin controles de video, compatible con Safari en ahorro de energía. */
  animation?: string;
};

const TILES: Tile[] = [
  {
    key: 'sec01',
    img: '/portada-b/i-vendedor.jpg',
    ratio: '16 / 9',
    animation: '/portada-b/i-vendedor.webp',
    title: 'landingV4.featureSalesTitle',
    muted: 'landingV4.featureSalesMuted',
    body: 'landingV4.featureSalesBody',
    sm: 2,
    lg: 4,
  },
  {
    key: 'secVoice',
    img: '/portada-b/i-llamadas.jpg',
    ratio: '3 / 4',
    title: 'landingV4.featureVoiceTitle',
    muted: 'landingV4.featureVoiceMuted',
    body: 'landingV4.featureVoiceBody',
    sm: 1,
    lg: 2,
  },
  {
    key: 'sec02',
    img: '/portada-b/i-carritos.jpg',
    ratio: '4 / 3',
    animation: '/portada-b/i-carritos.webp',
    title: 'landingV4.featureRecoveryTitle',
    muted: 'landingV4.featureRecoveryMuted',
    body: 'landingV4.featureRecoveryBody',
    sm: 1,
    lg: 3,
  },
  {
    key: 'sec04',
    img: '/portada-b/i-atencion.jpg',
    ratio: '4 / 3',
    title: 'landingV4.featureSupportTitle',
    muted: 'landingV4.featureSupportMuted',
    body: 'landingV4.featureSupportBody',
    sm: 1,
    lg: 3,
  },
  {
    key: 'sec05',
    img: '/portada-b/i-comentarios.jpg',
    ratio: '4 / 3',
    title: 'landingV4.featureCommentsTitle',
    muted: 'landingV4.featureCommentsMuted',
    body: 'landingV4.featureCommentsBody',
    sm: 1,
    lg: 3,
  },
  {
    key: 'sec03',
    img: '/portada-b/i-recompras-2.jpg',
    ratio: '4 / 3',
    title: 'landingV4.featureRetentionTitle',
    muted: 'landingV4.featureRetentionMuted',
    body: 'landingV4.featureRetentionBody',
    sm: 1,
    lg: 3,
  },
];

// Tailwind necesita las clases enteras en el archivo para poder verlas; por eso
// van en un mapa y no armadas con plantillas de texto.
const SM = { 1: 'sm:col-span-1', 2: 'sm:col-span-2' } as const;
const LG = {
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  6: 'lg:col-span-6',
} as const;

export function Cards() {
  const t = useT();

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:[grid-auto-flow:dense] lg:grid-cols-6 lg:gap-6">
      {TILES.map((tile, i) => (
        <Rise
          key={tile.key}
          delay={(i % 2) * 80}
          className={`min-w-0 ${SM[tile.sm]} ${LG[tile.lg]}`}
        >
          <article className="sn-card flex h-full min-w-0 flex-col overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-8">
              <h3 className="sn-h3 max-w-[20ch]">
                {t(tile.title)}{' '}
                <span style={{ color: 'var(--sn-muted)' }}>
                  {t(tile.muted)}
                </span>
              </h3>

              <p className="sn-body mt-3 max-w-[48ch] !text-[15px]">
                {t(tile.body)}
              </p>

              {/* La ilustración va al pie y crece con la ficha. `mt-auto` la
                  empuja abajo, así que las fichas de una misma fila alinean la
                  imagen aunque el texto mida distinto.

                  El fondo de la imagen es el mismo crema de la ficha, así que
                  no hace falta marco ni sombra: la ilustración se apoya en el
                  papel y las esquinas redondeadas alcanzan. */}
              <div className="mt-auto min-w-0 pt-8">
                <Ilustracion tile={tile} />
              </div>
            </div>
          </article>
        </Rise>
      ))}
    </div>
  );
}

/**
 * La pieza de abajo de cada ficha: imagen siempre, animación cuando la hay.
 *
 * El WebP animado no se descarga hasta que la ficha se acerca a la pantalla.
 * Safari puede bloquear el autoplay de un MP4 en ahorro de energía y mostrar
 * un botón de reproducción encima de la ilustración. El GIF de respaldo cubre
 * navegadores anteriores a WebP animado.
 *
 * Al alejarse se desmonta para evitar animaciones fuera de pantalla. La imagen
 * fija queda de fondo durante la carga y cuando se prefiere menos movimiento.
 */
function Ilustracion({ tile }: { tile: Tile }) {
  const reduced = useReducedMotion();
  const caja = useRef<HTMLDivElement>(null);
  const [cerca, setCerca] = useState(false);

  useEffect(() => {
    const el = caja.current;
    if (!el || !tile.animation || reduced) return;

    if (!('IntersectionObserver' in window)) {
      const frame = requestAnimationFrame(() => setCerca(true));
      return () => cancelAnimationFrame(frame);
    }

    const io = new IntersectionObserver(
      ([e]) => {
        setCerca(e.isIntersecting);
      },
      { rootMargin: '300px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tile.animation, reduced]);

  return (
    <div
      ref={caja}
      className="relative w-full overflow-hidden rounded-2xl"
      style={{ aspectRatio: tile.ratio, background: 'var(--sn-sand)' }}
    >
      <Image
        src={tile.img}
        alt=""
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 40vw"
        className="object-cover"
        aria-hidden
      />
      {tile.animation && !reduced && cerca && (
        <picture className="absolute inset-0 block">
          <source srcSet={tile.animation} type="image/webp" />
          <Image
            src={tile.animation.replace(/\.webp$/, '.gif')}
            alt=""
            fill
            unoptimized
            loading="eager"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 40vw"
            aria-hidden
            className="object-cover"
          />
        </picture>
      )}
    </div>
  );
}
