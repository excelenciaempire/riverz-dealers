"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Inbox,
  Sparkles,
  Megaphone,
  ShoppingBag,
  ShoppingCart,
  RotateCcw,
  Package,
  BarChart3,
  ArrowRight,
  Check,
  CheckCheck,
  Clock,
  Send,
  MessageSquare,
  TrendingUp,
  Boxes,
  Tag,
  Truck,
  Star,
  MousePointerClick,
  Heart,
  CornerDownRight,
  Headset,
  Sun,
  Moon,
} from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";
import { useLocale, useT } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";
import { LOCALES } from "@/lib/i18n/config";
import type { Channel } from "@/types";

/**
 * Public marketing landing for riverz.co (logged-out root). Interactive,
 * theme-aware, lime accent, Inter Tight.
 *
 * Type scale ported 1:1 from riverzai.com's editorial system so the two
 * surfaces feel like one brand:
 *   display  → clamp(40px, 7vw, 82px)   tracking -0.045em  leading 0.96
 *   h2/title → clamp(26px, 3.2vw, 38px) tracking -0.035em  leading 1.05
 *   body     → clamp(15px, 1.3vw, 17px) tracking -0.005em  leading 1.55
 *
 * Every former feature card is now its own full alternating section, each
 * with a self-contained, mobile-first interactive preview. The hero plays a
 * looping animation where the AI attends a customer and closes a sale — the
 * same component scales cleanly from phone to desktop. No real customer data.
 */

// Shared editorial type scale (matches riverzai.com).
const DISPLAY =
  "font-medium tracking-[-0.045em] leading-[0.96] text-[clamp(40px,7vw,82px)]";
const H2 =
  "font-medium tracking-[-0.035em] leading-[1.05] text-[clamp(26px,3.2vw,38px)]";
const BODY =
  "text-[clamp(15px,1.3vw,17px)] leading-[1.55] tracking-[-0.005em] text-muted-foreground";
const SECTION = "py-[clamp(64px,8vw,128px)]";

type Ch = "whatsapp" | "instagram" | "messenger" | "gmail";

// `label` for branded channels is the brand name (rendered as-is); the email
// channel uses an i18n key resolved with t() at the render site.
const CHANNELS: { id: Ch; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "messenger", label: "Messenger" },
  { id: "gmail", label: "landing.channelEmail" },
];

// Unified inbox preview rows — the four channels plus a public comment that
// the agent answers and moves to a DM (so comments live in the same bandeja).
// String fields hold i18n keys (or brand labels); they're resolved with t() at
// the render site. `name` holds proper nouns left as-is, except the email and
// comment rows whose names are translatable labels.
const INBOX: {
  id: Channel;
  label: string;
  name: string;
  them: string;
  you: string;
  note: string;
}[] = [
  { id: "whatsapp", label: "WhatsApp", name: "Laura M.", them: "landing.inboxWaThem", you: "landing.inboxWaYou", note: "landing.inboxNoteReplied" },
  { id: "instagram", label: "Instagram", name: "andres.q", them: "landing.inboxIgThem", you: "landing.inboxIgYou", note: "landing.inboxNoteReplied" },
  { id: "messenger", label: "Messenger", name: "Sofía R.", them: "landing.inboxMsgThem", you: "landing.inboxMsgYou", note: "landing.inboxNoteReplied" },
  { id: "gmail", label: "landing.channelEmail", name: "landing.inboxMailName", them: "landing.inboxMailThem", you: "landing.inboxMailYou", note: "landing.inboxNoteReplied" },
  { id: "ig_comment", label: "landing.inboxCommentLabel", name: "landing.inboxCommentName", them: "landing.inboxCommentThem", you: "landing.inboxCommentYou", note: "landing.inboxNoteComment" },
];

// ─────────────────────────────────────────────────────────────────────────
// Small shared hooks
// ─────────────────────────────────────────────────────────────────────────

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fn = () => setReduced(m.matches);
    const id = requestAnimationFrame(fn); // initial read, deferred off effect body
    m.addEventListener?.("change", fn);
    return () => {
      cancelAnimationFrame(id);
      m.removeEventListener?.("change", fn);
    };
  }, []);
  return reduced;
}

/** Count up to `target` once `run` flips true. */
function useCountUp(target: number, run: boolean, duration = 1100, trigger = 0) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / duration);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run, duration, trigger]);
  return v;
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

// title / titleMuted / body hold i18n keys resolved with t() at the render site
// (FeatureSection), mirroring the navGroups pattern in sidebar.tsx. `eyebrow`
// and `n` are inert data — not rendered — so they keep plain literals.
const SECTIONS: {
  n: string;
  eyebrow: string;
  icon: typeof Inbox;
  title: string;
  titleMuted: string;
  body: string;
  Preview: () => React.ReactElement;
}[] = [
  {
    n: "01",
    eyebrow: "Agente de ventas",
    icon: Sparkles,
    title: "landing.sec01Title",
    titleMuted: "landing.sec01TitleMuted",
    body: "landing.sec01Body",
    Preview: AgentPanel,
  },
  {
    n: "02",
    eyebrow: "Carritos abandonados",
    icon: ShoppingCart,
    title: "landing.sec02Title",
    titleMuted: "landing.sec02TitleMuted",
    body: "landing.sec02Body",
    Preview: CartRecoveryPanel,
  },
  {
    n: "03",
    eyebrow: "Recompras",
    icon: RotateCcw,
    title: "landing.sec03Title",
    titleMuted: "landing.sec03TitleMuted",
    body: "landing.sec03Body",
    Preview: FlowPreview,
  },
  {
    n: "04",
    eyebrow: "Soporte",
    icon: Headset,
    title: "landing.sec04Title",
    titleMuted: "landing.sec04TitleMuted",
    body: "landing.sec04Body",
    Preview: SupportPreview,
  },
  {
    n: "05",
    eyebrow: "Comentarios",
    icon: MessageSquare,
    title: "landing.sec05Title",
    titleMuted: "landing.sec05TitleMuted",
    body: "landing.sec05Body",
    Preview: CommentsPreview,
  },
  {
    n: "06",
    eyebrow: "Campañas",
    icon: Megaphone,
    title: "landing.sec06Title",
    titleMuted: "landing.sec06TitleMuted",
    body: "landing.sec06Body",
    Preview: CampaignPreview,
  },
  {
    n: "07",
    eyebrow: "Bandeja",
    icon: Inbox,
    title: "landing.sec07Title",
    titleMuted: "landing.sec07TitleMuted",
    body: "landing.sec07Body",
    Preview: InboxPreview,
  },
  {
    n: "08",
    eyebrow: "Productos",
    icon: Package,
    title: "landing.sec08Title",
    titleMuted: "landing.sec08TitleMuted",
    body: "landing.sec08Body",
    Preview: ProductPreview,
  },
  {
    n: "09",
    eyebrow: "Configuración",
    icon: MousePointerClick,
    title: "landing.sec09Title",
    titleMuted: "landing.sec09TitleMuted",
    body: "landing.sec09Body",
    Preview: SetupPreview,
  },
  {
    n: "10",
    eyebrow: "Resultados",
    icon: BarChart3,
    title: "landing.sec10Title",
    titleMuted: "landing.sec10TitleMuted",
    body: "landing.sec10Body",
    Preview: MetricsPreview,
  },
];

export function Landing() {
  const t = useT();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/75 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-[max(0.875rem,env(safe-area-inset-top))] pb-3.5">
          <span className="text-[19px] font-semibold lowercase tracking-[0.04em] text-accent-ink">riverz</span>
          <div className="flex items-center gap-2 sm:gap-3">
            <LandingLocaleToggle />
            <LandingThemeToggle />
            <a
              href="#lista"
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03]"
            >
              {t("landing.navWaitlist")}
            </a>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]"
        />
        <div className="relative mx-auto max-w-6xl px-5 pb-12 pt-16 sm:pt-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
            <div>
              <h1 className={`max-w-[15ch] animate-in fade-in slide-in-from-bottom-3 text-balance duration-700 ${DISPLAY}`}>
                {t("landing.heroTitleLead")}{" "}
                <span className="text-muted-foreground">{t("landing.heroTitleMuted")}</span>
              </h1>
              <p className="mt-6 max-w-[34ch] animate-in fade-in slide-in-from-bottom-3 text-[clamp(16px,1.6vw,20px)] leading-relaxed tracking-[-0.01em] text-muted-foreground duration-700 sm:max-w-[46ch]">
                {t("landing.heroSubtitle")}
              </p>
              <div className="mt-8">
                <a
                  href="#lista"
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.03]"
                >
                  {t("landing.heroCta")}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </a>
              </div>
            </div>

            <div className="animate-in fade-in duration-1000 sm:mx-auto sm:max-w-sm lg:mx-0 lg:max-w-none">
              <HeroInbox />
            </div>
          </div>
        </div>
      </section>

      {/* Channels */}
      <section className="border-y border-border/50 bg-muted/20">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-5 py-7">
          {CHANNELS.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <ChannelLogo channel={c.id} size={22} /> {t(c.label)}
            </span>
          ))}
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <MetaLogo size={22} /> Meta
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <ShopifyLogo size={22} /> Shopify
          </span>
        </div>
      </section>

      {/* Feature sections — one per former card, alternating */}
      <div id="funciones" className="divide-y divide-border/40">
        {SECTIONS.map((s, i) => (
          <FeatureSection key={s.n} s={s} flip={i % 2 === 1} />
        ))}
      </div>

      {/* CTA — the dedicated waitlist screen the hero + nav buttons jump to */}
      <section id="lista" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-24">
        {/* Intentionally always-dark editorial band. In dark mode the page bg
            (#0a0a0a) is nearly the same shade, so a faint border keeps the band
            a defined panel instead of an edgeless blur; in light mode it just
            reads as a subtle inner highlight on the dark block. */}
        <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#0b0b0a] px-6 py-20 text-center sm:px-12">
          {/* warm lime glow + faint grid */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 h-[360px] w-[760px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/25 blur-[130px]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage:
                "linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)",
              backgroundSize: "44px 44px",
              maskImage: "radial-gradient(ellipse at center, #000 30%, transparent 75%)",
            }}
          />
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-primary">
              <Sparkles className="size-3.5" /> {t("landing.ctaBadge")}
            </span>
            <h2 className="mx-auto mt-6 max-w-[18ch] text-balance text-[clamp(32px,4.6vw,58px)] font-medium leading-[1.02] tracking-[-0.04em] text-white">
              {t("landing.ctaTitle")}
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-white/55">
              {t("landing.ctaSubtitle")}
            </p>
            <div className="mt-9 flex justify-center">
              <WaitlistForm tone="dark" />
            </div>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-white/40">
              <span>{t("landing.ctaNoCommitment")}</span>
              <span className="size-1 rounded-full bg-white/25" />
              <span>{t("landing.ctaNoSpam")}</span>
              <span className="size-1 rounded-full bg-white/25" />
              <span>{t("landing.ctaFirstToKnow")}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-9 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-[17px] font-semibold lowercase tracking-[0.04em] text-accent-ink">riverz</span>
            <p className="mt-1 text-xs text-muted-foreground">
              <a href="mailto:info@riverzai.com" className="hover:text-foreground">info@riverzai.com</a>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <a href="#funciones" className="hover:text-foreground">{t("landing.footerFeatures")}</a>
            <Link href="/terminos" className="hover:text-foreground">{t("landing.footerTerms")}</Link>
            <Link href="/privacidad" className="hover:text-foreground">{t("landing.footerPrivacy")}</Link>
            <Link href="/eliminar-datos" className="hover:text-foreground">{t("landing.footerDeleteData")}</Link>
          </div>
        </div>
        <div className="border-t border-border/40 py-4 text-center text-[11px] text-muted-foreground">
          {t("landing.footerRights")}
        </div>
      </footer>
    </div>
  );
}

function FeatureSection({
  s,
  flip,
}: {
  s: (typeof SECTIONS)[number];
  flip: boolean;
}) {
  const t = useT();
  // Replay the preview's animation each time it scrolls into view (on every
  // device) by remounting it via a changing key — so the visitor always sees
  // it play from the start the moment it appears, never mid-loop or finished.
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [playKey, setPlayKey] = useState(0);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setPlayKey((k) => k + 1);
      },
      { threshold: 0.3, rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className={SECTION}>
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid items-center gap-10 md:grid-cols-[0.85fr_1.15fr] md:gap-12 lg:gap-16">
          <div className={flip ? "md:order-2" : undefined}>
            <h2 className={H2}>
              {t(s.title)}{" "}
              <span className="text-muted-foreground">{t(s.titleMuted)}</span>
            </h2>
            <p className={`mt-5 max-w-[420px] ${BODY}`}>{t(s.body)}</p>
          </div>
          <div ref={previewRef} className={flip ? "md:order-1" : undefined}>
            <s.Preview key={playKey} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Shared preview chrome
// ─────────────────────────────────────────────────────────────────────────

function PreviewFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mx-auto w-full max-w-[440px] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/20 md:max-w-[500px] lg:max-w-[540px] ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="size-3 rounded-full bg-muted-foreground/25" />
        <span className="size-3 rounded-full bg-muted-foreground/25" />
        <span className="size-3 rounded-full bg-muted-foreground/25" />
        <span className="ml-3 text-xs font-medium lowercase tracking-[0.04em] text-accent-ink">riverz</span>
      </div>
      {children}
    </div>
  );
}

// Brand marks (assets shared with the app's settings screens).
function ShopifyLogo({ size = 13 }: { size?: number }) {
  return (
    <Image src="/channels/shopify.svg" alt="Shopify" width={size} height={size} className="inline-block" />
  );
}

function MetaLogo({ size = 13 }: { size?: number }) {
  return (
    <Image src="/channels/meta.svg" alt="Meta" width={size} height={size} className="inline-block" />
  );
}

// Language switch for the landing nav. The public landing has no app chrome,
// so this is the only place a logged-out visitor can pick a language. It drives
// the same shared LocaleProvider the app uses (cookie + localStorage), so the
// choice carries into the app after sign-up and vice-versa. Compact segmented
// pill: the active locale is highlighted; the codes show as-is (ES / EN).
function LandingLocaleToggle() {
  const { locale, setLocale } = useLocale();
  return (
    <div className="inline-flex items-center rounded-full border border-border/60 p-0.5 text-xs font-medium">
      {LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => setLocale(loc)}
          aria-pressed={locale === loc}
          className={`rounded-full px-2.5 py-1 uppercase transition-colors ${
            locale === loc
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {loc}
        </button>
      ))}
    </div>
  );
}

// Light / dark switch for the landing nav. The landing defaults to dark, but
// the choice is the same shared preference the app uses (see ThemeProvider +
// the boot script in layout.tsx), so flipping it here carries into the app and
// vice-versa. Mirrors the sidebar control: Sun when dark (→ go light), Moon
// when light (→ go dark).
function LandingThemeToggle() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={t("nav.toggleTheme")}
      title={t("nav.toggleTheme")}
      className="flex size-9 items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
    >
      {/* Icon is driven purely by the live data-theme via the `dark:` CSS
          variant, so the markup is identical on server and client (no
          hydration mismatch even though the landing boots to dark while the
          server rendered the light default): Moon in light (→ go dark), Sun in
          dark (→ go light). */}
      <Moon className="size-4 dark:hidden" />
      <Sun className="hidden size-4 dark:block" />
    </button>
  );
}

// Pre-launch waitlist signup. Posts to /api/waitlist, which stores the lead
// and emails the owner. Works on light (hero) and dark (CTA) backgrounds.
function WaitlistForm({ tone = "light" }: { tone?: "light" | "dark" }) {
  const t = useT();
  const dark = tone === "dark";
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === "loading" || status === "done") return;
    const website = String(new FormData(e.currentTarget).get("website") ?? "");
    setStatus("loading");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), website }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium ${
          dark ? "bg-white/10 text-white" : "bg-primary/15 text-accent-ink"
        }`}
      >
        <Check className="size-4" /> {t("landing.waitlistDone")}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-md">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("landing.emailPlaceholder")}
          autoComplete="email"
          aria-label={t("landing.emailAriaLabel")}
          className={`min-w-0 flex-1 rounded-full border px-4 py-2.5 text-sm outline-none transition-colors ${
            dark
              ? "border-white/15 bg-white/5 text-white placeholder:text-white/40 focus:border-white/40"
              : "border-border bg-card text-foreground placeholder:text-muted-foreground focus:border-foreground/30"
          }`}
        />
        {/* honeypot — bots fill it, humans never see it */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="pointer-events-none absolute -left-[9999px] h-0 w-0 opacity-0"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.03] disabled:opacity-60"
        >
          {status === "loading" ? t("landing.waitlistSending") : t("landing.waitlistSubmit")}
          {status !== "loading" && (
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          )}
        </button>
      </div>
      {status === "error" && (
        <p className={`mt-2 text-xs ${dark ? "text-white/60" : "text-muted-foreground"}`}>
          {t("landing.waitlistError")}
        </p>
      )}
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// HERO: the agent attends customers across EVERY inbox and closes the sale.
// The channel tab cycles (WhatsApp → Instagram → Messenger → Correo) so the
// whole unified inbox is on display; each loop ends on a confirmed sale that
// holds a beat longer. Mobile-first: fluid frame, justify-end roll-up.
// ─────────────────────────────────────────────────────────────────────────

type Step =
  | { kind: "them"; text: string }
  | { kind: "you"; text: string }
  | { kind: "typing" }
  | { kind: "sale" };

// Generic, varied products — the landing never hard-codes a single SKU.
type Product = { emoji: string; name: string; price: string };

type HeroConvo = {
  channel: Ch;
  name: string;
  product: Product;
  order: string;
  steps: Step[];
};

// `name` holds proper nouns (left as-is); `product.name` and every step `text`
// hold i18n keys resolved with t() at the render site.
const HERO_CONVOS: HeroConvo[] = [
  {
    channel: "whatsapp",
    name: "Laura M.",
    product: { emoji: "👟", name: "landing.prodSneakers", price: "$239.000" },
    order: "#1042",
    steps: [
      { kind: "them", text: "landing.hero1Them1" },
      { kind: "typing" },
      { kind: "you", text: "landing.hero1You1" },
      { kind: "you", text: "landing.hero1You2" },
      { kind: "them", text: "landing.hero1Them2" },
      { kind: "typing" },
      { kind: "you", text: "landing.hero1You3" },
      { kind: "sale" },
    ],
  },
  {
    channel: "instagram",
    name: "andres.q",
    product: { emoji: "🌸", name: "landing.prodPerfume", price: "$185.000" },
    order: "#1043",
    steps: [
      { kind: "them", text: "landing.hero2Them1" },
      { kind: "typing" },
      { kind: "you", text: "landing.hero2You1" },
      { kind: "you", text: "landing.hero2You2" },
      { kind: "them", text: "landing.hero2Them2" },
      { kind: "typing" },
      { kind: "you", text: "landing.hero2You3" },
      { kind: "sale" },
    ],
  },
  {
    channel: "messenger",
    name: "Sofía R.",
    product: { emoji: "🎒", name: "landing.prodBackpack", price: "$129.000" },
    order: "#1044",
    steps: [
      { kind: "them", text: "landing.hero3Them1" },
      { kind: "typing" },
      { kind: "you", text: "landing.hero3You1" },
      { kind: "you", text: "landing.hero3You2" },
      { kind: "them", text: "landing.hero3Them2" },
      { kind: "typing" },
      { kind: "you", text: "landing.hero3You3" },
      { kind: "sale" },
    ],
  },
  {
    channel: "gmail",
    name: "Camilo R.",
    product: { emoji: "⌚", name: "landing.prodWatch", price: "$320.000" },
    order: "#1045",
    steps: [
      { kind: "them", text: "landing.hero4Them1" },
      { kind: "typing" },
      { kind: "you", text: "landing.hero4You1" },
      { kind: "you", text: "landing.hero4You2" },
      { kind: "them", text: "landing.hero4Them2" },
      { kind: "typing" },
      { kind: "you", text: "landing.hero4You3" },
      { kind: "sale" },
    ],
  },
];

function delayFor(step: Step): number {
  switch (step.kind) {
    case "typing":
      return 700;
    case "sale":
      return 1100;
    case "them":
      return 1500;
    default:
      return 1300;
  }
}

function HeroInbox() {
  const t = useT();
  const reduced = useReducedMotion();
  // One state object so switching channels resets the step count atomically
  // (no synchronous setN in the effect, no stale-slice flash).
  const [{ ci, n }, set] = useState({ ci: 0, n: 1 });
  const pausedRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Play the active channel's conversation; when idle, advance to the next
  // channel — but while the visitor hovers or has clicked a tab, stay put and
  // replay the channel they're looking at.
  useEffect(() => {
    if (reduced) {
      const raf = requestAnimationFrame(() =>
        set((s) => ({ ...s, n: HERO_CONVOS[s.ci].steps.length })),
      );
      return () => cancelAnimationFrame(raf);
    }
    let id: ReturnType<typeof setTimeout>;
    let cur = 1; // steps shown so far for this channel
    const loop = () => {
      const steps = HERO_CONVOS[ci].steps;
      if (cur >= steps.length) {
        // Whole conversation (incl. the confirmed sale) is on screen — hold it.
        id = setTimeout(() => {
          if (pausedRef.current) {
            cur = 1;
            set((s) => ({ ...s, n: 1 })); // replay the same channel
            loop();
          } else {
            set((s) => ({ ci: (s.ci + 1) % HERO_CONVOS.length, n: 1 }));
          }
        }, 2800);
      } else {
        const next = cur + 1;
        id = setTimeout(() => {
          cur = next;
          set((s) => ({ ...s, n: next }));
          loop();
        }, delayFor(steps[cur]));
      }
    };
    loop();
    return () => clearTimeout(id);
  }, [ci, reduced]);

  // Keep newest message in view.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [n, ci]);

  const select = (i: number) => {
    pausedRef.current = true;
    if (i !== ci) set({ ci: i, n: 1 });
  };

  const convo = HERO_CONVOS[ci];
  // A `typing` step is transient: hide it once a later step has appeared.
  const steps = convo.steps
    .slice(0, n)
    .filter((s, i) => !(s.kind === "typing" && i !== n - 1));

  return (
    <PreviewFrame>
      {/* clickable channel tabs — switch inbox with a click */}
      <div
        className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2.5"
        onMouseEnter={() => (pausedRef.current = true)}
        onMouseLeave={() => (pausedRef.current = false)}
      >
        {CHANNELS.map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => select(i)}
            className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors min-h-[40px] sm:py-1.5 sm:min-h-0 ${
              c.id === convo.channel
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <ChannelLogo channel={c.id} size={15} /> {t(c.label)}
          </button>
        ))}
      </div>

      {/* conversation header */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
        <ChannelLogo channel={convo.channel} size={20} />
        <div className="leading-tight">
          <div className="text-sm font-medium">{convo.name}</div>
          <div className="text-[11px] text-accent-ink">{t("landing.heroAgentStatus")}</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-[10px] font-medium text-accent-ink">
          <Sparkles className="size-3" /> {t("landing.agentActive")}
        </span>
      </div>

      <div
        ref={bodyRef}
        onMouseEnter={() => (pausedRef.current = true)}
        onMouseLeave={() => (pausedRef.current = false)}
        className="flex h-[300px] flex-col justify-end gap-2.5 overflow-hidden p-4 sm:h-[340px]"
      >
        {steps.map((s, i) =>
          s.kind === "sale" ? (
            <SaleCard key={i} product={convo.product} order={convo.order} />
          ) : (
            <Bubble key={i} step={s} />
          ),
        )}
      </div>
    </PreviewFrame>
  );
}

function Bubble({ step }: { step: Step }) {
  const t = useT();
  if (step.kind === "typing") {
    return (
      <div className="flex max-w-[80%] items-center gap-1 self-end rounded-2xl rounded-tr-sm bg-primary px-3.5 py-3 duration-300 animate-in fade-in slide-in-from-bottom-2">
        <span className="size-1.5 animate-bounce rounded-full bg-primary-foreground/70 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary-foreground/70 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary-foreground/70" />
      </div>
    );
  }

  // Sale steps are rendered by <SaleCard/>, never here.
  if (step.kind === "sale") return null;

  const mine = step.kind === "you";
  return (
    <div
      className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm duration-300 animate-in fade-in slide-in-from-bottom-2 ${
        mine
          ? "self-end rounded-tr-sm bg-primary text-primary-foreground"
          : "self-start rounded-tl-sm bg-muted text-foreground"
      }`}
    >
      {t(step.text)}
    </div>
  );
}

// Confirmed-sale card (closes every hero conversation). Carries the Shopify
// brand mark so the source of truth for the order is unmistakable.
function SaleCard({ product, order }: { product: Product; order: string }) {
  const t = useT();
  return (
    <div className="self-stretch rounded-2xl border border-primary/45 bg-primary/10 p-3.5 duration-500 animate-in fade-in zoom-in-95">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-4" />
        </span>
        <span className="text-sm font-semibold">{t("landing.saleConfirmed")}</span>
        <span className="ml-auto text-sm font-semibold text-accent-ink">{product.price}</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {product.emoji} {t(product.name)} · {t("landing.saleUnit")}
        </span>
        <span className="inline-flex items-center gap-1">
          <ShopifyLogo size={15} /> {t("landing.saleOrder", { order })}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 01 · Bandeja unificada — cycling multi-channel inbox
// ─────────────────────────────────────────────────────────────────────────

function InboxPreview() {
  const t = useT();
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  const paused = useRef(false);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      if (paused.current) return;
      setActive((i) => (i + 1) % INBOX.length);
    }, 2600);
    return () => clearInterval(id);
  }, [reduced]);

  const item = INBOX[active];

  return (
    <PreviewFrame>
      <div
        onMouseEnter={() => (paused.current = true)}
        onMouseLeave={() => (paused.current = false)}
      >
        {/* channel switcher (incl. comments) */}
        <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2.5">
          {INBOX.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setActive(i)}
              className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors sm:min-h-0 sm:py-1.5 ${
                active === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <ChannelLogo channel={c.id} size={15} /> {t(c.label)}
            </button>
          ))}
        </div>

        {/* conversation */}
        <div key={active} className="flex min-h-[210px] flex-col gap-3 p-5 duration-300 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ChannelLogo channel={item.id} size={18} /> {t(item.name)}
          </div>
          <div className="max-w-[78%] self-start rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 text-sm">{t(item.them)}</div>
          <div className="max-w-[78%] self-end rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
            {t(item.you)}
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
            <Sparkles className="size-3 text-accent-ink" /> {t(item.note)}
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 01 · Agente de ventas — four knowledge sources on the left join the agent
// on the right through animated flowing lines. The agent reads "Entrenándose".
// ─────────────────────────────────────────────────────────────────────────

// `label` holds an i18n key resolved with t() at the render site.
const AGENT_SOURCES: { icon: typeof Inbox; label: string; y: number }[] = [
  { icon: Boxes, label: "landing.agentSourceCatalog", y: 15 },
  { icon: Tag, label: "landing.agentSourcePrices", y: 38 },
  { icon: Truck, label: "landing.agentSourceShipping", y: 62 },
  { icon: Star, label: "landing.agentSourceReviews", y: 85 },
];

function AgentPanel() {
  const t = useT();
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setLit((i) => (i + 1) % (AGENT_SOURCES.length + 1)), 1000);
    return () => clearInterval(id);
  }, [reduced]);

  const integrated = (i: number) => reduced || lit > i;
  const ready = reduced || lit >= AGENT_SOURCES.length;

  return (
    <PreviewFrame>
      <div className="relative h-[360px] sm:h-[420px] lg:h-[440px]">
        {/* animated black lines flowing from the sources into the agent */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full">
          {AGENT_SOURCES.map((s, i) => {
            const on = lit === i || integrated(i);
            return (
              <line
                key={s.label}
                x1="28"
                y1={s.y}
                x2="66"
                y2="50"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeWidth={on ? 2.4 : 1.4}
                strokeDasharray="3 5"
                className={`transition-colors duration-500 ${on ? "stroke-foreground" : "stroke-foreground/20"}`}
              >
                {!reduced && (
                  <animate
                    attributeName="stroke-dashoffset"
                    from="0"
                    to="-16"
                    dur="0.8s"
                    repeatCount="indefinite"
                  />
                )}
              </line>
            );
          })}
        </svg>

        {/* knowledge sources — left column */}
        {AGENT_SOURCES.map((s, i) => (
          <div
            key={s.label}
            style={{ top: `${s.y}%` }}
            className={`absolute left-4 inline-flex max-w-[42%] -translate-y-1/2 items-center gap-2 truncate rounded-xl border bg-card px-2 py-1.5 text-xs font-medium shadow-sm transition-all duration-300 sm:max-w-none sm:px-3 sm:py-2.5 sm:text-sm ${
              lit === i
                ? "scale-105 border-primary/60 bg-primary/10 text-accent-ink"
                : integrated(i)
                  ? "border-primary/30 text-foreground"
                  : "border-border text-muted-foreground"
            }`}
          >
            <s.icon className="size-4" />
            {t(s.label)}
          </div>
        ))}

        {/* agent — right side */}
        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2.5 rounded-2xl border border-primary/40 bg-primary/5 px-3 py-3 backdrop-blur-sm sm:px-5 sm:py-5">
          <span className="relative flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 sm:size-16">
            {!reduced && <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />}
            <Sparkles className="relative size-5 sm:size-7" />
          </span>
          <span className="text-[13px] font-semibold text-accent-ink">
            {ready ? t("landing.agentReady") : t("landing.agentTraining")}
          </span>
          <span className="flex gap-1.5">
            {AGENT_SOURCES.map((s, i) => (
              <span
                key={s.label}
                className={`size-1.5 rounded-full transition-colors ${integrated(i) ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </span>
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 02 · Carritos abandonados — minimal recovery: abandoned → AI → recovered.
// Autoplays on its own; no secondary copy, just the essential story.
// ─────────────────────────────────────────────────────────────────────────

const CART_ICONS: (typeof Inbox)[] = [ShoppingCart, Sparkles, Check];

function CartRecoveryPanel() {
  const t = useT();
  const reduced = useReducedMotion();
  // phases: 0 abandoned · 1 agent reaches out · 2 recovered · 3 hold → loop.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % 4), 1500);
    return () => clearInterval(id);
  }, [reduced]);

  const recovered = reduced || phase >= 2;
  const amount = useCountUp(210000, recovered, 900);

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-5 p-5">
        {/* customer + status */}
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 text-[12px] font-semibold text-accent-ink">
            ML
          </span>
          <span className="text-sm font-medium">{t("landing.cartCustomer")}</span>
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              recovered
                ? "bg-primary/15 text-accent-ink"
                : "border border-amber-500/40 text-amber-600 dark:text-amber-400"
            }`}
          >
            <span className={`size-1.5 rounded-full ${recovered ? "bg-primary" : "animate-pulse bg-amber-500"}`} />
            {recovered ? t("landing.cartStatusRecovered") : t("landing.cartStatusAbandoned")}
          </span>
        </div>

        {/* product */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/30 via-primary/10 to-transparent text-lg">
            🎧
          </div>
          <span className="flex-1 truncate text-sm font-medium">{t("landing.cartProduct")}</span>
          <span className="text-sm font-semibold">$210.000</span>
        </div>

        {/* recovery progress — icons only */}
        <div className="flex items-center px-1">
          {CART_ICONS.map((Icon, i) => {
            const reached = reduced || phase >= i;
            const active = !reduced && phase === i;
            return (
              <div key={i} className="flex flex-1 items-center last:flex-none">
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full transition-all ${
                    reached ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  } ${active ? "ring-4 ring-primary/20" : ""}`}
                >
                  <Icon className="size-4" />
                </span>
                {i < CART_ICONS.length - 1 && (
                  <span className={`h-0.5 flex-1 rounded-full transition-colors ${phase > i ? "bg-primary" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* result — recovered amount + Shopify */}
        <div
          className={`flex items-center gap-3 rounded-xl border p-3 transition-all duration-500 ${
            recovered ? "border-primary/45 bg-primary/10 opacity-100" : "border-dashed border-border opacity-40"
          }`}
        >
          <span className="relative flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
            {recovered && <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />}
            <Check className="relative size-5" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{t("landing.cartSaleRecovered")}</div>
            <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShopifyLogo size={17} /> Shopify
            </div>
          </div>
          <span className="ml-auto text-base font-semibold tracking-[-0.02em] text-accent-ink">
            ${Math.round(amount).toLocaleString("es-CO")}
          </span>
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 04 · Comentarios — post + comments, each answered instantly by the AI
// ─────────────────────────────────────────────────────────────────────────

// `user` holds handles (left as-is); `text` holds i18n keys resolved at render.
const COMMENTS: { user: string; text: string }[] = [
  { user: "ana_p", text: "landing.comment1" },
  { user: "luis.gs", text: "landing.comment2" },
  { user: "cami.rr", text: "landing.comment3" },
];

function CommentsPreview() {
  const t = useT();
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setLit((i) => (i + 1) % COMMENTS.length), 1500);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-3 p-5">
        {/* post header */}
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-primary/10 text-sm">
            🛍️
          </span>
          <div className="leading-tight">
            <div className="text-sm font-medium">{t("landing.commentsBrand")}</div>
            <div className="text-[11px] text-muted-foreground">{t("landing.commentsAd")}</div>
          </div>
          <ChannelLogo channel="instagram" size={18} className="ml-auto" />
        </div>

        {/* post media */}
        <div className="relative h-20 overflow-hidden rounded-xl bg-gradient-to-br from-primary/25 via-primary/10 to-transparent">
          <span className="absolute inset-0 grid place-items-center text-3xl">👟</span>
          <div className="absolute bottom-2 left-2 inline-flex items-center gap-3 text-[11px] text-foreground/70">
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3" /> 1.2k
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" /> 48
            </span>
          </div>
        </div>

        {/* comments answered by the AI */}
        <div className="flex flex-col gap-2">
          {COMMENTS.map((c, i) => (
            <div
              key={c.user}
              className={`rounded-xl border p-2.5 transition-all duration-300 ${
                i === lit ? "border-primary/40 bg-primary/5" : "border-border bg-background/60"
              }`}
            >
              <div className="flex items-baseline gap-2 text-xs">
                <span className="font-semibold">{c.user}</span>
                <span className="text-muted-foreground">{t(c.text)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 pl-2 text-[11px] text-accent-ink">
                <CornerDownRight className="size-3" />
                <Sparkles className="size-3" /> {t("landing.commentRepliedDm")}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 04 · Soporte 24/7 — a live feed of proactive updates the agent pushes to
// the customer (order confirmed, tracking, questions). Distinct from the
// other previews: notifications stack in from the top, one after another.
// ─────────────────────────────────────────────────────────────────────────

// `title` and `meta` hold i18n keys (or literal IDs/tracking codes) resolved
// with t() at the render site — t() returns the literal unchanged for IDs.
const SUPPORT_EVENTS: { icon: typeof Inbox; title: string; meta: string }[] = [
  { icon: Check, title: "landing.supportOrderConfirmed", meta: "#1042" },
  { icon: Truck, title: "landing.supportOnTheWay", meta: "9400 1234" },
  { icon: MessageSquare, title: "landing.supportQuestionResolved", meta: "landing.supportNow" },
];

function SupportPreview() {
  const t = useT();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(1);
  useEffect(() => {
    if (reduced) {
      const raf = requestAnimationFrame(() => setShown(SUPPORT_EVENTS.length));
      return () => cancelAnimationFrame(raf);
    }
    const id = setInterval(
      () => setShown((s) => (s >= SUPPORT_EVENTS.length ? 1 : s + 1)),
      1400,
    );
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-accent-ink">
            <Headset className="size-4" />
          </span>
          <span className="text-sm font-semibold">{t("landing.support247")}</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-accent-ink">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" /> {t("landing.supportOnline")}
          </span>
        </div>

        {/* Every notification keeps its slot from the start (the container never
            changes height); they just fade in one after another, so the page
            below never shifts while scrolling. */}
        <div className="flex flex-col gap-2.5">
          {SUPPORT_EVENTS.map((e, i) => {
            const visible = reduced || i < shown;
            const newest = !reduced && i === shown - 1;
            return (
              <div
                key={e.title}
                className={`flex items-center gap-3 rounded-xl border p-3 transition-all duration-300 ${
                  newest ? "border-primary/45 bg-primary/5" : "border-border bg-background/60"
                } ${visible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"}`}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <e.icon className="size-4" />
                </span>
                <span className="text-sm font-medium">{t(e.title)}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{t(e.meta)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 09 · Configuración — 3-click setup wizard (non-chat)
// ─────────────────────────────────────────────────────────────────────────

function SetupToggle({ on }: { on: boolean }) {
  return (
    <span
      className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
        on ? "justify-end bg-primary" : "justify-start bg-muted"
      }`}
    >
      <span className="size-4 rounded-full bg-card shadow-sm" />
    </span>
  );
}

function SetupPreview() {
  const t = useT();
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0); // 0..3 (3 = all done) → loop
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setStep((s) => (s + 1) % 4), 1100);
    return () => clearInterval(id);
  }, [reduced]);

  const done = (i: number) => reduced || step > i;
  const pct = reduced ? 100 : Math.round((Math.min(step, 3) / 3) * 100);

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-accent-ink">
            <MousePointerClick className="size-4" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{t("landing.setupTitle")}</div>
            <div className="text-[11px] text-muted-foreground">{t("landing.setupSteps")}</div>
          </div>
          <span className="ml-auto text-xs font-semibold text-accent-ink">{pct}%</span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* step 1 — connect channels */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
          <span className="flex items-center -space-x-1.5">
            <ChannelLogo channel="whatsapp" size={18} />
            <ChannelLogo channel="instagram" size={18} />
            <ChannelLogo channel="messenger" size={18} />
          </span>
          <span className="text-sm font-medium">{t("landing.setupConnectChannels")}</span>
          <span className="ml-auto">
            <SetupToggle on={done(0)} />
          </span>
        </div>

        {/* step 2 — connect store */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
          <ShopifyLogo size={20} />
          <span className="text-sm font-medium">{t("landing.setupConnectStore")}</span>
          <span className="ml-auto">
            <SetupToggle on={done(1)} />
          </span>
        </div>

        {/* step 3 — activate */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-accent-ink">
            <Sparkles className="size-4" />
          </span>
          <span className="text-sm font-medium">{t("landing.setupActivateAgent")}</span>
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              done(2) ? "bg-primary/15 text-accent-ink" : "bg-primary text-primary-foreground"
            }`}
          >
            {done(2) ? (
              <>
                <Check className="size-3" /> {t("landing.setupActive")}
              </>
            ) : (
              t("landing.setupActivate")
            )}
          </span>
        </div>

        <div className="text-center text-[11px] text-muted-foreground">
          {t("landing.setupNoCode")}
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 03 · Automatizaciones — a flow with a pulsing active node
// ─────────────────────────────────────────────────────────────────────────

// `sub` holds an i18n key resolved with t() at the render site.
const FLOW: { icon: typeof Inbox; sub: string }[] = [
  { icon: ShoppingBag, sub: "landing.flowBought" },
  { icon: Clock, sub: "landing.flowWait" },
  { icon: Send, sub: "landing.flowSend" },
];

function FlowPreview() {
  const t = useT();
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => setStep((s) => (s + 1) % (FLOW.length + 1)), 1100);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-0 p-5">
        {FLOW.map((node, i) => {
          const done = reduced || step > i;
          const active = !reduced && step === i;
          return (
            <div key={node.sub}>
              <div
                className={`flex items-center gap-3 rounded-xl border p-3 transition-all duration-300 ${
                  active
                    ? "border-primary/50 bg-primary/10"
                    : done
                      ? "border-border bg-background/60"
                      : "border-border bg-card"
                }`}
              >
                <span
                  className={`flex size-9 items-center justify-center rounded-lg transition-colors ${
                    active || done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="size-4" /> : <node.icon className="size-4" />}
                </span>
                <div className="text-sm font-medium">{t(node.sub)}</div>
                {active && (
                  <span className="ml-auto size-2 animate-pulse rounded-full bg-primary" />
                )}
              </div>
              {i < FLOW.length - 1 && (
                <div className="ml-[34px] h-5 w-px bg-border" />
              )}
            </div>
          );
        })}
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 04 · Campañas — broadcast with live-ticking delivery stats
// ─────────────────────────────────────────────────────────────────────────

function CampaignPreview() {
  const t = useT();
  const reduced = useReducedMotion();
  // FeatureSection remounts this preview when it enters view, so a single
  // start-on-mount is enough — the counters replay every time it appears.
  const [run, setRun] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setRun(true), 60);
    return () => clearTimeout(id);
  }, []);

  const sent = useCountUp(1240, run);
  const delivered = useCountUp(1198, run);
  const read = useCountUp(932, run);
  const replied = useCountUp(214, run);
  const pct = reduced ? 96 : Math.min(96, Math.round((delivered / 1240) * 100));

  const fmt = (v: number) => Math.round(v).toLocaleString("es-CO");

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-accent-ink">
            <Megaphone className="size-4" />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{t("landing.campaignTitle")}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ChannelLogo channel="whatsapp" size={12} />
              <ChannelLogo channel="instagram" size={12} />
              {t("landing.campaignChannels")}
            </div>
          </div>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-[10px] font-medium text-accent-ink">
            {t("landing.campaignSent")}
          </span>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: "landing.campaignStatSent", value: fmt(sent), icon: Send },
            { label: "landing.campaignStatDelivered", value: fmt(delivered), icon: Check },
            { label: "landing.campaignStatRead", value: fmt(read), icon: CheckCheck },
            { label: "landing.campaignStatReplied", value: fmt(replied), icon: MessageSquare },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-border bg-background/60 p-3">
              <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <m.icon className="size-3" /> {t(m.label)}
              </div>
              <div className="mt-1 text-lg font-semibold tracking-[-0.02em]">{m.value}</div>
            </div>
          ))}
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 05 · Productos — Shopify-synced product card the AI sells from
// ─────────────────────────────────────────────────────────────────────────

function ProductPreview() {
  const t = useT();
  return (
    <PreviewFrame>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex gap-3.5">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary/30 via-primary/10 to-transparent">
            <span className="absolute inset-0 grid place-items-center text-2xl">👟</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">{t("landing.productName")}</div>
                <div className="text-[11px] text-muted-foreground">{t("landing.productCategory")}</div>
              </div>
              <div className="text-sm font-semibold text-accent-ink">$239.000</div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-accent-ink">
                <Check className="size-3" /> {t("landing.productInStock")}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                {t("landing.productDiscount")}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-3 py-2.5">
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <ShopifyLogo size={18} />
            <span className="font-medium text-foreground">{t("landing.productSynced")}</span>
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-accent-ink">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" /> {t("landing.productUpToDate")}
          </span>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-xs text-foreground duration-500 animate-in fade-in">
          <ShoppingBag className="size-3.5 text-accent-ink" />
          {t("landing.productOrderLead")} <strong>#1042</strong> {t("landing.productOrderCreated")}
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 09 · Resultados — ROAS-first dashboard with attributed-revenue bars
// ─────────────────────────────────────────────────────────────────────────

const BARS = [38, 52, 44, 70, 60, 84, 96];

function MetricsPreview() {
  const t = useT();
  // setTimeout (not a one-shot rAF, which can be dropped off-screen) so the
  // counters reliably start. FeatureSection remounts the preview on view, so
  // they replay from zero every time the section appears.
  const [run, setRun] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setRun(true), 60);
    return () => clearTimeout(id);
  }, []);

  const roas = useCountUp(4.2, run, 1100);
  const ingresos = useCountUp(1.84, run);
  const recup = useCountUp(420, run);

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-4 p-5">
        {/* ROAS hero */}
        <div className="flex items-center gap-4 rounded-xl border border-primary/40 bg-primary/10 p-4">
          <div className="leading-none">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">ROAS</div>
            <div className="mt-1.5 text-[34px] font-semibold leading-none tracking-[-0.03em] text-accent-ink">
              {roas.toFixed(1)}x
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="inline-flex items-center gap-1 text-sm font-semibold text-accent-ink">
              <TrendingUp className="size-4" /> +32%
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{t("landing.metricsPerDollar")}</div>
          </div>
        </div>

        {/* supporting stats */}
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { label: "landing.metricsRevenue", value: `$${ingresos.toFixed(2)}M` },
            { label: "landing.metricsRecovered", value: `$${Math.round(recup)}K` },
            { label: "landing.metricsResponse", value: "4s" },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-border bg-background/60 p-3">
              <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{t(m.label)}</div>
              <div className="mt-1 text-lg font-semibold tracking-[-0.02em]">{m.value}</div>
            </div>
          ))}
        </div>

        {/* revenue attributed to the agent */}
        <div className="rounded-xl border border-border bg-background/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium">{t("landing.metricsAgentRevenue7d")}</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-accent-ink">
              <TrendingUp className="size-3" /> +32%
            </span>
          </div>
          <div className="flex h-20 items-end gap-2">
            {BARS.map((h, i) => (
              <div key={i} className="flex h-full flex-1 flex-col justify-end">
                <div
                  className="w-full rounded-t-md bg-primary transition-[height] duration-700 ease-out"
                  style={{ height: run ? `${h}%` : "0%", transitionDelay: `${i * 70}ms` }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}
