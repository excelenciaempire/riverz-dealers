"use client";

import Image from "next/image";
import { ArrowDownRight, Check, Phone, RotateCcw, Sparkles } from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { useT } from "@/hooks/use-locale";

/**
 * Composiciones — las piezas del producto, sueltas sobre el papel.
 *
 * No son capturas ni fotos: son fragmentos de la interfaz —una ficha de
 * producto, una burbuja, un logo en su placa, un contador— flotando sobre el
 * crema de la ficha, con hilos finos entre ellos y sombras suaves. Es el mismo
 * recurso que usa Siena en su cuadrícula, hecho con NUESTRAS piezas: nuestros
 * canales, nuestro amarillo, nuestra mono.
 *
 * La diferencia con las vistas previas de la portada vieja es que ahí todo
 * vive adentro de una ventanita de navegador, y trece ventanitas iguales se
 * leen como una lista de capturas. Acá no hay marco: los fragmentos se apoyan
 * en el papel y cada composición tiene su propia forma.
 *
 * Todas son estáticas y sin dependencias. Cada una vive en una caja de
 * proporción fija, así que escalan con la ficha sin romperse.
 */

// ── Piezas compartidas ────────────────────────────────────────────────────

/**
 * Caja de la composición.
 *
 * Con , la imagen va de fondo a sangre y las piezas se apoyan encima.
 * Es la receta de verdad de la cuadrícula de Siena: ni una foto sola —que es
 * linda y no dice qué hace el producto— ni una ventanita más, sino las dos
 * cosas en la misma ficha. Un velo de crema por arriba baja el contraste de la
 * foto lo justo para que las placas blancas se despeguen.
 */
function Lienzo({
  children,
  ratio = "4/3",
  foto,
}: {
  children: React.ReactNode;
  ratio?: string;
  foto?: string;
}) {
  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl"
      style={{ aspectRatio: ratio }}
      aria-hidden
    >
      {foto && (
        <>
          <Image src={foto} alt="" fill sizes="(max-width: 1024px) 100vw, 40vw" className="object-cover" />
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(180deg, rgba(243,240,235,0.30), rgba(243,240,235,0.62))" }}
          />
        </>
      )}
      <div className={foto ? "absolute inset-0 p-4 sm:p-5" : "absolute inset-0"}>{children}</div>
    </div>
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

export function CompTienda({ foto }: { foto?: string }) {
  const t = useT();
  return (
    <Lienzo foto={foto}>
      <svg
        viewBox="0 0 100 75"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full"
      >
        {[20, 46, 72].map((y) => (
          <path
            key={y}
            d={`M 26 ${y} C 46 ${y}, 52 37.5, 72 37.5`}
            fill="none"
            stroke="var(--sn-line)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

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

export function CompCarrito({ foto }: { foto?: string }) {
  const t = useT();
  return (
    <Lienzo foto={foto}>
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

export function CompRecompras({ foto }: { foto?: string }) {
  const t = useT();
  return (
    <Lienzo foto={foto}>
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

export function CompCampanas({ foto }: { foto?: string }) {
  const t = useT();
  return (
    <Lienzo ratio="16/9" foto={foto}>
      <div className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center gap-2">
        <Placa className="flex size-11 items-center justify-center">
          <ChannelLogo channel="whatsapp" size={22} />
        </Placa>
        <Placa className="flex size-11 items-center justify-center">
          <ChannelLogo channel="instagram" size={22} />
        </Placa>
      </div>

      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 size-full">
        {[8, 20, 32].map((y) => (
          <path
            key={y}
            d={`M 14 20 C 26 20, 26 ${y}, 38 ${y}`}
            fill="none"
            stroke="var(--sn-line)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

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

export function CompLlamadas({ foto }: { foto?: string }) {
  const t = useT();
  return (
    <Lienzo ratio="3/4" foto={foto}>
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
