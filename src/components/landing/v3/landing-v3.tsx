"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, PhoneCall } from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { useLocale, useT } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n/routes";
import type { Channel } from "@/types";
import { WaitlistForm } from "@/components/landing/landing";
import { Headline, LocaleSwitch, Rule, useLit } from "./primitives";
import { Stage } from "./stage";
import { IndexList } from "./index-list";
import "./portada.css";

/**
 * Portada «Papel y Señal» — riverz.co/portada
 * ────────────────────────────────────────────────────────────────────────
 * Tercera portada, en su propia URL para poder compararla en vivo contra
 * `/` y `/landing` sin tocar ninguna de las dos.
 *
 * La idea: la página alterna dos suelos. **Papel** —hueso cálido— es donde se
 * escribe la promesa: tipografía grande, márgenes anchos, reglas finas.
 * **Escenario** —negro— es donde se muestra el producto, apoyado en una mesa
 * en perspectiva. La promesa se lee; la máquina se mira.
 *
 * Tres firmas, y nada más, para que la página se reconozca:
 *   1. La regla — cada sección abre con una línea a todo el ancho con una
 *      etiqueta mono en cada extremo. Es la columna vertebral.
 *   2. El marcador — una palabra por titular sobre una barra amarilla que se
 *      dibuja al entrar en pantalla.
 *   3. La mesa — los paneles de producto en perspectiva sobre el negro.
 *
 * La regla de color que lo sostiene: el amarillo es LUZ, no pintura. Ver
 * `portada.css`.
 *
 * Seis secciones, no trece: las trece funciones viven en un índice
 * tipográfico (`index-list.tsx`) que reutiliza las mismas vistas previas.
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
const INTEGRATIONS: { src: string; label: string }[] = [
  { src: "/channels/shopify.svg", label: "Shopify" },
  { src: "/channels/woocommerce.svg", label: "WooCommerce" },
  { src: "/channels/tiendanube.svg", label: "Tiendanube" },
  { src: "/channels/dropi.png", label: "Dropi" },
];

// Las tres cifras de apoyo del bloque de prueba. Son capacidades
// verificables del producto, no resultados: está en prelanzamiento y una
// cifra de facturación inventada se nota.
const FIGURES = [
  { v: "6", label: "landingV3.proofM1Label" },
  { v: "9", label: "landingV3.proofM2Label" },
  { v: "0", label: "landingV3.proofM3Label" },
];

export function LandingV3() {
  const t = useT();
  const { locale } = useLocale();

  return (
    <div className="pl min-h-screen">
      <a
        href="#contenido"
        className="pl-mono sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:px-4 focus:py-2"
        style={{ background: "var(--pl-acid)", color: "var(--pl-ink)" }}
      >
        {t("landingV3.skipToContent")}
      </a>

      {/* Cabecera: no se pega. La portada se lee de corrido y una barra
          flotante le come aire al titular. */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <span className="pl-mono" style={{ letterSpacing: "0.2em" }}>
          RIVERZ
        </span>
        <div className="flex items-center gap-5">
          <LocaleSwitch />
          <a
            href="#lista"
            className="pl-mono pl-cta rounded-full px-4 py-2.5"
            style={{ letterSpacing: "0.12em" }}
          >
            {t("landingV3.navWaitlist")}
          </a>
        </div>
      </header>

      <main id="contenido">
        <Hero />
        <Proof />
        <Stage />
        <Index />
        <Channels />
        <Close />
      </main>

      <footer className="mx-auto max-w-6xl px-5 pb-10">
        <div className="pl-rule pl-mono">
          <span>© 2026 RIVERZ</span>
          <a href="mailto:info@riverzai.com">INFO@RIVERZAI.COM</a>
        </div>
        <div className="pl-mono mt-4 flex flex-wrap gap-x-6 gap-y-2">
          <Link href={localizePath("/terminos", locale)}>{t("landing.footerTerms")}</Link>
          <Link href={localizePath("/privacidad", locale)}>{t("landing.footerPrivacy")}</Link>
          <Link href={localizePath("/eliminar-datos", locale)}>{t("landing.footerDeleteData")}</Link>
        </div>
      </footer>
    </div>
  );
}

// ── [01] Hero ─────────────────────────────────────────────────────────────

function Hero() {
  const t = useT();
  const { ref, lit } = useLit<HTMLDivElement>("0px");

  return (
    <section className="relative overflow-hidden">
      <div ref={ref} className="mx-auto max-w-6xl px-5 pt-10 sm:pt-16">
        <Rule left={t("landingV3.heroRuleLeft")} right={t("landingV3.heroRuleRight")} />

        <div className="grid items-stretch gap-12 lg:grid-cols-[1fr_0.72fr] lg:gap-14">
          <div className="pb-16 pt-12 sm:pt-16">
            <h1 className="pl-veil pl-display max-w-[13ch]" data-lit={lit}>
              <span>
                <i>{t("landingV3.heroTitleA")}</i>
              </span>
              <span>
                <i>
                  <em className="pl-mark not-italic" data-lit={lit}>
                    {t("landingV3.heroTitleMark")}
                  </em>
                </i>
              </span>
              <span>
                <i>{t("landingV3.heroTitleB")}</i>
              </span>
            </h1>

            <p className="pl-body mt-8 max-w-[46ch]">{t("landingV3.heroSubtitle")}</p>

            <a
              href="#lista"
              className="pl-cta group mt-10 inline-flex items-center gap-3 rounded-full px-7 py-4"
            >
              <span className="pl-mono">{t("landingV3.heroCta")}</span>
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </a>
          </div>

          {/* Papel a la izquierda, noche a la derecha: la primera pantalla dice
              el nombre del sistema sin escribirlo. La foto va a plena fuerza y
              con borde duro —no aguada detrás del texto— porque el contraste
              entre los dos suelos ES la idea. Sangra hasta el borde de la
              ventana, pero la regla de arriba sigue midiendo la caja: la
              columna vertebral de la página no se corre. */}
          <div
            aria-hidden
            className="pl-grain relative -mx-5 hidden min-h-[420px] overflow-hidden lg:block"
            style={{
              background: "var(--pl-stage)",
              marginRight: "calc(-1 * max(0px, (100vw - 72rem) / 2) - 1.25rem)",
            }}
          >
            <Image
              src="/portada/vidriera.jpg"
              alt=""
              fill
              priority
              sizes="45vw"
              className="object-cover object-center"
            />
            {/* La luz de la vidriera arrastrada hacia el amarillo de la marca. */}
            <div
              className="absolute inset-0"
              style={{ background: "var(--pl-acid)", opacity: 0.1, mixBlendMode: "overlay" }}
            />
          </div>
        </div>
      </div>

      {/* En pantalla chica la noche no puede robarle media pantalla al
          titular: pasa a una franja al pie del hero, de borde a borde. */}
      <div
        aria-hidden
        className="pl-grain relative h-44 overflow-hidden sm:h-56 lg:hidden"
        style={{ background: "var(--pl-stage)" }}
      >
        <Image
          src="/portada/vidriera.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-center"
        />
      </div>
    </section>
  );
}

// ── [02] Prueba ───────────────────────────────────────────────────────────

function Proof() {
  const t = useT();
  return (
    <section className="mx-auto max-w-6xl px-5 py-[clamp(56px,7vw,112px)]">
      <Rule left={t("landingV3.proofRuleLeft")} right={t("landingV3.proofRuleRight")} />

      <div className="mt-10 grid items-end gap-8 lg:grid-cols-[auto_1fr] lg:gap-16">
        <p className="pl-figure" style={{ color: "var(--pl-ink)" }}>
          24/7
        </p>
        <div className="max-w-[42ch] pb-2">
          <h2 className="pl-h2">{t("landingV3.proofTitle")}</h2>
          <p className="pl-body mt-4">{t("landingV3.proofBody")}</p>
        </div>
      </div>

      {/* Renglón de libro mayor: tres cifras separadas por reglas. */}
      <div className="mt-14 grid gap-px sm:grid-cols-3">
        {FIGURES.map((f) => (
          <div key={f.label} className="border-t pt-4" style={{ borderColor: "var(--pl-line)" }}>
            <p
              className="pl-h2 !text-[clamp(36px,4.5vw,60px)]"
              style={{ color: "var(--pl-acid-ink)" }}
            >
              {f.v}
            </p>
            <p className="pl-mono mt-2">{t(f.label)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── [04] Índice ───────────────────────────────────────────────────────────

function Index() {
  const t = useT();
  return (
    <section id="funciones" className="mx-auto max-w-6xl px-5 py-[clamp(56px,7vw,112px)]">
      <Rule left={t("landingV3.indexRuleLeft")} right={t("landingV3.indexRuleRight")} />
      <div className="mb-10 mt-10 flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="pl-h2 max-w-[18ch]">{t("landingV3.indexTitle")}</h2>
        <p className="pl-mono" style={{ color: "var(--pl-ink-soft)" }}>
          {t("landingV3.indexHint")}
        </p>
      </div>
      <IndexList />
    </section>
  );
}

// ── [05] Canales ──────────────────────────────────────────────────────────

function Channels() {
  const t = useT();
  return (
    <section className="mx-auto max-w-6xl px-5 py-[clamp(56px,7vw,112px)]">
      <Rule left={t("landingV3.channelsRuleLeft")} right={t("landingV3.channelsRuleRight")} />

      <div className="mt-10 grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <div>
          <h2 className="pl-h2 max-w-[14ch]">{t("landingV3.channelsTitle")}</h2>
          <p className="pl-body mt-4 max-w-[44ch]">{t("landingV3.channelsBody")}</p>
        </div>

        <div>
          <LedgerRow label={t("landing.stripChannels")}>
            {CHANNELS.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-2 text-sm">
                <ChannelLogo channel={c.id as Channel} size={20} /> {t(c.label)}
              </span>
            ))}
            <span className="inline-flex items-center gap-2 text-sm">
              <PhoneCall className="size-5" /> {t("landingV3.channelsCalls")}
            </span>
          </LedgerRow>

          <LedgerRow label={t("landing.stripIntegrations")}>
            {INTEGRATIONS.map((s) => (
              <span key={s.label} className="inline-flex items-center gap-2 text-sm">
                <Image src={s.src} alt="" width={20} height={20} className="size-5 object-contain" />
                {s.label}
              </span>
            ))}
          </LedgerRow>
        </div>
      </div>
    </section>
  );
}

function LedgerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t py-5" style={{ borderColor: "var(--pl-line)" }}>
      <p className="pl-mono mb-3" style={{ color: "var(--pl-ink-soft)" }}>
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">{children}</div>
    </div>
  );
}

// ── [06] Cierre ───────────────────────────────────────────────────────────

function Close() {
  const t = useT();
  return (
    <section id="lista" className="pl-stage pl-grain relative overflow-hidden">
      <div aria-hidden className="pl-floor" />
      <div className="relative mx-auto max-w-6xl px-5 py-[clamp(64px,9vw,140px)]">
        <Rule left={t("landingV3.closeRuleLeft")} right={t("landingV3.closeRuleRight")} />

        <div className="mt-12 max-w-[22ch]">
          <Headline
            a={t("landingV3.closeTitleA")}
            mark={t("landingV3.closeTitleMark")}
            b={t("landingV3.closeTitleB")}
          />
        </div>

        <p className="pl-body mt-8 max-w-[44ch]">{t("landingV3.closeBody")}</p>

        <div className="mt-10 max-w-md">
          <WaitlistForm tone="dark" />
        </div>
      </div>
    </section>
  );
}
