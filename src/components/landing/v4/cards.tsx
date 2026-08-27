"use client";

import { useT } from "@/hooks/use-locale";
import {
  AgentPanel,
  CommentsPreview,
  ContactsPreview,
  InboxPreview,
  LivePreview,
  MetricsPreview,
  SupportPreview,
} from "@/components/landing/landing";
import { Rise } from "./bits";
import {
  CompCampanas,
  CompCarrito,
  CompLlamadas,
  CompRecompras,
  CompTienda,
} from "./compositions";

/**
 * Qué hace — el mosaico.
 *
 * Antes eran trece fichas idénticas: mismo tamaño, mismo marco de navegador,
 * misma vista previa blanca. Trece veces seguidas eso se lee como una lista y
 * cansa a la quinta. Siena no tiene GIFs de producto —tiene un único video
 * decorativo repetido y cien imágenes estáticas—; lo que la hace ver rica es
 * que **ningún bloque se parece al anterior**.
 *
 * Así que acá hay cuatro tipos de ficha y cuatro anchos distintos:
 *
 *   `window`  la vista previa animada del producto, en su marco
 *   `comp`    una composición: fragmentos de la interfaz sueltos sobre el papel
 *   `figure`  un dato grande en arena, sin vista previa
 *   `plain`   solo tipografía sobre arena, con mucho aire
 *
 * Las composiciones son la pieza que faltaba. Una foto de un paquete es bonita
 * pero no dice qué hace el producto; una ventanita más se lee como otra
 * captura. La composición muestra las piezas de verdad —la ficha del producto,
 * la burbuja, el logo del canal, el chip del estado— apoyadas en el papel y
 * unidas por hilos finos. Es el recurso de Siena hecho con lo nuestro.
 *
 * Las filas suman seis columnas de formas distintas (4+2, 3+3, 6, 4+2, 2+4),
 * así que el ojo nunca encuentra el mismo ritmo dos veces.
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
} & (
  | { kind: "window"; Panel: () => React.ReactElement }
  | { kind: "comp"; Comp: () => React.ReactElement }
  | { kind: "figure"; value: string; unit: string }
  | { kind: "plain" }
);

// El orden importa dos veces: cuenta la historia, y hace que las fichas anchas
// caigan siempre al principio de una fila (si no, la cuadrícula deja huecos).
const TILES: Tile[] = [
  {
    key: "sec01",
    kind: "window",
    Panel: AgentPanel,
    title: "landing.sec01Title",
    muted: "landing.sec01TitleMuted",
    body: "landing.sec01Body",
    sm: 2,
    lg: 4,
  },
  {
    key: "secVoice",
    kind: "comp",
    Comp: CompLlamadas,
    title: "landing.secVoiceTitle",
    muted: "landing.secVoiceTitleMuted",
    body: "landing.secVoiceBody",
    sm: 1,
    lg: 2,
  },
  {
    key: "sec02",
    kind: "comp",
    Comp: CompCarrito,
    title: "landing.sec02Title",
    muted: "landing.sec02TitleMuted",
    body: "landing.sec02Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec04",
    kind: "window",
    Panel: SupportPreview,
    title: "landing.sec04Title",
    muted: "landing.sec04TitleMuted",
    body: "landing.sec04Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec03",
    kind: "comp",
    Comp: CompRecompras,
    title: "landing.sec03Title",
    muted: "landing.sec03TitleMuted",
    body: "landing.sec03Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec05",
    kind: "window",
    Panel: CommentsPreview,
    title: "landing.sec05Title",
    muted: "landing.sec05TitleMuted",
    body: "landing.sec05Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec06",
    kind: "comp",
    Comp: CompCampanas,
    title: "landing.sec06Title",
    muted: "landing.sec06TitleMuted",
    body: "landing.sec06Body",
    sm: 1,
    lg: 6,
  },
  {
    key: "sec07",
    kind: "window",
    Panel: InboxPreview,
    title: "landing.sec07Title",
    muted: "landing.sec07TitleMuted",
    body: "landing.sec07Body",
    sm: 2,
    lg: 4,
  },
  {
    key: "secLive",
    kind: "window",
    Panel: LivePreview,
    title: "landing.secLiveTitle",
    muted: "landing.secLiveTitleMuted",
    body: "landing.secLiveBody",
    sm: 1,
    lg: 2,
  },
  {
    key: "sec08",
    kind: "comp",
    Comp: CompTienda,
    title: "landing.sec08Title",
    muted: "landing.sec08TitleMuted",
    body: "landing.sec08Body",
    sm: 1,
    lg: 3,
  },
  {
    key: "secContacts",
    kind: "window",
    Panel: ContactsPreview,
    title: "landing.secContactsTitle",
    muted: "landing.secContactsTitleMuted",
    body: "landing.secContactsBody",
    sm: 1,
    lg: 3,
  },
  {
    key: "sec09",
    kind: "figure",
    value: "0",
    unit: "landingV4.capsZeroLabel",
    title: "landing.sec09Title",
    muted: "landing.sec09TitleMuted",
    body: "landing.sec09Body",
    sm: 1,
    lg: 2,
  },
  {
    key: "sec10",
    kind: "window",
    Panel: MetricsPreview,
    title: "landing.sec10Title",
    muted: "landing.sec10TitleMuted",
    body: "landing.sec10Body",
    sm: 2,
    lg: 4,
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
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-6 lg:gap-6">
      {TILES.map((tile, i) => (
        <Rise
          key={tile.key}
          delay={(i % 2) * 80}
          className={`min-w-0 ${SM[tile.sm]} ${LG[tile.lg]}`}
        >
          <article
            className={`flex h-full min-w-0 flex-col overflow-hidden ${
              tile.kind === "figure" || tile.kind === "plain" ? "sn-card-sand" : "sn-card"
            }`}
          >
            <div className="flex min-w-0 flex-1 flex-col p-5 sm:p-8">
              {tile.kind === "figure" && (
                <p className="sn-figure mb-4 !text-[clamp(76px,9vw,132px)]">{tile.value}</p>
              )}

              <h3 className={tile.kind === "plain" ? "sn-h2 max-w-[16ch]" : "sn-h3 max-w-[20ch]"}>
                {t(tile.title)} <span style={{ color: "var(--sn-muted)" }}>{t(tile.muted)}</span>
              </h3>

              {tile.kind === "figure" && (
                <p className="sn-label mt-2">{t(tile.unit)}</p>
              )}

              <p className="sn-body mt-3 max-w-[48ch] !text-[15px]">{t(tile.body)}</p>

              {tile.kind === "comp" && (
                // La composición va al pie de la ficha y crece con ella: son
                // fragmentos de la interfaz apoyados en el papel, sin marco.
                <div className="mt-auto min-w-0 pt-8">
                  <tile.Comp />
                </div>
              )}

              {tile.kind === "window" && (
                // min-w-0 en la celda, en la ficha y acá: sin eso, el ancho
                // mínimo de la vista previa estira la celda por encima del
                // ancho de la pantalla y el párrafo de arriba sale cortado.
                <div className="sn-panel mt-auto min-w-0 overflow-x-auto pt-7 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <tile.Panel />
                </div>
              )}
            </div>
          </article>
        </Rise>
      ))}
    </div>
  );
}
