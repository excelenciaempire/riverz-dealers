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
import { Launch } from "./launch";
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
  { src: "/channels/dropi.png", label: "Dropi" },
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

      <Banner />
      <Nav />

      <main id="contenido">
        <Hero />
        <Wall />
        {/* El orden lo manda la investigación: primero se mata la objeción más
            grande —«esto va a ser otro proyecto de meses»— con la oferta;
            después el mecanismo con nombre; después el ángulo del chat ya
            pagado; y recién ahí la lista de funciones. */}
        <Launch />
        <Scene />
        <Pillars />
        {/* El Operator va después de los pilares y antes de la lista: primero
            se entiende que se puede delegar sin quedarse ciego, y entonces
            «se lo pides y lo hace» se lee como la prueba de eso. */}
        <Operator />
        <Capabilities />
        <Banda />
        <Channels />
        <Cta />
      </main>

      <Footer locale={locale} />
    </div>
  );
}

// ── Barra de aviso ────────────────────────────────────────────────────────

function Banner() {
  const t = useT();
  return (
    <div className="px-3 pt-3">
      {/* En pantalla chica el aviso se acomoda en dos renglones centrados en
          vez de partir la frase por la mitad; la raya solo aparece cuando las
          dos partes van en el mismo renglón. */}
      <div
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-3xl px-5 py-2.5 text-center sm:rounded-full"
        style={{ background: "var(--sn-ink)" }}
      >
        <span className="sn-label" style={{ color: "var(--sn-accent)" }}>
          {t("landingV4.bannerLead")}
        </span>
        <span className="text-[13px]" style={{ color: "rgba(250,247,241,0.72)" }}>
          <span aria-hidden className="hidden sm:inline">
            —{" "}
          </span>
          {t("landingV4.bannerText")}
        </span>
      </div>
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
          <a href="#launch" className="transition-opacity hover:opacity-60">
            {t("landingV4.navLaunch")}
          </a>
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
          <a href="#acceso" className="sn-pill sn-pill-sm">
            {t("landingV4.navCta")}
          </a>
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

      {/* En pantalla chica la ilustración no le roba el titular: va debajo,
          de borde a borde. */}
      <div aria-hidden className="relative h-52 w-full overflow-hidden sm:h-64 lg:hidden">
        <Image
          src="/portada-b/hero.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-right"
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
  const PILARES = [
    { l: "landingV4.pillar1Label", b: "landingV4.pillar1" },
    { l: "landingV4.pillar2Label", b: "landingV4.pillar2" },
    { l: "landingV4.pillar3Label", b: "landingV4.pillar3" },
  ];

  return (
    <section className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
      <div className="sn-card-sand relative overflow-hidden px-6 py-12 sm:px-12 sm:py-16">
        {/* La foto entra por el borde derecho y se disuelve: el texto siempre
            cae sobre arena limpia, a cualquier ancho. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[38%] lg:block"
          style={{
            maskImage: "linear-gradient(to left, #000 45%, transparent)",
            WebkitMaskImage: "linear-gradient(to left, #000 45%, transparent)",
          }}
        >
          <Image
            src="/portada-b/intencion.jpg"
            alt=""
            fill
            sizes="38vw"
            className="object-cover object-center"
            style={{ opacity: 0.85 }}
          />
        </div>

        <div className="relative">
          <Label>{t("landingV4.pillarsLabel")}</Label>
          <h2 className="sn-h2 mt-5 max-w-[13ch]">{t("landingV4.pillarsTitle")}</h2>
          <p className="sn-lead mt-6 max-w-[30ch]">{t("landingV4.pillarsLead")}</p>

          <div className="mt-14 grid gap-8 sm:grid-cols-3 sm:gap-8">
            {PILARES.map((pil) => (
              <div key={pil.l} className="border-t pt-5" style={{ borderColor: "var(--sn-line)" }}>
                <p
                  className="sn-h3 !text-[clamp(21px,2vw,27px)]"
                  style={{ color: "var(--sn-ink)" }}
                >
                  {t(pil.l)}
                </p>
                <p className="sn-body mt-3 !text-[15px]">{t(pil.b)}</p>
              </div>
            ))}
          </div>
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

/**
 * La banda: una foto a todo el ancho con una sola línea encima.
 *
 * Después de trece fichas seguidas el ojo necesita un respiro, y el respiro
 * tiene que decir algo. La frase sale de los territorios creativos del
 * documento: es la versión más corta del mecanismo entero.
 */
function Banda() {
  const t = useT();
  return (
    <section className="relative mx-auto mt-4 max-w-[1600px] px-3 lg:px-5">
      <div className="relative overflow-hidden rounded-[26px]">
        <div className="relative aspect-[21/9] max-h-[46vh] w-full sm:max-h-none">
          <Image
            src="/portada-b/banda-mostrador.jpg"
            alt=""
            fill
            sizes="100vw"
            className="object-cover"
          />
          {/* Velo desde abajo: la línea siempre cae sobre zona oscura, sin
              importar cómo recorte la foto a cada ancho. */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(0deg, rgba(18,32,31,0.72) 0%, rgba(18,32,31,0.28) 45%, rgba(18,32,31,0.05) 100%)",
            }}
          />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-6 sm:p-10 lg:p-14">
          <p className="sn-h2 max-w-[16ch]" style={{ color: "var(--sn-card)" }}>
            {t("landingV4.bandaLine")}
          </p>
        </div>
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

// ── Cierre ────────────────────────────────────────────────────────────────

function Cta() {
  const t = useT();
  return (
    <section id="acceso" className="mx-auto max-w-6xl scroll-mt-24 px-5 pb-16 pt-4 lg:pb-24">
      <div
        className="rounded-[26px] px-6 py-16 text-center sm:px-12 lg:py-24"
        style={{ background: "var(--sn-ink)" }}
      >
        <Rise>
          <h2
            className="sn-h2 mx-auto max-w-[16ch]"
            style={{ color: "var(--sn-card)" }}
          >
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
