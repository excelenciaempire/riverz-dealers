"use client";

import { useT } from "@/hooks/use-locale";
import { Rise } from "./bits";
import {
  CompAtencion,
  CompBandeja,
  CompCampanas,
  CompCarrito,
  CompComentarios,
  CompContactos,
  CompEnVivo,
  CompLlamadas,
  CompMinutos,
  CompRecompras,
  CompRoas,
  CompTienda,
  CompVendedor,
} from "./compositions";

/**
 * Qué hace — el mosaico.
 *
 * Trece funcionalidades, trece dibujos. Ninguno repetido.
 *
 * Por acá pasaron dos versiones que no funcionaban. La primera eran trece
 * fichas idénticas con la misma vista previa metida en el mismo marco de
 * navegador: a la quinta se lee como una lista y se saltea. La segunda le puso
 * una fotografía a cada una: quedaban lindas y no decían nada del producto —una
 * canasta volcada no explica qué es recuperar un carrito.
 *
 * Lo que sí funciona es lo que hace Siena: un pequeño diagrama por función,
 * armado con las piezas de la interfaz de verdad. La ficha del producto con su
 * línea de stock, la burbuja que cita ese dato, el logo del canal en su placa,
 * el chip del estado. Se entiende de un vistazo y es imposible de confundir con
 * la competencia, porque está hecho con nuestras piezas.
 *
 * Los anchos siguen siendo cuatro y las filas suman seis columnas de formas
 * distintas (4+2, 3+3, 6, 4+2, 2+4), así que el ojo nunca encuentra el mismo
 * ritmo dos veces. Los huecos los rellena `grid-auto-flow: dense`.
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
  Comp: () => React.ReactElement;
};

const TILES: Tile[] = [
  {
    key: "sec01",
    Comp: CompVendedor,
    title: "landing.sec01Title",
    muted: "landing.sec01TitleMuted",
    body: "landing.sec01Body",
    sm: 2,
    lg: 4,
  },
  {
    key: "secVoice",
    Comp: CompLlamadas,
    title: "landing.secVoiceTitle",
    muted: "landing.secVoiceTitleMuted",
    body: "landing.secVoiceBody",
    sm: 1,
    lg: 2,
  },
  {
    key: "sec02",
    Comp: CompCarrito,
    title: "landing.sec02Title",
    muted: "landing.sec02TitleMuted",
    body: "landing.sec02Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec04",
    Comp: CompAtencion,
    title: "landing.sec04Title",
    muted: "landing.sec04TitleMuted",
    body: "landing.sec04Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec03",
    Comp: CompRecompras,
    title: "landing.sec03Title",
    muted: "landing.sec03TitleMuted",
    body: "landing.sec03Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec05",
    Comp: CompComentarios,
    title: "landing.sec05Title",
    muted: "landing.sec05TitleMuted",
    body: "landing.sec05Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec06",
    Comp: CompCampanas,
    title: "landing.sec06Title",
    muted: "landing.sec06TitleMuted",
    body: "landing.sec06Body",
    sm: 2,
    lg: 4,
  },
  {
    key: "secLive",
    Comp: CompEnVivo,
    title: "landing.secLiveTitle",
    muted: "landing.secLiveTitleMuted",
    body: "landing.secLiveBody",
    sm: 1,
    lg: 2,
  },
  {
    key: "sec07",
    Comp: CompBandeja,
    title: "landing.sec07Title",
    muted: "landing.sec07TitleMuted",
    body: "landing.sec07Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec08",
    Comp: CompTienda,
    title: "landing.sec08Title",
    muted: "landing.sec08TitleMuted",
    body: "landing.sec08Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "secContacts",
    Comp: CompContactos,
    title: "landing.secContactsTitle",
    muted: "landing.secContactsTitleMuted",
    body: "landing.secContactsBody",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec09",
    Comp: CompMinutos,
    title: "landing.sec09Title",
    muted: "landing.sec09TitleMuted",
    body: "landing.sec09Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec10",
    Comp: CompRoas,
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

              {/* El diagrama va al pie y crece con la ficha. `mt-auto` lo
                  empuja abajo, así que las fichas de una misma fila alinean el
                  dibujo aunque el texto mida distinto. */}
              <div className="mt-auto min-w-0 pt-8">
                <tile.Comp />
              </div>
            </div>
          </article>
        </Rise>
      ))}
    </div>
  );
}
