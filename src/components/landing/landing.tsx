"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";

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
const EYEBROW =
  "text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";
const SECTION = "py-[clamp(64px,8vw,128px)]";

type Ch = "whatsapp" | "instagram" | "messenger" | "gmail";

const CHANNELS: { id: Ch; label: string }[] = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "messenger", label: "Messenger" },
  { id: "gmail", label: "Correo" },
];

const THREADS: Record<Ch, { name: string; them: string; you: string }> = {
  whatsapp: { name: "Laura M.", them: "¿Hacen envíos a Cali?", you: "Sí, llega en 2 días 📦" },
  instagram: { name: "andres.q", them: "Me encantó el serum 💛", you: "¡Gracias! Te paso el link 👇" },
  messenger: { name: "Sofía R.", them: "¿Sigue disponible?", you: "Sí, quedan pocas 🙌" },
  gmail: { name: "Pedido #1042", them: "¿Estado de mi pedido?", you: "Va en camino, llega mañana ✉️" },
};

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

/** Reveal children on scroll-into-view — the riverzai `lv4-reveal` feel. */
function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`${className ?? ""} transition-all duration-700 ease-out ${
        shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

/** Count up to `target` once `run` flips true. */
function useCountUp(target: number, run: boolean, duration = 1100) {
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
  }, [target, run, duration]);
  return v;
}

// ─────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────

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
    title: "Un vendedor con IA",
    titleMuted: "que conoce tus productos.",
    body: "Aprende tu catálogo, tus precios y tus envíos, y responde como tu mejor vendedor: recomienda, resuelve objeciones y cierra la compra. De día y de noche.",
    Preview: BrainPreview,
  },
  {
    n: "02",
    eyebrow: "Carritos abandonados",
    icon: ShoppingCart,
    title: "Recupera cada",
    titleMuted: "carrito abandonado.",
    body: "Cuando alguien deja la compra a medias, el agente le escribe solo, resuelve la duda y recupera la venta antes de que se enfríe.",
    Preview: CartRecoveryChat,
  },
  {
    n: "03",
    eyebrow: "Recompras",
    icon: RotateCcw,
    title: "Haz que vuelvan",
    titleMuted: "a comprar, solos.",
    body: "Seguimiento post-venta, recordatorios de recompra y reactivación de clientes dormidos. Defines el flujo una vez y corre solo.",
    Preview: FlowPreview,
  },
  {
    n: "04",
    eyebrow: "Campañas",
    icon: Megaphone,
    title: "Campañas masivas en",
    titleMuted: "WhatsApp e Instagram.",
    body: "Lanza ofertas y lanzamientos a miles de contactos por WhatsApp e Instagram, y mira en vivo quién recibió, leyó, respondió y compró.",
    Preview: CampaignPreview,
  },
  {
    n: "05",
    eyebrow: "Bandeja",
    icon: Inbox,
    title: "Y todo, en una",
    titleMuted: "sola bandeja.",
    body: "WhatsApp, Instagram, Messenger y correo en una pantalla. Tu equipo y el agente trabajan juntos, sin perder un solo mensaje.",
    Preview: InboxPreview,
  },
  {
    n: "06",
    eyebrow: "Productos",
    icon: Package,
    title: "Conecta Shopify",
    titleMuted: "y vende con datos reales.",
    body: "Inventario, precios y pedidos sincronizados. El agente recomienda, arma el pedido y cobra con información al día.",
    Preview: ProductPreview,
  },
  {
    n: "07",
    eyebrow: "Métricas",
    icon: BarChart3,
    title: "Cuánto vendes y",
    titleMuted: "cuánto recuperas, en vivo.",
    body: "Ventas, carritos recuperados, conversión y tiempos de respuesta. Sabes con exactitud cuánto dinero te está generando tu agente.",
    Preview: MetricsPreview,
  },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/50 bg-background/75 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <span className="text-[19px] font-semibold lowercase tracking-[0.04em] text-accent-ink">riverz</span>
          <div className="hidden items-center gap-7 text-sm text-muted-foreground sm:flex">
            <a href="#funciones" className="transition-colors hover:text-foreground">Funciones</a>
            <Link href="/ingresar" className="transition-colors hover:text-foreground">Iniciar sesión</Link>
          </div>
          <Link
            href="/registro"
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03]"
          >
            Empezar gratis
          </Link>
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
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1.5 text-[12px] font-medium text-accent-ink duration-700 animate-in fade-in slide-in-from-bottom-3">
                <Sparkles className="size-3.5" /> Agente de ventas con IA
              </div>
              <h1 className={`max-w-[16ch] animate-in fade-in slide-in-from-bottom-3 text-balance duration-700 ${DISPLAY}`}>
                Vende mientras{" "}
                <span className="text-muted-foreground">la IA responde.</span>
              </h1>
              <p className="mt-6 max-w-[34ch] animate-in fade-in slide-in-from-bottom-3 text-[clamp(16px,1.6vw,20px)] leading-relaxed tracking-[-0.01em] text-muted-foreground duration-700 sm:max-w-[48ch]">
                No es una bandeja más: es un agente que atiende, recomienda, recupera carritos abandonados y reactiva clientes para que vuelvan a comprar. Cierra ventas en WhatsApp e Instagram, las 24 horas.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  href="/registro"
                  className="group inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03]"
                >
                  Empezar gratis
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/ingresar"
                  className="rounded-full border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
                >
                  Iniciar sesión
                </Link>
              </div>
            </div>

            <div className="animate-in fade-in duration-1000 sm:mx-auto sm:max-w-sm lg:mx-0 lg:max-w-none">
              <SaleChat />
            </div>
          </div>
        </div>
      </section>

      {/* Channels */}
      <section className="border-y border-border/50 bg-muted/20">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-5 py-7">
          {CHANNELS.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <ChannelLogo channel={c.id} size={22} /> {c.label}
            </span>
          ))}
          <span className="text-sm font-medium text-muted-foreground">Shopify</span>
        </div>
      </section>

      {/* Feature sections — one per former card, alternating */}
      <div id="funciones" className="divide-y divide-border/40">
        {SECTIONS.map((s, i) => (
          <FeatureSection key={s.n} s={s} flip={i % 2 === 1} />
        ))}
      </div>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 py-20">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card px-8 py-16 text-center">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-32 mx-auto h-72 w-[600px] rounded-full bg-primary/15 blur-[100px]" />
          <h2 className={`relative mx-auto max-w-2xl ${H2}`}>
            La herramienta definitiva para vender por chat.
          </h2>
          <p className={`relative mx-auto mt-4 max-w-md ${BODY}`}>
            Conecta WhatsApp e Instagram y deja que tu agente atienda, recupere carritos y cierre ventas — desde hoy.
          </p>
          <Link
            href="/registro"
            className="group relative mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-transform hover:scale-[1.03]"
          >
            Empezar gratis
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
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
            <a href="#funciones" className="hover:text-foreground">Funciones</a>
            <Link href="/ingresar" className="hover:text-foreground">Iniciar sesión</Link>
            <Link href="/terminos" className="hover:text-foreground">Términos</Link>
            <Link href="/privacidad" className="hover:text-foreground">Privacidad</Link>
            <Link href="/eliminar-datos" className="hover:text-foreground">Eliminar datos</Link>
          </div>
        </div>
        <div className="border-t border-border/40 py-4 text-center text-[11px] text-muted-foreground">
          © 2026 riverz
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
  return (
    <section className={SECTION}>
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid items-center gap-10 md:grid-cols-2 md:gap-14 lg:gap-20">
          <Reveal className={flip ? "md:order-2" : undefined}>
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-accent-ink">
                <s.icon className="size-5" />
              </span>
              <span className={EYEBROW}>
                {s.n} · {s.eyebrow}
              </span>
            </div>
            <h2 className={`mt-5 ${H2}`}>
              {s.title}{" "}
              <span className="text-muted-foreground">{s.titleMuted}</span>
            </h2>
            <p className={`mt-5 max-w-[460px] ${BODY}`}>{s.body}</p>
          </Reveal>
          <Reveal className={flip ? "md:order-1" : undefined} delay={80}>
            <s.Preview />
          </Reveal>
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
      className={`mx-auto w-full max-w-[440px] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/20 ${className ?? ""}`}
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

// ─────────────────────────────────────────────────────────────────────────
// HERO + AI: the sale animation (AI attends customer → sale closes), looping.
// Mobile-first: the frame is fluid (max-w-440) and the chat body uses
// justify-end so older bubbles roll up out of view as new ones arrive.
// ─────────────────────────────────────────────────────────────────────────

type Step =
  | { kind: "them"; text: string }
  | { kind: "you"; text: string }
  | { kind: "typing" }
  | { kind: "note"; text: string }
  | { kind: "sale"; label?: string; recovered?: boolean };

// Inbound: customer asks, the agent attends and closes the sale.
const HERO_SCRIPT: Step[] = [
  { kind: "them", text: "Hola 👋 ¿el Serum Pilar sigue disponible?" },
  { kind: "typing" },
  { kind: "you", text: "¡Hola Laura! Sí 🙌 nos quedan 8 unidades." },
  { kind: "you", text: "Hoy tiene 15% off y envío gratis a Cali. ¿Te lo aparto?" },
  { kind: "them", text: "Uy sí, lo quiero 💛" },
  { kind: "typing" },
  { kind: "you", text: "Listo, te dejo el pago seguro aquí 👇" },
  { kind: "sale" },
];

// Outbound: an abandoned cart triggers the agent to reach out and recover it.
const CART_SCRIPT: Step[] = [
  { kind: "note", text: "🛒 Carrito abandonado · Serum Pilar" },
  { kind: "typing" },
  { kind: "you", text: "Hola Andrés 👋 vi que dejaste el Serum Pilar en tu carrito." },
  { kind: "you", text: "Te guardo el 15% off y envío gratis. ¿Lo terminamos? 💛" },
  { kind: "them", text: "Uy sí, se me fue 🙈 dale" },
  { kind: "typing" },
  { kind: "you", text: "Listo, aquí tu pago seguro 👇" },
  { kind: "sale", label: "Venta recuperada", recovered: true },
];

function delayFor(step: Step): number {
  switch (step.kind) {
    case "typing":
      return 700;
    case "sale":
      return 1200;
    case "note":
      return 1100;
    case "them":
      return 1500;
    default:
      return 1300;
  }
}

function ChatPlayer({
  script,
  name,
  status,
  channel,
}: {
  script: Step[];
  name: string;
  status: string;
  channel: Ch;
}) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(1);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced) {
      const raf = requestAnimationFrame(() => setN(script.length));
      return () => cancelAnimationFrame(raf);
    }
    let id: ReturnType<typeof setTimeout>;
    let cur = 1;
    const loop = () => {
      let delay: number;
      let next: number;
      if (cur >= script.length) {
        next = 1; // restart the loop
        delay = 800;
      } else {
        next = cur + 1;
        delay = delayFor(script[cur]); // delay before revealing the next step
      }
      id = setTimeout(() => {
        cur = next;
        setN(next);
        loop();
      }, delay);
    };
    loop();
    return () => clearTimeout(id);
  }, [reduced, script]);

  // Keep newest message in view.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [n]);

  // A `typing` step is transient: hide it once a later step has appeared.
  const steps = script
    .slice(0, n)
    .filter((s, i) => !(s.kind === "typing" && i !== n - 1));

  return (
    <PreviewFrame>
      {/* conversation header */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
        <ChannelLogo channel={channel} size={20} />
        <div className="leading-tight">
          <div className="text-sm font-medium">{name}</div>
          <div className="text-[11px] text-accent-ink">{status}</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-[10px] font-medium text-accent-ink">
          <Sparkles className="size-3" /> Agente activo
        </span>
      </div>

      <div
        ref={bodyRef}
        className="flex h-[300px] flex-col justify-end gap-2.5 overflow-hidden p-4 sm:h-[340px]"
      >
        {steps.map((s, i) => (
          <Bubble key={i} step={s} />
        ))}
      </div>
    </PreviewFrame>
  );
}

function SaleChat() {
  return (
    <ChatPlayer
      script={HERO_SCRIPT}
      name="Laura M."
      status="en línea · atiende la IA"
      channel="whatsapp"
    />
  );
}

function CartRecoveryChat() {
  return (
    <ChatPlayer
      script={CART_SCRIPT}
      name="Andrés Q."
      status="recuperando carrito"
      channel="whatsapp"
    />
  );
}

function Bubble({ step }: { step: Step }) {
  if (step.kind === "typing") {
    return (
      <div className="flex max-w-[80%] items-center gap-1 self-end rounded-2xl rounded-tr-sm bg-primary px-3.5 py-3 duration-300 animate-in fade-in slide-in-from-bottom-2">
        <span className="size-1.5 animate-bounce rounded-full bg-primary-foreground/70 [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary-foreground/70 [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary-foreground/70" />
      </div>
    );
  }

  if (step.kind === "note") {
    return (
      <div className="mx-auto rounded-full border border-border bg-background/70 px-3 py-1 text-[11px] text-muted-foreground duration-300 animate-in fade-in">
        {step.text}
      </div>
    );
  }

  if (step.kind === "sale") {
    return (
      <div className="self-stretch rounded-2xl border border-primary/45 bg-primary/10 p-3.5 duration-500 animate-in fade-in zoom-in-95">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
            {step.recovered ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
          </span>
          <span className="text-sm font-semibold">{step.label ?? "Venta confirmada"}</span>
          <span className="ml-auto text-sm font-semibold text-accent-ink">$89.000</span>
        </div>
        <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
          <span>Serum Pilar · 1 ud.</span>
          <span className="inline-flex items-center gap-1">
            <ShoppingBag className="size-3" /> Pedido #1042 · Shopify
          </span>
        </div>
      </div>
    );
  }

  const mine = step.kind === "you";
  return (
    <div
      className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm duration-300 animate-in fade-in slide-in-from-bottom-2 ${
        mine
          ? "self-end rounded-tr-sm bg-primary text-primary-foreground"
          : "self-start rounded-tl-sm bg-muted text-foreground"
      }`}
    >
      {step.text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 01 · Bandeja unificada — cycling multi-channel inbox
// ─────────────────────────────────────────────────────────────────────────

function InboxPreview() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState<Ch>("whatsapp");
  const paused = useRef(false);

  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => {
      if (paused.current) return;
      setActive((cur) => {
        const i = CHANNELS.findIndex((c) => c.id === cur);
        return CHANNELS[(i + 1) % CHANNELS.length].id;
      });
    }, 3000);
    return () => clearInterval(t);
  }, [reduced]);

  const thread = THREADS[active];

  return (
    <PreviewFrame>
      <div
        onMouseEnter={() => (paused.current = true)}
        onMouseLeave={() => (paused.current = false)}
      >
        {/* channel switcher */}
        <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2.5">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => setActive(c.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active === c.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <ChannelLogo channel={c.id} size={15} /> {c.label}
            </button>
          ))}
        </div>

        {/* conversation */}
        <div key={active} className="flex min-h-[210px] flex-col gap-3 p-5 duration-300 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ChannelLogo channel={active} size={18} /> {thread.name}
          </div>
          <div className="max-w-[78%] self-start rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 text-sm">{thread.them}</div>
          <div className="max-w-[78%] self-end rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
            {thread.you}
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
            <Sparkles className="size-3 text-accent-ink" /> Respondido por la IA en 4s
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 02 · Asistente de IA — grounds a reply in the product knowledge base
// ─────────────────────────────────────────────────────────────────────────

const KNOWLEDGE = ["Catálogo", "Stock", "Precios", "Envíos", "Reseñas"];

function BrainPreview() {
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setLit((i) => (i + 1) % KNOWLEDGE.length), 850);
    return () => clearInterval(t);
  }, [reduced]);

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-3 p-5">
        <div className="max-w-[80%] self-start rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 text-sm">
          ¿Cuál me recomiendas para piel grasa?
        </div>

        <div className="rounded-xl border border-border bg-background/60 p-3">
          <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-accent-ink">
            <Sparkles className="size-3" /> Consultando tu conocimiento
          </div>
          <div className="flex flex-wrap gap-1.5">
            {KNOWLEDGE.map((k, i) => (
              <span
                key={k}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-all duration-300 ${
                  i === lit
                    ? "border-primary/50 bg-primary/15 text-accent-ink"
                    : "border-border text-muted-foreground"
                }`}
              >
                {k}
              </span>
            ))}
          </div>
        </div>

        <div className="max-w-[88%] self-end rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
          Para piel grasa te recomiendo el <strong>Serum Pilar</strong>: control de grasa sin resecar. Quedan 8 y hoy tiene 15% off 💛
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 03 · Automatizaciones — a flow with a pulsing active node
// ─────────────────────────────────────────────────────────────────────────

const FLOW: { icon: typeof Inbox; label: string; sub: string }[] = [
  { icon: ShoppingBag, label: "Disparador", sub: "Compró hace 30 días" },
  { icon: Clock, label: "Espera", sub: "Momento ideal de recompra" },
  { icon: Send, label: "Acción", sub: "Oferta de recompra personalizada" },
];

function FlowPreview() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setStep((s) => (s + 1) % (FLOW.length + 1)), 1100);
    return () => clearInterval(t);
  }, [reduced]);

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-0 p-5">
        {FLOW.map((node, i) => {
          const done = reduced || step > i;
          const active = !reduced && step === i;
          return (
            <div key={node.label}>
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
                <div className="leading-tight">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{node.label}</div>
                  <div className="text-sm font-medium">{node.sub}</div>
                </div>
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
  const reduced = useReducedMotion();
  const [run, setRun] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setRun(true));
    return () => cancelAnimationFrame(id);
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
            <div className="text-sm font-semibold">Lanzamiento Serum 💛</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ChannelLogo channel="whatsapp" size={12} />
              <ChannelLogo channel="instagram" size={12} />
              WhatsApp e Instagram
            </div>
          </div>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-[10px] font-medium text-accent-ink">
            Enviada
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
            { label: "Enviados", value: fmt(sent), icon: Send },
            { label: "Entregados", value: fmt(delivered), icon: Check },
            { label: "Leídos", value: fmt(read), icon: CheckCheck },
            { label: "Respondieron", value: fmt(replied), icon: MessageSquare },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-border bg-background/60 p-3">
              <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <m.icon className="size-3" /> {m.label}
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
  return (
    <PreviewFrame>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex gap-3.5">
          <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-primary/30 via-primary/10 to-transparent">
            <span className="absolute inset-0 grid place-items-center text-2xl">🧴</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Serum Pilar</div>
                <div className="text-[11px] text-muted-foreground">Cuidado facial · 30 ml</div>
              </div>
              <div className="text-sm font-semibold text-accent-ink">$89.000</div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-accent-ink">
                <Check className="size-3" /> En stock · 8
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                15% off
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border bg-background/60 px-3 py-2.5">
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <ChannelLogo channel="whatsapp" size={14} />
            <span className="font-medium text-foreground">Sincronizado con Shopify</span>
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-accent-ink">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" /> al día
          </span>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-xs text-foreground duration-500 animate-in fade-in">
          <ShoppingBag className="size-3.5 text-accent-ink" />
          La IA recomendó este producto y creó el <strong>pedido #1042</strong>.
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 06 · Métricas — animated counters + sparkline bars
// ─────────────────────────────────────────────────────────────────────────

const BARS = [38, 52, 44, 70, 60, 84, 96];

function MetricsPreview() {
  const [run, setRun] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setRun(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const ventas = useCountUp(1.84, run);
  const recup = useCountUp(420, run);
  const resp = useCountUp(4, run, 900);

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { label: "Ventas hoy", value: `$${ventas.toFixed(2)}M`, up: true },
            { label: "Recuperadas", value: `$${Math.round(recup)}K`, up: true },
            { label: "Respuesta", value: `${Math.round(resp)}s`, up: false },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-border bg-background/60 p-3">
              <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{m.label}</div>
              <div className="mt-1 inline-flex items-baseline gap-1 text-lg font-semibold tracking-[-0.02em]">
                {m.value}
                {m.up && <TrendingUp className="size-3 text-accent-ink" />}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-background/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium">Ventas · últimos 7 días</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-accent-ink">
              <TrendingUp className="size-3" /> +32%
            </span>
          </div>
          <div className="flex h-24 items-end gap-2">
            {BARS.map((h, i) => (
              <div key={i} className="flex flex-1 flex-col justify-end">
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
