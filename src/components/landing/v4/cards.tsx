"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import { useT } from "@/hooks/use-locale";
import { useReducedMotion } from "@/components/landing/landing";
import { Rise } from "./bits";

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
  /**
   * Las cuatro que se animan. La imagen sigue existiendo y hace de cartel: es
   * lo que se ve mientras el video no cargó, y lo único que se ve si la
   * persona pidió menos movimiento.
   */
  video?: string;
};

const TILES: Tile[] = [
  {
    key: "sec01",
    img: "/portada-b/i-vendedor.jpg",
    ratio: "16 / 9",
    title: "landing.sec01Title",
    muted: "landing.sec01TitleMuted",
    body: "landing.sec01Body",
    sm: 2,
    lg: 4,
  },
  {
    key: "secVoice",
    img: "/portada-b/i-llamadas.jpg",
    ratio: "3 / 4",
    title: "landing.secVoiceTitle",
    muted: "landing.secVoiceTitleMuted",
    body: "landing.secVoiceBody",
    sm: 1,
    lg: 2,
  },
  {
    key: "sec02",
    video: "/portada-b/i-carritos.mp4",
    img: "/portada-b/i-carritos.jpg",
    ratio: "4 / 3",
    title: "landing.sec02Title",
    muted: "landing.sec02TitleMuted",
    body: "landing.sec02Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec04",
    img: "/portada-b/i-atencion.jpg",
    ratio: "4 / 3",
    title: "landing.sec04Title",
    muted: "landing.sec04TitleMuted",
    body: "landing.sec04Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec03",
    img: "/portada-b/i-recompras.jpg",
    ratio: "4 / 3",
    title: "landing.sec03Title",
    muted: "landing.sec03TitleMuted",
    body: "landing.sec03Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec05",
    img: "/portada-b/i-comentarios.jpg",
    ratio: "4 / 3",
    title: "landing.sec05Title",
    muted: "landing.sec05TitleMuted",
    body: "landing.sec05Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec06",
    video: "/portada-b/i-campanas.mp4",
    img: "/portada-b/i-campanas.jpg",
    ratio: "16 / 9",
    title: "landing.sec06Title",
    muted: "landing.sec06TitleMuted",
    body: "landing.sec06Body",
    sm: 2,
    lg: 4,
  },
  {
    key: "secLive",
    img: "/portada-b/i-envivo.jpg",
    ratio: "3 / 4",
    title: "landing.secLiveTitle",
    muted: "landing.secLiveTitleMuted",
    body: "landing.secLiveBody",
    sm: 1,
    lg: 2,
  },
  {
    key: "sec07",
    img: "/portada-b/i-bandeja.jpg",
    ratio: "4 / 3",
    title: "landing.sec07Title",
    muted: "landing.sec07TitleMuted",
    body: "landing.sec07Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec08",
    img: "/portada-b/i-tienda.jpg",
    ratio: "4 / 3",
    title: "landing.sec08Title",
    muted: "landing.sec08TitleMuted",
    body: "landing.sec08Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "secContacts",
    img: "/portada-b/i-contactos.jpg",
    ratio: "4 / 3",
    title: "landing.secContactsTitle",
    muted: "landing.secContactsTitleMuted",
    body: "landing.secContactsBody",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec09",
    video: "/portada-b/i-minutos.mp4",
    img: "/portada-b/i-minutos.jpg",
    ratio: "4 / 3",
    title: "landing.sec09Title",
    muted: "landing.sec09TitleMuted",
    body: "landing.sec09Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec10",
    video: "/portada-b/i-roas.mp4",
    img: "/portada-b/i-roas.jpg",
    ratio: "16 / 9",
    title: "landing.sec10Title",
    muted: "landing.sec10TitleMuted",
    body: "landing.sec10Body",
    sm: 2,
    lg: 6,
  },
];

// Tailwind necesita las clases enteras en el archivo para poder verlas; por eso
// van en un mapa y no armadas con plantillas de texto.
const SM = { 1: "sm:col-span-1", 2: "sm:col-span-2" } as const;
const LG = {
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  6: "lg:col-span-6",
} as const;

export function Cards() {
  const t = useT();

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-6 lg:gap-6 lg:[grid-auto-flow:dense]">
      {TILES.map((tile, i) => (
        <Rise
          key={tile.key}
          delay={(i % 2) * 80}
          className={`min-w-0 ${SM[tile.sm]} ${LG[tile.lg]}`}
        >
          <article className="sn-card flex h-full min-w-0 flex-col overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-8">
              <h3 className="sn-h3 max-w-[20ch]">
                {t(tile.title)} <span style={{ color: "var(--sn-muted)" }}>{t(tile.muted)}</span>
              </h3>

              <p className="sn-body mt-3 max-w-[48ch] !text-[15px]">{t(tile.body)}</p>

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
 * La pieza de abajo de cada ficha: imagen siempre, video cuando lo hay.
 *
 * El video no se descarga hasta que la ficha se acerca a la pantalla. Con
 * cuatro clips en una página de doce mil píxeles, cargarlos todos de entrada
 * serían varios megas que nadie va a ver nunca: el que entra por el hero y se
 * va a los diez segundos no llegó ni a la tercera fila.
 *
 * Y se pausa al salir de pantalla. Cuatro videos en bucle decodificando a la
 * vez calientan un teléfono de gama media aunque no se vean.
 *
 * `prefers-reduced-motion` deja la imagen quieta y no baja el video.
 */
function Ilustracion({ tile }: { tile: Tile }) {
  const reduced = useReducedMotion();
  const caja = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  // `cerca` no vuelve a false nunca: una vez bajado, el clip se queda.
  const [cerca, setCerca] = useState(false);
  const [aLaVista, setALaVista] = useState(false);

  useEffect(() => {
    const el = caja.current;
    if (!el || !tile.video || reduced) return;

    const io = new IntersectionObserver(
      ([e]) => {
        setALaVista(e.isIntersecting);
        if (e.isIntersecting) setCerca(true);
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [tile.video, reduced]);

  // Aparte del observador a proposito: este efecto corre DESPUES de que el
  // <video> exista, que es lo que el observador no puede garantizar.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (aLaVista) void v.play().catch(() => {});
    else v.pause();
  }, [aLaVista, cerca]);

  return (
    <div
      ref={caja}
      className="relative w-full overflow-hidden rounded-2xl"
      style={{ aspectRatio: tile.ratio, background: "var(--sn-sand)" }}
    >
      <Image
        src={tile.img}
        alt=""
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 40vw"
        className="object-cover"
        aria-hidden
      />
      {tile.video && !reduced && cerca && (
        <video
          ref={video}
          src={tile.video}
          poster={tile.img}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-hidden
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </div>
  );
}
