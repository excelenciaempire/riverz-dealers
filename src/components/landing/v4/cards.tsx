'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

import { useT } from '@/hooks/use-locale';
import { useReducedMotion } from '@/components/landing/landing';
import { Rise } from './bits';

/**
 * Trece funciones con copy bilingüe propio de esta portada.
 * Solo las ilustraciones se animan; las interfaces se conservan legibles.
 * Solo se publican clips revisados; el resto conserva su ilustración original.
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
  /** Imagen estática de respaldo para los nuevos clips, sin descargar un GIF. */
  staticFallback?: boolean;
};

const TILES: Tile[] = [
  {
    key: 'sec01',
    img: '/portada-b/seedance-sales.jpg',
    ratio: '16 / 9',
    animation: '/portada-b/seedance-sales.webp',
    staticFallback: true,
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
    img: '/portada-b/seedance-recovery.jpg',
    ratio: '16 / 9',
    animation: '/portada-b/seedance-recovery.webp',
    staticFallback: true,
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
  {
    key: 'sec06',
    img: '/portada-b/i-campanas.jpg',
    ratio: '16 / 9',
    animation: '/portada-b/i-campanas.webp',
    title: 'landingV4.featureCampaignsTitle',
    muted: 'landingV4.featureCampaignsMuted',
    body: 'landingV4.featureCampaignsBody',
    sm: 2,
    lg: 4,
  },
  {
    key: 'secLive',
    img: '/portada-b/i-envivo-2.jpg',
    ratio: '3 / 4',
    title: 'landingV4.featureLiveTitle',
    muted: 'landingV4.featureLiveMuted',
    body: 'landingV4.featureLiveBody',
    sm: 1,
    lg: 2,
  },
  {
    key: 'sec08',
    img: '/portada-b/i-tienda.jpg',
    ratio: '4 / 3',
    title: 'landingV4.featureStoreTitle',
    muted: 'landingV4.featureStoreMuted',
    body: 'landingV4.featureStoreBody',
    sm: 1,
    lg: 3,
  },
  {
    key: 'sec07',
    img: '/portada-b/i-bandeja-3.jpg',
    ratio: '4 / 3',
    title: 'landingV4.featureInboxTitle',
    muted: 'landingV4.featureInboxMuted',
    body: 'landingV4.featureInboxBody',
    sm: 1,
    lg: 3,
  },
  {
    key: 'sec09',
    img: '/portada-b/seedance-setup.jpg',
    ratio: '16 / 9',
    animation: '/portada-b/seedance-setup.webp',
    staticFallback: true,
    title: 'landingV4.featureSetupTitle',
    muted: 'landingV4.featureSetupMuted',
    body: 'landingV4.featureSetupBody',
    sm: 1,
    lg: 3,
  },
  {
    key: 'secContacts',
    img: '/portada-b/i-contactos-2.jpg',
    ratio: '4 / 3',
    title: 'landingV4.featureContactsTitle',
    muted: 'landingV4.featureContactsMuted',
    body: 'landingV4.featureContactsBody',
    sm: 1,
    lg: 3,
  },
  {
    key: 'sec10',
    img: '/portada-b/i-roas.jpg',
    ratio: '16 / 9',
    animation: '/portada-b/i-roas.webp',
    title: 'landingV4.featureResultsTitle',
    muted: 'landingV4.featureResultsMuted',
    body: 'landingV4.featureResultsBody',
    sm: 2,
    lg: 6,
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
            src={
              tile.staticFallback
                ? tile.img
                : tile.animation.replace(/\.webp$/, '.gif')
            }
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
