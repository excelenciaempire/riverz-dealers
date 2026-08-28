"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, PhoneCall } from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { useLocale, useT } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n/routes";
import type { Channel } from "@/types";
import type { Locale } from "@/lib/i18n/config";
import { WaitlistForm } from "@/components/landing/landing";
import { Label, LocaleSwitch, Rise } from "./bits";
import { Scene } from "./scene";
import { Cards } from "./cards";
import { Oferta } from "./oferta";
import { Operator } from "./operator";
import "./editorial.css";

/**
 * Portada editorial — riverz.co/portada-b
 * ────────────────────────────────────────────────────────────────────────
 * Variante en el registro que pidió el dueño: el de siena.cx. Un solo suelo
 * de papel cálido de punta a punta, titulares grandes en serif de contraste
 * alto con interlínea de 1.0, etiquetas mono en mayúsculas, fichas crema
 * sobre crema con esquina generosa, y UNA sola llamada a la acción repetida
 * en toda la página.
 *
 * Lo que NO se copia de Siena: el coral. El acento sigue siendo el amarillo
 * de riverz, que sobre crema se usa siempre como relleno con tinta encima
 * —nunca como texto— porque a ese valor no contrasta.
 *
 * Ninguna sección inventa clientes ni facturación: el producto está en
 * prelanzamiento. Donde Siena pone testimonios, acá va la escena de tres
 * actos que explica cómo trabaja el agente.
 *
 * `/`, `/landing` y `/portada` quedan intactas.
 */

type Ch = "whatsapp" | "instagram" | "messenger" | "gmail" | "mercadolibre" | "tiktok_comment";

// Bandejas donde el agente atiende. `label` es marca (va tal cual) salvo el
// correo, que es una etiqueta traducible y se resuelve con t().
const CHANNELS: { id: Ch; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "messenger", label: "Messenger" },
  { id: "gmail", label: "landing.channelEmail" },
  { id: "mercadolibre", label: "Mercado Libre" },
  { id: "tiktok_comment", label: "TikTok" },
];

// De dónde salen el stock y los precios, y a dónde va el pedido.
const STORES: { src: string; label: string }[] = [
  { src: "/channels/shopify.svg", label: "Shopify" },
  { src: "/channels/woocommerce.svg", label: "WooCommerce" },
  { src: "/channels/tiendanube.svg", label: "Tiendanube" },
];

export function LandingV4() {
  const t = useT();
  const { locale } = useLocale();

  return (
    <div className="sn min-h-screen">
      <a
        href="#contenido"
        className="sn-label sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:px-4 focus:py-2"
        style={{ background: "var(--sn-accent)", color: "var(--sn-ink)" }}
      >
        {t("landingV4.skipToContent")}
      </a>

      <Oferta />
      <Nav />

      <main id="contenido">
        <Hero />
        <Wall />
        {/* El Operator abre el recorrido: es lo único que no tiene nadie más
            en la categoría, y dejarlo para el final hacía que la página se
            leyera como «otra plataforma de atención con IA» hasta el minuto
            tres. La oferta ya no ocupa una sección: vive en la barra de
            arriba y se despliega en un diálogo, porque es temporal y tiene que
            poder retirarse sin dejar un hueco. */}
        <Operator />
        <Pillars />
        <Scene />
        <Capabilities />
        <Channels />
        <Confianza />
        <Cta />
      </main>

      <Footer locale={locale} />
    </div>
  );
}

// ── Navegación ────────────────────────────────────────────────────────────

function Nav() {
  const t = useT();
  return (
    <header className="sticky top-2 z-30 px-3 pt-2">
      <nav
        className="mx-auto flex max-w-6xl items-center justify-between gap-6 rounded-full px-5 py-3 backdrop-blur"
        style={{ background: "rgba(250,247,241,0.82)" }}
      >
        <span
          className="text-[19px] font-semibold lowercase tracking-[-0.02em]"
          style={{ color: "var(--sn-ink)" }}
        >
          riverz
        </span>

        <div className="hidden items-center gap-8 text-[15px] md:flex">
          {/* El menú sigue el orden real de la página. */}
          <a href="#loop" className="transition-opacity hover:opacity-60">
            {t("landingV4.navLoop")}
          </a>
          <a href="#operator" className="transition-opacity hover:opacity-60">
            {t("landingV4.navOperator")}
          </a>
          <a href="#capacidades" className="transition-opacity hover:opacity-60">
            {t("landingV4.navCapabilities")}
          </a>
        </div>

        <div className="flex items-center gap-4">
          <LocaleSwitch />
          {/* En el teléfono esta píldora se va. Debajo del aviso de la oferta
              quedaban dos llamadas a la acción a cuatro dedos de distancia —la
              de la barra y la del hero— y la de arriba solo empujaba el
              contenido hacia abajo. En escritorio no estorba y se queda. */}
          <span className="hidden sm:block">
            <a href="#acceso" className="sn-pill sn-pill-sm">
              {t("landingV4.navCta")}
            </a>
          </span>
        </div>
      </nav>
    </header>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────

function Hero() {
  const t = useT();
  return (
    <section className="relative overflow-hidden">
      {/* La ilustración sangra por el borde derecho, como en el registro
          editorial: no es una captura de producto, es una imagen que da tono.
          Se disuelve hacia la izquierda para que el titular caiga sobre papel
          limpio a cualquier ancho. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 hidden w-[44%] lg:block"
        style={{
          maskImage: "linear-gradient(to left, #000 58%, transparent)",
          WebkitMaskImage: "linear-gradient(to left, #000 58%, transparent)",
        }}
      >
        <Image
          src="/portada-b/hero.jpg"
          alt=""
          fill
          priority
          sizes="44vw"
          className="object-cover object-right"
        />
      </div>

      {/* El titular, el subtítulo y la llamada a la acción salen del catálogo
          `landing`: son los de la portada principal, palabra por palabra. Esta
          portada cambia el diseño, no lo que promete. */}
      <div className="relative mx-auto max-w-6xl px-5 pb-14 pt-14 text-center sm:pt-20 lg:pb-24 lg:pt-28">
        <Rise>
          <h1 className="sn-display mx-auto max-w-[16ch]">
            {t("landingV4.heroTitleLead")}{" "}
            <span style={{ color: "var(--sn-muted)" }}>{t("landingV4.heroTitleMuted")}</span>
          </h1>
        </Rise>
        <Rise delay={90}>
          <p className="sn-body mx-auto mt-7 max-w-[58ch]">{t("landingV4.heroSubtitle")}</p>
        </Rise>
        <Rise delay={180}>
          <a href="#acceso" className="sn-pill group mt-9">
            {t("landingV4.navCta")}
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </a>
        </Rise>
      </div>

      {/* En pantalla chica la ilustración va debajo del titular y ENTERA: es un
          dibujo, no una foto, y recortarlo para llenar una franja le corta la
          cabeza a la figura. Con la proporción original se ve completo y el
          crema del dibujo se funde con el de la página. */}
      <div aria-hidden className="relative -mt-2 w-full lg:hidden">
        <Image
          src="/portada-b/hero.jpg"
          alt=""
          width={1400}
          height={1045}
          sizes="100vw"
          className="h-auto w-full"
        />
      </div>
    </section>
  );
}

// ── Muro de plataformas ───────────────────────────────────────────────────

function Wall() {
  const t = useT();
  return (
    <section className="mx-auto max-w-6xl px-5 py-12 lg:py-16">
      <div
        className="flex flex-col items-center gap-6 border-y py-8"
        style={{ borderColor: "var(--sn-line)" }}
      >
        <Label>{t("landingV4.wallLabel")}</Label>
        <div className="flex flex-wrap items-center justify-center gap-x-9 gap-y-5">
          {CHANNELS.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2 text-[15px]">
              <ChannelLogo channel={c.id as Channel} size={20} /> {t(c.label)}
            </span>
          ))}
          {STORES.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-2 text-[15px]">
              {/* `unoptimized`: el optimizador de Next rechaza SVG mientras
                  `dangerouslyAllowSVG` esté apagado y devuelve 400 — los logos
                  de tienda salían como huecos. */}
              <Image
                src={s.src}
                alt=""
                width={20}
                height={20}
                unoptimized
                className="size-5 object-contain"
              />
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Bloque de dato ────────────────────────────────────────────────────────

/**
 * Los pilares — el ángulo del chat ya pagado.
 *
 * Reemplaza al bloque «24/7» que había acá. La investigación es explícita en
 * no liderar con eso: Meta Business Agent y media docena de competidores ya lo
 * dicen, así que no diferencia nada. El ángulo que sí es nuestro es el
 * primero de la lista de adquisición: *tu anuncio sí trajo al cliente, la
 * venta se perdió después*. Debajo, los tres pilares de comunicación —
 * recupera, ejecuta, delega— cada uno con su verbo adelante.
 */
function Pillars() {
  const t = useT();

  return (
    // El campo de color va a todo el ancho y la tarjeta flota encima. Es el
    // recurso que usa Siena en su bloque de dato, y el que le da a una página
    // de puro papel el único momento de color que necesita.
    //
    // Es la sección más corta de la portada a propósito: dice el problema y se
    // calla. Tenía tres pilares —Recupera, Ejecuta, Delega— que repetían, uno
    // por uno, el titular de acá mismo, el de «La diferencia» y una viñeta del
    // paso 03. En un teléfono eran media pantalla de texto ya leído.
    <section className="sn-full relative overflow-hidden py-16 lg:py-24">
      <Image
        src="/portada-b/fondo-arena.jpg"
        alt=""
        fill
        sizes="100vw"
        className="object-cover"
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl px-5">
        <div
          className="rounded-[26px] px-6 py-12 backdrop-blur-[2px] sm:px-12 sm:py-16"
          style={{ background: "rgba(250,247,241,0.9)" }}
        >
          <Label>{t("landingV4.pillarsLabel")}</Label>
          <h2 className="sn-h2 mt-5 max-w-[13ch]">{t("landingV4.pillarsTitle")}</h2>
          <p className="sn-lead mt-6 max-w-[36ch]">{t("landingV4.pillarsLead")}</p>
          {/* El remate va sobre el amarillo: es la única frase de la sección que
              habla de plata, y tiene que quedarse. */}
          <p className="mt-7 inline-block rounded-full px-4 py-2 text-[15px] font-medium"
             style={{ background: "var(--sn-accent)", color: "var(--sn-ink)" }}>
            {t("landingV4.pillarsKicker")}
          </p>
        </div>
      </div>
    </section>
  );
}

// ── Capacidades ───────────────────────────────────────────────────────────

function Capabilities() {
  const t = useT();
  return (
    <section id="capacidades" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 lg:py-24">
      <Rise>
        <Label>{t("landingV4.capsLabel")}</Label>
        <h2 className="sn-h2 mt-5 max-w-[16ch]">{t("landingV4.capsTitle")}</h2>
        <p className="sn-body mt-4 max-w-[48ch]">{t("landingV4.capsBody")}</p>
      </Rise>

      <div className="mt-12">
        <Cards />
      </div>
    </section>
  );
}

// ── Canales ───────────────────────────────────────────────────────────────

function Channels() {
  const t = useT();
  return (
    <section id="canales" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 lg:py-24">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <Rise>
          <Label>{t("landingV4.channelsLabel")}</Label>
          <h2 className="sn-h2 mt-5 max-w-[14ch]">{t("landingV4.channelsTitle")}</h2>
          <p className="sn-body mt-5 max-w-[42ch]">{t("landingV4.channelsBody")}</p>
        </Rise>

        <Rise delay={90}>
          <div className="sn-card p-6 sm:p-9">
            <Label>{t("landingV4.channelsInboxes")}</Label>
            <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {CHANNELS.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-2.5 text-[15px]">
                  <ChannelLogo channel={c.id as Channel} size={22} /> {t(c.label)}
                </span>
              ))}
              <span className="inline-flex items-center gap-2.5 text-[15px]">
                <PhoneCall className="size-[22px]" /> {t("landingV4.channelsCalls")}
              </span>
            </div>

            <div className="mt-9 border-t pt-7" style={{ borderColor: "var(--sn-line)" }}>
              <Label>{t("landingV4.channelsStores")}</Label>
              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                {STORES.map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-2.5 text-[15px]">
                    <Image
                      src={s.src}
                      alt=""
                      width={22}
                      height={22}
                      unoptimized
                      className="size-[22px] object-contain"
                    />
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Rise>
      </div>
    </section>
  );
}

// ── Confianza ───────────────────────────────────────────

/**
 * Confianza — la objeción que nadie dice en voz alta.
 *
 * Quien vende por WhatsApp ya vio caer un número, propio o de un conocido, por
 * usar una herramienta colgada de un teléfono espejo. Esa es la duda de verdad
 * y ninguna funcionalidad la contesta.
 *
 * Lo que NO va acá: la insignia de «Meta Business Partner». Ese es un programa
 * cerrado, con directorio propio, y ponerse el sello sin estar adentro va
 * contra las normas de marca de Meta — el riesgo es perder la app, que es
 * exactamente lo contrario de tranquilizar a nadie. Lo que sí va son hechos
 * comprobables: la conexión es por la API oficial y el App Review está
 * aprobado. Dicho así pesa más que un logo prestado.
 *
 * Y va en INSIGNIAS, no en párrafos. Eran cuatro bloques de título + texto,
 * noventa palabras para decir cinco hechos; leer noventa palabras sobre por
 * qué confiar produce lo contrario de confianza. Un sello repetido cinco
 * veces no es lo mismo que cuatro iconos distintos: aquello se lee como una
 * plantilla comprada, esto como una credencial.
 */

/**
 * El sello. Una credencial dibujada, no una lista de hechos.
 *
 * Es la pieza que hace el trabajo que hacía el texto: una lista de cinco
 * cosas se lee y se olvida, un sello se reconoce. Va en SVG y no en un JPG
 * para que escale sin pesar y tome los colores de la portada.
 *
 * Lo que dice es sólo lo comprobable —API oficial y App Review aprobado—.
 * Sigue sin ir «Meta Business Partner»: es un programa cerrado y usar el
 * sello sin estar adentro pone en riesgo la app.
 */
function Sello({ anillo, arriba }: { anillo: string; arriba: string }) {
  const muescas = Array.from({ length: 60 });
  return (
    <svg
      viewBox="0 0 220 220"
      className="h-[168px] w-[168px] shrink-0 sm:h-[200px] sm:w-[200px]"
      role="img"
      aria-label={arriba}
    >
      <defs>
        <path id="sn-sello-anillo" d="M110,110 m-84,0 a84,84 0 1,1 168,0 a84,84 0 1,1 -168,0" />
      </defs>

      {/* El canto dentado del troquel. */}
      {muescas.map((_, i) => {
        const a = (i / muescas.length) * Math.PI * 2;
        return (
          <line
            key={i}
            x1={110 + Math.cos(a) * 103}
            y1={110 + Math.sin(a) * 103}
            x2={110 + Math.cos(a) * 108}
            y2={110 + Math.sin(a) * 108}
            stroke="var(--sn-ink)"
            strokeWidth={i % 5 === 0 ? 2 : 1}
            opacity={i % 5 === 0 ? 0.55 : 0.28}
          />
        );
      })}

      <circle cx="110" cy="110" r="99" fill="none" stroke="var(--sn-ink)" strokeWidth="1" opacity="0.35" />
      <circle cx="110" cy="110" r="70" fill="var(--sn-ink)" />

      {/* La leyenda, dando la vuelta. */}
      <text
        fill="var(--sn-ink)"
        style={{ fontSize: 10.5, letterSpacing: "0.2em", fontWeight: 500 }}
        opacity="0.75"
      >
        <textPath href="#sn-sello-anillo" startOffset="0%">
          {anillo}
          {anillo}
        </textPath>
      </text>

      {/* El visto, en el lima de la casa. */}
      <path
        d="M88 111 l15 15 l30 -32"
        fill="none"
        stroke="var(--sn-accent)"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="110"
        y="152"
        textAnchor="middle"
        fill="var(--sn-card)"
        style={{ fontSize: 10, letterSpacing: "0.16em", fontWeight: 600, textTransform: "uppercase" }}
        opacity="0.72"
      >
        {arriba}
      </text>
    </svg>
  );
}

function Confianza() {
  const t = useT();
  return (
    <section id="confianza" className="mx-auto max-w-6xl scroll-mt-24 px-5 pb-16 lg:pb-24">
      <div className="sn-card-sand rounded-[26px] px-6 py-12 sm:px-10 lg:px-14 lg:py-16">
        <div className="flex flex-col-reverse items-start gap-10 md:flex-row md:items-center md:justify-between md:gap-14">
          <Rise>
            <Label>{t("landingV4.trustLabel")}</Label>
            <h2 className="sn-h2 mt-5 max-w-[15ch]">{t("landingV4.trustTitle")}</h2>
            <p className="sn-body mt-5 max-w-[48ch]">{t("landingV4.trustBody")}</p>
            <p className="sn-pill sn-pill-sm mt-7 !bg-[var(--sn-accent)] !text-[var(--sn-ink)]">
              {t("landingV4.trustPill")}
            </p>
          </Rise>

          <Rise delay={90}>
            <Sello
              anillo={t("landingV4.trustSealRing")}
              arriba={t("landingV4.trustSealTop")}
            />
          </Rise>
        </div>
      </div>
    </section>
  );
}

// ── Cierre ────────────────────────────────────────────────────────────────

function Cta() {
  const t = useT();
  return (
    <section id="acceso" className="sn-full relative scroll-mt-24 overflow-hidden py-16 lg:py-24">
      <Image
        src="/portada-b/fondo-noche.jpg"
        alt=""
        fill
        sizes="100vw"
        className="object-cover"
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl px-5">
        <div
          className="rounded-[26px] px-6 py-16 text-center backdrop-blur-[2px] sm:px-12 lg:py-24"
          style={{ background: "rgba(18,32,31,0.86)" }}
        >
          <Rise>
            <h2 className="sn-h2 mx-auto max-w-[17ch]" style={{ color: "var(--sn-card)" }}>
              {t("landingV4.ctaTitle")}
            </h2>
            <p
              className="mx-auto mt-5 max-w-[44ch] text-[16px] leading-relaxed"
              style={{ color: "rgba(250,247,241,0.66)" }}
            >
              {t("landingV4.ctaBody")}
            </p>
          </Rise>

          <div className="mx-auto mt-10 flex max-w-md justify-center">
            <WaitlistForm tone="dark" />
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Pie ───────────────────────────────────────────────────────────────────

function Footer({ locale }: { locale: Locale }) {
  const t = useT();
  return (
    <footer className="mx-auto max-w-6xl px-5 pb-12">
      <div
        className="flex flex-col gap-5 border-t pt-7 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: "var(--sn-line)" }}
      >
        <div className="flex items-center gap-4">
          <span className="text-[17px] font-semibold lowercase tracking-[-0.02em]">riverz</span>
          <a href="mailto:info@riverzai.com" className="sn-label hover:opacity-70">
            info@riverzai.com
          </a>
        </div>
        <div className="sn-label flex flex-wrap gap-x-7 gap-y-2">
          <Link href={localizePath("/terminos", locale)} className="hover:opacity-70">
            {t("landing.footerTerms")}
          </Link>
          <Link href={localizePath("/privacidad", locale)} className="hover:opacity-70">
            {t("landing.footerPrivacy")}
          </Link>
          <Link href={localizePath("/eliminar-datos", locale)} className="hover:opacity-70">
            {t("landing.footerDeleteData")}
          </Link>
          <span>{t("landing.footerRights")}</span>
        </div>
      </div>
    </footer>
  );
}
