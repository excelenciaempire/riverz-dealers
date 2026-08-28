"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, PhoneCall } from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { useLocale, useT } from "@/hooks/use-locale";
import { localizePath } from "@/lib/i18n/routes";
import type { Channel } from "@/types";
import type { Locale } from "@/lib/i18n/config";
import {
  AgentPanel,
  CallPreview,
  CampaignPreview,
  CartRecoveryPanel,
  CommentsPreview,
  ContactsPreview,
  FlowPreview,
  HeroInbox,
  InboxPreview,
  LivePreview,
  MetricsPreview,
  ProductPreview,
  SetupPreview,
  SupportPreview,
  WaitlistForm,
} from "@/components/landing/landing";
import { LOCALES } from "@/lib/i18n/config";
import { useInView } from "@/components/landing/v4/bits";
import { OperatorDark } from "./operator-dark";
import "./dark.css";

/**
 * Portada oscura — riverz.co/portada-c
 * ────────────────────────────────────────────────────────────────────────
 * Tercera piel para el mismo producto, en el registro de shopify.com. Es el
 * opuesto exacto de /portada-b y por eso sirve para comparar:
 *
 *   /portada-b   papel crema, serif de contraste alto, un solo acento
 *   /portada-c   negro de punta a punta, grotesca blanca, un degradado
 *                propio por sección, fotografía real de gente y producto
 *
 * Lo que NO cambia es lo que se promete: el titular, la descripción, el Loop,
 * el Operator y las trece funciones se leen de `landingV4` y de `landing`, los
 * mismos catálogos que usa la otra. Si mañana se corrige una función, se
 * corrige una vez y las tres portadas quedan iguales.
 *
 * Sin sección de oferta: la instalación gratis es temporal y vive en el
 * diálogo de /portada-b. Meterla acá obligaría a sacarla de dos lugares.
 */

type Ch = "whatsapp" | "instagram" | "messenger" | "gmail" | "mercadolibre" | "tiktok_comment";

const CHANNELS: { id: Ch; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "messenger", label: "Messenger" },
  { id: "gmail", label: "landing.channelEmail" },
  { id: "mercadolibre", label: "Mercado Libre" },
  { id: "tiktok_comment", label: "TikTok" },
];

const STORES = [
  { src: "/channels/shopify.svg", label: "Shopify" },
  { src: "/channels/woocommerce.svg", label: "WooCommerce" },
  { src: "/channels/tiendanube.svg", label: "Tiendanube" },
];

export function LandingV5() {
  const { locale } = useLocale();
  return (
    <div className="sh min-h-screen">
      <Nav />
      <main id="contenido">
        <Hero />
        <Tira />
        <Operator />
        <Loop />
        <Cifras />
        <Capacidades />
        <Canales />
        <Cierre />
      </main>
      <Pie locale={locale} />
    </div>
  );
}

/** Bloque que sube al entrar en pantalla. */
function Rise({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-in={inView}
      className={`sh-rise ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

// ── Navegación ────────────────────────────────────────────────────────────

function Nav() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <header
      className="sticky top-0 z-30 backdrop-blur"
      style={{ background: "rgba(10,15,14,0.72)", borderBottom: "1px solid var(--sh-line)" }}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-5 py-4">
        <span className="text-[19px] font-semibold lowercase tracking-[-0.03em]">riverz</span>

        <div className="hidden items-center gap-7 text-[15px] md:flex">
          <a href="#operator" className="transition-opacity hover:opacity-60">
            {t("landingV4.navOperator")}
          </a>
          <a href="#loop" className="transition-opacity hover:opacity-60">
            {t("landingV4.navLoop")}
          </a>
          <a href="#capacidades" className="transition-opacity hover:opacity-60">
            {t("landingV4.navCapabilities")}
          </a>
          <a href="#canales" className="transition-opacity hover:opacity-60">
            {t("landingV4.navChannels")}
          </a>
        </div>

        <div className="flex items-center gap-4">
          <div className="sh-label flex items-center gap-2">
            {LOCALES.map((l, i) => (
              <span key={l} className="flex items-center gap-2">
                {i > 0 && (
                  <span aria-hidden className="opacity-40">
                    /
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setLocale(l)}
                  aria-pressed={locale === l}
                  className={locale === l ? "text-white underline underline-offset-4" : "hover:opacity-100"}
                >
                  {l}
                </button>
              </span>
            ))}
          </div>
          <a href="#acceso" className="sh-btn sh-btn-solid !px-4 !py-2 !text-[14px]">
            {t("landingV5.heroCta")}
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
      {/* La foto ocupa el alto entero y el texto va encima, como en Shopify.
          El velo es un degradado desde la izquierda, no una capa pareja: así
          la cara de la foto queda limpia y el titular siempre cae sobre
          negro, a cualquier ancho. */}
      <div aria-hidden className="absolute inset-0">
        <Image
          src="/portada-c/hero.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[68%_center] lg:object-center"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(90deg, rgba(10,15,14,0.94) 0%, rgba(10,15,14,0.82) 38%, rgba(10,15,14,0.35) 70%, rgba(10,15,14,0.55) 100%)",
          }}
        />
        <div
          className="absolute inset-x-0 bottom-0 h-40"
          style={{ background: "linear-gradient(0deg, #0a0f0e 0%, rgba(10,15,14,0) 100%)" }}
        />
      </div>

      <div className="relative mx-auto max-w-6xl px-5 py-24 sm:py-32 lg:py-44">
        <Rise>
          <h1 className="sh-display max-w-[16ch]">
            {t("landingV4.heroTitleLead")}
            <br />
            <span style={{ color: "var(--sh-muted)" }}>{t("landingV4.heroTitleMuted")}</span>
          </h1>
        </Rise>
        <Rise delay={90}>
          <p className="sh-body mt-7 max-w-[54ch]">{t("landingV4.heroSubtitle")}</p>
        </Rise>
        <Rise delay={180}>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href="#acceso" className="sh-btn sh-btn-solid group">
              {t("landingV5.heroCta")}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a href="#loop" className="sh-btn sh-btn-ghost">
              {t("landingV5.heroCtaAlt")}
            </a>
          </div>
        </Rise>
      </div>
    </section>
  );
}

// ── Tira de fotos ─────────────────────────────────────────────────────────

const TIRA = [
  { src: "/portada-c/t1.jpg", alt: "landingV5.tiraAlt1" },
  { src: "/portada-c/t2.jpg", alt: "landingV5.tiraAlt2" },
  { src: "/portada-c/t3.jpg", alt: "landingV5.tiraAlt3" },
  { src: "/portada-c/t4.jpg", alt: "landingV5.tiraAlt4" },
];

function Tira() {
  const t = useT();
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
      <Rise>
        <h2 className="sh-h2 max-w-[20ch]">{t("landingV5.tiraTitle")}</h2>
      </Rise>
      <Rise delay={90}>
        {/* Cuatro verticales en fila, como la tira de Shopify. En el teléfono
            se deslizan de lado en vez de apilarse: cuatro fotos apiladas son
            cuatro pantallas de scroll y nadie las mira. */}
        <div className="mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] sm:grid sm:grid-cols-4 sm:overflow-visible [&::-webkit-scrollbar]:hidden">
          {TIRA.map((im) => (
            <div
              key={im.src}
              className="relative aspect-[3/4] w-[68vw] shrink-0 snap-center overflow-hidden rounded-2xl sm:w-auto"
            >
              <Image
                src={im.src}
                alt={t(im.alt)}
                fill
                sizes="(max-width: 640px) 68vw, 24vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      </Rise>

      <Rise delay={140}>
        <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
          {CHANNELS.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2 text-[15px]">
              <ChannelLogo channel={c.id as Channel} size={20} /> {t(c.label)}
            </span>
          ))}
          <span className="inline-flex items-center gap-2 text-[15px]">
            <PhoneCall className="size-5" /> {t("landingV4.channelsCalls")}
          </span>
        </div>
      </Rise>
    </section>
  );
}

// ── Operator ──────────────────────────────────────────────────────────────

function Operator() {
  const t = useT();
  return (
    <section
      id="operator"
      className="sh-full sh-tinte scroll-mt-20 py-20 lg:py-28"
      style={{ ["--tinte" as string]: "var(--sh-violet)" }}
    >
      <div className="mx-auto max-w-6xl px-5">
        <Rise className="text-center">
          <p className="sh-label" style={{ color: "var(--sh-accent)" }}>
            {t("landingV4.operatorLabel")}
          </p>
          <h2 className="sh-h2 mx-auto mt-5 max-w-[16ch]">{t("landingV4.operatorTitle")}</h2>
          <p className="sh-body mx-auto mt-5 max-w-[48ch]">{t("landingV4.operatorLead")}</p>
        </Rise>
        <div className="mt-14">
          <OperatorDark />
        </div>
      </div>
    </section>
  );
}

// ── Loop ──────────────────────────────────────────────────────────────────

const LOOP = [
  { t: "landingV4.loop1Title", b: "landingV4.loop1Body", P: HeroInbox },
  { t: "landingV4.loop2Title", b: "landingV4.loop2Body", P: AgentPanel },
  { t: "landingV4.loop3Title", b: "landingV4.loop3Body", P: SupportPreview },
  { t: "landingV4.loop4Title", b: "landingV4.loop4Body", P: CartRecoveryPanel },
  { t: "landingV4.loop5Title", b: "landingV4.loop5Body", P: MetricsPreview },
] as const;

function Loop() {
  const t = useT();
  return (
    <section id="loop" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 lg:py-24">
      <Rise>
        <p className="sh-label">{t("landingV4.loopLabel")}</p>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 className="sh-h2 max-w-[17ch]">{t("landingV4.loopTitle")}</h2>
          <p className="sh-body max-w-[44ch]">{t("landingV4.loopLead")}</p>
        </div>
      </Rise>

      {/* La lista numerada con filete, como «Crea rápido en Shopify»: el número
          en color, el título grande, y una línea que separa cada paso. */}
      <ol className="mt-12">
        {LOOP.map((p, i) => (
          <Rise key={p.t} delay={(i % 2) * 70}>
            <li
              className="grid items-center gap-6 border-t py-8 lg:grid-cols-[auto_1fr_1fr] lg:gap-10"
              style={{ borderColor: "var(--sh-line)" }}
            >
              <span
                className="text-[15px] font-medium tabular-nums"
                style={{ color: "var(--sh-accent)" }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <h3 className="sh-h2 !text-[clamp(23px,2.4vw,34px)]">{t(p.t)}</h3>
                <p className="sh-body mt-3 max-w-[46ch] !text-[15px]">{t(p.b)}</p>
              </div>
              <div className="sh-panel min-w-0 overflow-x-auto rounded-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <p.P />
              </div>
            </li>
          </Rise>
        ))}
      </ol>
    </section>
  );
}

// ── Cifras ────────────────────────────────────────────────────────────────

const CIFRAS = [
  { n: "7", l: "landingV5.cifra1" },
  { n: "9", l: "landingV5.cifra2" },
  { n: "14", l: "landingV5.cifra3" },
  { n: "4", l: "landingV5.cifra4" },
];

function Cifras() {
  const t = useT();
  return (
    <section
      className="sh-full sh-tinte py-20 lg:py-28"
      style={{ ["--tinte" as string]: "var(--sh-green)" }}
    >
      <div className="mx-auto max-w-6xl px-5">
        <Rise>
          <p className="sh-label">{t("landingV5.cifrasLabel")}</p>
          <h2 className="sh-h2 mt-5 max-w-[18ch]">{t("landingV5.cifrasTitle")}</h2>
        </Rise>
        <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {CIFRAS.map((c, i) => (
            <Rise key={c.l} delay={i * 70}>
              <div className="border-t pt-5" style={{ borderColor: "var(--sh-line)" }}>
                <p className="sh-figure">{c.n}</p>
                <p className="sh-body mt-3 max-w-[22ch] !text-[15px]">{t(c.l)}</p>
              </div>
            </Rise>
          ))}
        </div>

        <Rise delay={120}>
          <div className="relative mt-16 aspect-[21/9] w-full overflow-hidden rounded-2xl">
            <Image
              src="/portada-c/equipo.jpg"
              alt={t("landingV5.equipoAlt")}
              fill
              sizes="100vw"
              className="object-cover"
            />
          </div>
        </Rise>
      </div>
    </section>
  );
}

// ── Capacidades ───────────────────────────────────────────────────────────

const FICHAS = [
  { t: "landing.sec01Title", m: "landing.sec01TitleMuted", b: "landing.sec01Body", P: AgentPanel },
  { t: "landing.sec02Title", m: "landing.sec02TitleMuted", b: "landing.sec02Body", P: CartRecoveryPanel },
  { t: "landing.sec03Title", m: "landing.sec03TitleMuted", b: "landing.sec03Body", P: FlowPreview },
  { t: "landing.sec04Title", m: "landing.sec04TitleMuted", b: "landing.sec04Body", P: SupportPreview },
  { t: "landing.secVoiceTitle", m: "landing.secVoiceTitleMuted", b: "landing.secVoiceBody", P: CallPreview },
  { t: "landing.sec05Title", m: "landing.sec05TitleMuted", b: "landing.sec05Body", P: CommentsPreview },
  { t: "landing.sec06Title", m: "landing.sec06TitleMuted", b: "landing.sec06Body", P: CampaignPreview },
  { t: "landing.sec07Title", m: "landing.sec07TitleMuted", b: "landing.sec07Body", P: InboxPreview },
  { t: "landing.secLiveTitle", m: "landing.secLiveTitleMuted", b: "landing.secLiveBody", P: LivePreview },
  { t: "landing.secContactsTitle", m: "landing.secContactsTitleMuted", b: "landing.secContactsBody", P: ContactsPreview },
  { t: "landing.sec08Title", m: "landing.sec08TitleMuted", b: "landing.sec08Body", P: ProductPreview },
  { t: "landing.sec09Title", m: "landing.sec09TitleMuted", b: "landing.sec09Body", P: SetupPreview },
  { t: "landing.sec10Title", m: "landing.sec10TitleMuted", b: "landing.sec10Body", P: MetricsPreview },
] as const;

function Capacidades() {
  const t = useT();
  return (
    <section id="capacidades" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 lg:py-24">
      <Rise>
        <p className="sh-label">{t("landingV4.capsLabel")}</p>
        <h2 className="sh-h2 mt-5 max-w-[18ch]">{t("landingV4.capsTitle")}</h2>
        <p className="sh-body mt-4 max-w-[48ch]">{t("landingV4.capsBody")}</p>
      </Rise>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FICHAS.map((f, i) => (
          <Rise key={f.t} delay={(i % 3) * 70} className="min-w-0">
            <article className="sh-card flex h-full min-w-0 flex-col overflow-hidden p-6">
              <h3 className="sh-h3 max-w-[22ch]">
                {t(f.t)} <span style={{ color: "var(--sh-faint)" }}>{t(f.m)}</span>
              </h3>
              <p className="sh-body mt-3 !text-[14px]">{t(f.b)}</p>
              <div className="sh-panel mt-auto min-w-0 overflow-x-auto pt-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <f.P />
              </div>
            </article>
          </Rise>
        ))}
      </div>
    </section>
  );
}

// ── Canales ───────────────────────────────────────────────────────────────

function Canales() {
  const t = useT();
  return (
    <section id="canales" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-16 lg:py-24">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <Rise>
          <p className="sh-label">{t("landingV4.channelsLabel")}</p>
          <h2 className="sh-h2 mt-5 max-w-[15ch]">{t("landingV4.channelsTitle")}</h2>
          <p className="sh-body mt-5 max-w-[44ch]">{t("landingV4.channelsBody")}</p>
        </Rise>

        <Rise delay={90}>
          <div className="sh-card p-6 sm:p-8">
            <p className="sh-label">{t("landingV4.channelsInboxes")}</p>
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

            <div className="mt-8 border-t pt-6" style={{ borderColor: "var(--sh-line)" }}>
              <p className="sh-label">{t("landingV4.channelsStores")}</p>
              <div className="mt-5 flex flex-wrap gap-x-7 gap-y-4">
                {STORES.map((s) => (
                  <span key={s.label} className="inline-flex items-center gap-2.5 text-[15px]">
                    {/* `unoptimized`: el optimizador de Next rechaza SVG y
                        devuelve 400 mientras `dangerouslyAllowSVG` esté
                        apagado. */}
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
                <span className="inline-flex items-center gap-2.5 text-[15px]">
                  <ChannelLogo channel="mercadolibre" size={22} /> Mercado Libre
                </span>
              </div>
            </div>

            <ul className="mt-8 space-y-3 border-t pt-6" style={{ borderColor: "var(--sh-line)" }}>
              {["landingV4.pillar1", "landingV4.pillar2", "landingV4.pillar3"].map((k) => (
                <li key={k} className="flex items-start gap-3">
                  <Check className="mt-1 size-4 shrink-0" style={{ color: "var(--sh-accent)" }} />
                  <span className="sh-body !text-[14px]">{t(k)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Rise>
      </div>
    </section>
  );
}

// ── Cierre ────────────────────────────────────────────────────────────────

function Cierre() {
  const t = useT();
  return (
    <section
      id="acceso"
      className="sh-full sh-tinte scroll-mt-20 py-20 text-center lg:py-32"
      style={{ ["--tinte" as string]: "var(--sh-navy)" }}
    >
      <div className="mx-auto max-w-6xl px-5">
        <Rise>
          <h2 className="sh-h2 mx-auto max-w-[18ch]">{t("landingV4.ctaTitle")}</h2>
          <p className="sh-body mx-auto mt-5 max-w-[46ch]">{t("landingV4.ctaBody")}</p>
        </Rise>
        <div className="mx-auto mt-10 flex max-w-md justify-center">
          <WaitlistForm tone="dark" />
        </div>
      </div>
    </section>
  );
}

// ── Pie ───────────────────────────────────────────────────────────────────

function Pie({ locale }: { locale: Locale }) {
  const t = useT();
  return (
    <footer className="mx-auto max-w-6xl px-5 pb-12 pt-14">
      <div
        className="flex flex-col gap-5 border-t pt-7 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderColor: "var(--sh-line)" }}
      >
        <div className="flex items-center gap-4">
          <span className="text-[17px] font-semibold lowercase tracking-[-0.03em]">riverz</span>
          <a href="mailto:info@riverzai.com" className="sh-label hover:opacity-70">
            info@riverzai.com
          </a>
        </div>
        <div className="sh-label flex flex-wrap gap-x-7 gap-y-2">
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
