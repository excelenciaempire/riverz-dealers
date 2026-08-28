"use client";

import Image from "next/image";
import { ArrowDownRight, Check, Phone, RotateCcw, Sparkles } from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import type { Channel } from "@/types";
import { useT } from "@/hooks/use-locale";

/**
 * Composiciones — una por funcionalidad, dibujadas con las piezas del producto.
 *
 * Ni fotos ni capturas. Cada una es un pequeño diagrama armado con fragmentos
 * de la interfaz de verdad —una ficha de producto, una burbuja, el logo de un
 * canal en su placa, un chip de estado, una cifra— apoyados sobre el crema de
 * la ficha, unidos por hilos finos y con sombras suaves.
 *
 * Por qué así y no con fotografía: una foto es linda y no dice qué hace el
 * producto. Una captura de pantalla dice demasiado y no se lee al tamaño de una
 * ficha. El diagrama dice exactamente una cosa y se entiende de un vistazo, que
 * es lo único que se le puede pedir a un bloque de una cuadrícula.
 *
 * La regla de composición: cada una tiene que poder resumirse en una frase.
 * «La respuesta cita el dato de la ficha.» «Cinco canales entran a una bandeja.»
 * «El comentario público sigue en privado.» Si hace falta más de una frase para
 * explicar el dibujo, el dibujo está mal.
 *
 * Todas son estáticas, sin dependencias y sin imágenes: viven en una caja de
 * proporción fija y escalan con la ficha sin romperse.
 */

// ── Piezas compartidas ────────────────────────────────────────────────────

/** Caja de la composición: proporción fija y nada más. */
function Lienzo({ children, ratio = "4/3" }: { children: React.ReactNode; ratio?: string }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl"
      style={{ aspectRatio: ratio }}
      aria-hidden
    >
      {children}
    </div>
  );
}

/** Hilo fino entre dos piezas. El pegamento visual de todas las composiciones. */
function Hilo({ d, viewBox = "0 0 100 75" }: { d: string; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} preserveAspectRatio="none" className="absolute inset-0 size-full">
      <path
        d={d}
        fill="none"
        stroke="var(--sn-line)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Placa redondeada blanca: el envase de casi todo. */
function Placa({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-2xl bg-white ${className}`}
      style={{
        boxShadow: "0 18px 40px -22px rgba(18,32,31,0.35), 0 1px 0 0 rgba(18,32,31,0.04)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Etiqueta mono chiquita, la misma que abre cada sección. */
function Mini({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="font-[family-name:var(--font-mono-label)] text-[9px] uppercase tracking-[0.13em]"
      style={{ color: "var(--sn-muted)" }}
    >
      {children}
    </span>
  );
}

/** Chip amarillo: el estado bueno, el que cierra la historia. */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
      style={{ background: "var(--sn-accent)", color: "var(--sn-ink)" }}
    >
      <Check className="size-3" />
      {children}
    </span>
  );
}

/** Burbuja de conversación. `mia` la pinta de amarillo. */
function Burbuja({
  children,
  mia,
  className = "",
  style,
}: {
  children: React.ReactNode;
  mia?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`rounded-2xl px-3 py-2 text-[12px] leading-snug ${className}`}
      style={{
        background: mia ? "var(--sn-accent)" : "#fff",
        color: "var(--sn-ink)",
        boxShadow: "0 14px 30px -18px rgba(18,32,31,0.4)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── 1 · Conecta tu tienda ─────────────────────────────────────────────────
// Las cuatro plataformas en su placa, unidas por hilos a un punto amarillo.
// Es el dibujo más simple de «todo esto entra por un solo lado».

const TIENDAS = [
  { src: "/channels/shopify.svg", label: "Shopify" },
  { src: "/channels/woocommerce.svg", label: "WooCommerce" },
  { src: "/channels/tiendanube.svg", label: "Tiendanube" },
];

export function CompTienda() {
  const t = useT();
  return (
    <Lienzo>
      {[20, 46, 72].map((y) => (
        <Hilo key={y} d={`M 26 ${y} C 46 ${y}, 52 37.5, 72 37.5`} />
      ))}

      <div className="absolute inset-y-0 left-0 flex w-[34%] flex-col justify-between py-[6%]">
        {TIENDAS.map((s) => (
          <Placa key={s.label} className="flex size-11 items-center justify-center">
            <Image src={s.src} alt="" width={22} height={22} unoptimized className="size-[22px] object-contain" />
          </Placa>
        ))}
      </div>

      <div className="absolute right-[4%] top-1/2 -translate-y-1/2">
        <Placa className="flex flex-col items-center gap-2 px-5 py-4">
          <span
            className="flex size-11 items-center justify-center rounded-full"
            style={{ background: "var(--sn-accent)" }}
          >
            <Sparkles className="size-5" style={{ color: "var(--sn-ink)" }} />
          </span>
          <span className="text-[12px] font-medium" style={{ color: "var(--sn-ink)" }}>
            riverz
          </span>
          <Mini>{t("landingV4.compSincro")}</Mini>
        </Placa>
      </div>
    </Lienzo>
  );
}

// ── 2 · Carrito abandonado ────────────────────────────────────────────────
// La ficha del producto que quedó a medias, la burbuja que lo va a buscar, y
// el chip de que volvió. Tres piezas, una historia.

export function CompCarrito() {
  const t = useT();
  return (
    <Lienzo>
      <Placa className="absolute left-0 top-[6%] w-[62%] p-3">
        <div className="flex items-center gap-3">
          <span
            className="flex size-12 shrink-0 items-center justify-center rounded-xl text-[22px]"
            style={{ background: "var(--sn-sand)" }}
          >
            👟
          </span>
          <div className="min-w-0">
            <Mini>{t("landing.contactsTagCart")}</Mini>
            <p className="truncate text-[13px] font-medium" style={{ color: "var(--sn-ink)" }}>
              Tenis Aura
            </p>
            <p className="text-[12px]" style={{ color: "var(--sn-muted)" }}>
              $239.000
            </p>
          </div>
        </div>
      </Placa>

      <Burbuja className="absolute right-0 top-[36%] max-w-[64%]" mia>
        {t("landing.hero1You1")}
      </Burbuja>

      <div className="absolute bottom-[6%] left-[6%]">
        <Chip>{t("landing.metricsRecovered")} · $239.000</Chip>
      </div>

      <ArrowDownRight
        className="absolute left-[52%] top-[26%] size-5 opacity-30"
        style={{ color: "var(--sn-ink)" }}
      />
    </Lienzo>
  );
}

// ── 3 · Recompras ─────────────────────────────────────────────────────────
// Tres pedidos del mismo cliente, escalonados, y la flecha que vuelve al
// principio. La repetición se ve antes de leerse.

export function CompRecompras() {
  const t = useT();
  return (
    <Lienzo>
      {[
        { d: "landingV4.compMes1", top: "4%", left: "0%", op: 0.45 },
        { d: "landingV4.compMes2", top: "30%", left: "12%", op: 0.7 },
        { d: "landingV4.compHoy", top: "56%", left: "24%", op: 1 },
      ].map((p, i) => (
        <Placa
          key={p.d}
          className="absolute w-[66%] px-3.5 py-3"
          style={{ top: p.top, left: p.left, opacity: p.op }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <Mini>{t(p.d)}</Mini>
              <p className="text-[13px] font-medium" style={{ color: "var(--sn-ink)" }}>
                Pedido #{1040 + i}
              </p>
            </div>
            {i === 2 ? (
              <span
                className="flex size-7 items-center justify-center rounded-full"
                style={{ background: "var(--sn-accent)" }}
              >
                <Check className="size-3.5" style={{ color: "var(--sn-ink)" }} />
              </span>
            ) : (
              <span className="text-[12px]" style={{ color: "var(--sn-muted)" }}>
                $239.000
              </span>
            )}
          </div>
        </Placa>
      ))}

      <span
        className="absolute right-[2%] top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full"
        style={{ background: "var(--sn-sand)" }}
      >
        <RotateCcw className="size-4" style={{ color: "var(--sn-ink)" }} />
      </span>
    </Lienzo>
  );
}

// ── 4 · Campañas ──────────────────────────────────────────────────────────
// Dos canales arriba, el abanico de burbujas abajo y el contador. Escala.

export function CompCampanas() {
  const t = useT();
  return (
    <Lienzo ratio="16/9">
      <div className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center gap-2">
        <Placa className="flex size-11 items-center justify-center">
          <ChannelLogo channel="whatsapp" size={22} />
        </Placa>
        <Placa className="flex size-11 items-center justify-center">
          <ChannelLogo channel="instagram" size={22} />
        </Placa>
      </div>

      {[8, 20, 32].map((y) => (
        <Hilo key={y} viewBox="0 0 100 40" d={`M 14 20 C 26 20, 26 ${y}, 38 ${y}`} />
      ))}

      <div className="absolute left-[38%] top-0 flex h-full flex-col justify-between py-[3%]">
        <Burbuja>{t("landing.campaignTitle")}</Burbuja>
        <Burbuja mia>{t("landing.hero1You2")}</Burbuja>
        <Burbuja>{t("landing.hero1Them2")}</Burbuja>
      </div>

      <div className="absolute bottom-0 right-0">
        <Placa className="px-4 py-3 text-right">
          <p
            className="font-[family-name:var(--font-editorial)] text-[26px] leading-none"
            style={{ color: "var(--sn-ink)" }}
          >
            1.284
          </p>
          <Mini>{t("landing.campaignStatSent")}</Mini>
        </Placa>
      </div>
    </Lienzo>
  );
}

// ── 5 · Llamadas ──────────────────────────────────────────────────────────
// La onda, dos líneas de la transcripción y el resultado. Lo que deja una
// llamada cuando termina.

export function CompLlamadas() {
  const t = useT();
  return (
    <Lienzo ratio="3/4">
      <Placa className="absolute inset-x-0 top-[4%] p-4">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-9 items-center justify-center rounded-full"
            style={{ background: "var(--sn-sand)" }}
          >
            <Phone className="size-4" style={{ color: "var(--sn-ink)" }} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium" style={{ color: "var(--sn-ink)" }}>
              Laura M.
            </p>
            <Mini>{t("landing.callOutbound")}</Mini>
          </div>
        </div>

        {/* La onda: barras de alto variable, sin animación. */}
        <div className="mt-4 flex h-8 items-center gap-[3px]">
          {[
            38, 62, 30, 84, 52, 96, 44, 70, 34, 88, 58, 40, 76, 46, 92, 36, 66, 28, 80, 50,
          ].map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-full"
              style={{ height: `${h}%`, background: "var(--sn-accent)" }}
            />
          ))}
        </div>
      </Placa>

      <Burbuja className="absolute left-[6%] top-[46%] max-w-[86%]">
        {t("landing.callLine2")}
      </Burbuja>

      <Burbuja className="absolute right-[4%] top-[64%] max-w-[62%]" mia>
        {t("landing.callLine3")}
      </Burbuja>

      <div className="absolute bottom-[3%] left-0">
        <Chip>{t("landing.callOutcome")}</Chip>
      </div>
    </Lienzo>
  );
}

// ── 6 · Un vendedor que conoce tus productos ──────────────────────────────
// La gracia está en el hilo: sale de la línea de stock de la ficha y llega a
// la respuesta. La respuesta CITA el dato. Eso es lo que lo separa de un bot
// de respuestas armadas.

export function CompVendedor() {
  const t = useT();
  return (
    <Lienzo ratio="4/3">
      <Placa className="absolute left-0 top-0 w-[58%] p-3">
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-[20px]"
            style={{ background: "var(--sn-sand)" }}
          >
            👟
          </span>
          <div className="min-w-0">
            <Mini>{t("landingV4.compCatalog")}</Mini>
            <p className="truncate text-[13px] font-medium" style={{ color: "var(--sn-ink)" }}>
              Tenis Aura
            </p>
          </div>
        </div>
        <div
          className="mt-2.5 rounded-lg px-2 py-1.5 text-[11px] font-medium"
          style={{ background: "var(--sn-accent)", color: "var(--sn-ink)" }}
        >
          {t("landingV4.compStock")}
        </div>
      </Placa>

      <Hilo d="M 30 44 C 30 66, 52 62, 60 70" />

      <Burbuja className="absolute right-0 top-[34%] max-w-[62%]">
        {t("landingV4.compAsk")}
      </Burbuja>

      <Burbuja className="absolute bottom-0 left-[10%] max-w-[78%]" mia>
        {t("landingV4.compAnswer")}
      </Burbuja>
    </Lienzo>
  );
}

// ── 7 · Atiende y avisa las 24 horas ──────────────────────────────────────
// El pedido con su línea de tiempo. La hora abajo es el argumento entero: a
// las tres de la mañana no hay nadie, y aun así el cliente supo.

export function CompAtencion() {
  const t = useT();
  const pasos = [
    { k: "landingV4.compConfirmed", listo: true },
    { k: "landingV4.compShipped", listo: true },
    { k: "landingV4.compTracking", listo: false },
  ];
  return (
    <Lienzo ratio="16/9">
      <Placa className="absolute inset-x-0 top-0 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px] font-medium" style={{ color: "var(--sn-ink)" }}>
            {t("landingV4.compOrder")} #1042
          </p>
          <Mini>{t("landingV4.compHour")}</Mini>
        </div>

        <ol className="mt-3.5 space-y-2.5">
          {pasos.map((p, i) => (
            <li key={p.k} className="flex items-center gap-2.5">
              <span className="relative flex size-4 shrink-0 items-center justify-center">
                {/* El hilo vertical entre hitos: la línea de tiempo se ve
                    antes de leerse. */}
                {i < pasos.length - 1 && (
                  <span
                    className="absolute left-1/2 top-1/2 h-[18px] w-px -translate-x-1/2"
                    style={{ background: "var(--sn-line)" }}
                  />
                )}
                <span
                  className="relative flex size-4 items-center justify-center rounded-full"
                  style={{ background: p.listo ? "var(--sn-accent)" : "var(--sn-sand-2)" }}
                >
                  {p.listo && <Check className="size-2.5" style={{ color: "var(--sn-ink)" }} />}
                </span>
              </span>
              <span className="text-[12.5px]" style={{ color: "var(--sn-ink)" }}>
                {t(p.k)}
              </span>
            </li>
          ))}
        </ol>
      </Placa>

      <Burbuja className="absolute bottom-0 right-0 max-w-[76%]" mia>
        {t("landing.sec04TitleMuted")}
      </Burbuja>
    </Lienzo>
  );
}

// ── 8 · Responde los comentarios ──────────────────────────────────────────
// El comentario público arriba, la respuesta pública debajo, y el hilo que
// baja al DM. El movimiento de público a privado es la funcionalidad entera.

export function CompComentarios() {
  const t = useT();
  return (
    <Lienzo ratio="4/3">
      <Placa className="absolute left-0 top-0 w-[70%] p-3">
        <div className="flex items-center gap-2.5">
          <ChannelLogo channel="instagram" size={18} />
          <Mini>@laura.mz</Mini>
        </div>
        <p className="mt-2 text-[13px]" style={{ color: "var(--sn-ink)" }}>
          {t("landingV4.compComment")}
        </p>
        <div
          className="mt-2.5 border-l-2 pl-2.5 text-[12.5px]"
          style={{ borderColor: "var(--sn-accent)", color: "var(--sn-muted)" }}
        >
          {t("landingV4.compPublicReply")}
        </div>
      </Placa>

      <Hilo d="M 20 58 C 20 76, 44 74, 52 84" />

      <div className="absolute bottom-0 right-0 w-[74%]">
        <Mini>DM</Mini>
        <Burbuja className="mt-1.5" mia>
          {t("landingV4.compDm")}
        </Burbuja>
      </div>
    </Lienzo>
  );
}

// ── 9 · Una sola bandeja ──────────────────────────────────────────────────
// Cinco canales a la izquierda, cinco hilos, una sola caja a la derecha. Es
// el dibujo más literal de toda la serie y no necesita ser otra cosa.

const ENTRADAS: Channel[] = ["whatsapp", "instagram", "messenger", "mercadolibre", "gmail"];

export function CompBandeja() {
  const t = useT();
  return (
    <Lienzo ratio="4/3">
      <div className="absolute inset-y-0 left-0 flex w-[22%] flex-col justify-between py-[2%]">
        {ENTRADAS.map((c) => (
          <Placa key={c} className="flex size-9 items-center justify-center">
            <ChannelLogo channel={c} size={18} />
          </Placa>
        ))}
      </div>

      {[8, 27, 46, 65, 84].map((y) => (
        <Hilo key={y} d={`M 22 ${y} C 40 ${y}, 40 46, 58 46`} />
      ))}

      <Placa className="absolute right-0 top-1/2 w-[46%] -translate-y-1/2 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <Mini>{t("landingV4.compOneInbox")}</Mini>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ background: "var(--sn-accent)", color: "var(--sn-ink)" }}
          >
            {t("landingV4.compUnread")}
          </span>
        </div>
        <div className="mt-3 space-y-2">
          {[0.95, 0.6, 0.3].map((o, i) => (
            <div key={i} className="flex items-center gap-2" style={{ opacity: o }}>
              <span
                className="size-6 shrink-0 rounded-full"
                style={{ background: "var(--sn-sand-2)" }}
              />
              <span className="flex-1 space-y-1">
                <span className="block h-1.5 w-[70%] rounded-full" style={{ background: "var(--sn-sand-2)" }} />
                <span className="block h-1.5 w-[45%] rounded-full" style={{ background: "var(--sn-sand)" }} />
              </span>
            </div>
          ))}
        </div>
      </Placa>
    </Lienzo>
  );
}

// ── 10 · Míralo trabajar desde tu teléfono ────────────────────────────────
// Un teléfono de verdad, no una ventana de navegador: la promesa es que esto
// se mira desde el bolsillo. El punto que late dice «ahora mismo».

export function CompEnVivo() {
  const t = useT();
  return (
    <Lienzo ratio="3/4">
      <div
        className="absolute inset-x-[14%] inset-y-0 rounded-[22px] bg-white p-3"
        style={{ boxShadow: "0 22px 48px -24px rgba(18,32,31,0.4)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="size-2 rounded-full"
            style={{ background: "var(--sn-ink-accent)" }}
          />
          <Mini>{t("landingV4.compLiveNow")}</Mini>
        </div>

        <div className="mt-3 space-y-2">
          <Burbuja className="max-w-[86%] !text-[11.5px]">{t("landing.hero1Them1")}</Burbuja>
          <Burbuja className="ml-auto max-w-[86%] !text-[11.5px]" mia>
            {t("landing.hero1You1")}
          </Burbuja>
        </div>

        <div
          className="absolute inset-x-3 bottom-3 rounded-full px-3 py-2 text-center text-[11px] font-medium"
          style={{ background: "var(--sn-sand)", color: "var(--sn-ink)" }}
        >
          {t("landingV4.compTakeOver")}
        </div>
      </div>
    </Lienzo>
  );
}

// ── 11 · La base de clientes, ordenada sola ───────────────────────────────
// La ficha se llena con lo que dejaron las conversaciones, y de esa ficha
// baja un hilo al segmento. El orden no lo hace nadie: sale del uso.

export function CompContactos() {
  const t = useT();
  return (
    <Lienzo ratio="4/3">
      <Placa className="absolute inset-x-0 top-0 p-3.5">
        <div className="flex items-center gap-3">
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-full text-[14px] font-medium"
            style={{ background: "var(--sn-accent)", color: "var(--sn-ink)" }}
          >
            LM
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium" style={{ color: "var(--sn-ink)" }}>
              Laura Mesa
            </p>
            <Mini>{t("landingV4.compCity")}</Mini>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {["landingV4.compSpent", "landingV4.compOrders"].map((k) => (
            <span
              key={k}
              className="rounded-full px-2.5 py-1 text-[11px]"
              style={{ background: "var(--sn-sand)", color: "var(--sn-ink)" }}
            >
              {t(k)}
            </span>
          ))}
        </div>
      </Placa>

      <Hilo d="M 50 62 L 50 80" />

      <Placa className="absolute inset-x-[8%] bottom-0 flex items-center gap-2.5 px-3.5 py-3">
        <Sparkles className="size-4 shrink-0" style={{ color: "var(--sn-ink-accent)" }} />
        <span className="truncate text-[12.5px]" style={{ color: "var(--sn-ink)" }}>
          {t("landingV4.compSegment")}
        </span>
      </Placa>
    </Lienzo>
  );
}

// ── 12 · Listo en minutos ─────────────────────────────────────────────────
// Tres pasos en una escalera y el tiempo abajo. La composición más vacía de
// la serie a propósito: la funcionalidad es que no hay nada que hacer.

export function CompMinutos() {
  const t = useT();
  const pasos = ["landingV4.compStep1", "landingV4.compStep2", "landingV4.compStep3"];
  return (
    <Lienzo ratio="4/3">
      <Hilo d="M 16 14 L 16 62 L 84 62" />

      <div className="absolute inset-x-0 top-0 space-y-2.5">
        {pasos.map((k, i) => (
          <Placa
            key={k}
            className="flex items-center gap-2.5 px-3 py-2.5"
            style={{ marginLeft: `${i * 9}%`, width: `${74 - i * 4}%` }}
          >
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
              style={{
                background: i === 2 ? "var(--sn-accent)" : "var(--sn-sand)",
                color: "var(--sn-ink)",
              }}
            >
              {i + 1}
            </span>
            <span className="truncate text-[12.5px]" style={{ color: "var(--sn-ink)" }}>
              {t(k)}
            </span>
          </Placa>
        ))}
      </div>

      <div className="absolute bottom-0 right-0 text-right">
        <p
          className="font-[family-name:var(--font-editorial)] text-[30px] leading-none"
          style={{ color: "var(--sn-ink)" }}
        >
          {t("landingV4.compMinutes")}
        </p>
      </div>
    </Lienzo>
  );
}

// ── 13 · ROAS ─────────────────────────────────────────────────────────────
// Dos barras y una cifra. Lo importante es el chip de abajo: la cifra existe
// porque la venta quedó atribuida, no porque alguien la estimó.

export function CompRoas() {
  const t = useT();
  return (
    <Lienzo ratio="16/9">
      <div className="absolute inset-y-0 left-0 flex w-[46%] flex-col justify-center gap-3">
        {[
          { k: "landingV4.compInvested", w: "34%", c: "var(--sn-sand-2)" },
          { k: "landingV4.compReturned", w: "100%", c: "var(--sn-accent)" },
        ].map((b) => (
          <div key={b.k}>
            <Mini>{t(b.k)}</Mini>
            <span
              className="mt-1.5 block h-3 rounded-full"
              style={{ width: b.w, background: b.c }}
            />
          </div>
        ))}
      </div>

      <Placa className="absolute right-0 top-0 px-5 py-4 text-right">
        <p
          className="font-[family-name:var(--font-editorial)] text-[34px] leading-none"
          style={{ color: "var(--sn-ink)" }}
        >
          4,7×
        </p>
        <Mini>{t("landingV4.compRoas")}</Mini>
      </Placa>

      <div className="absolute bottom-0 right-0">
        <Chip>{t("landingV4.compAttributed")}</Chip>
      </div>
    </Lienzo>
  );
}
