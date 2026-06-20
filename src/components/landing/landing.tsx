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
  instagram: { name: "andres.q", them: "Me encantó mi compra 💛", you: "¡Gracias! Te paso el link 👇" },
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
    body: "Conoce tu catálogo, tus precios y tus envíos al derecho y al revés. Recomienda, responde dudas y cierra la compra como tu mejor vendedor, también mientras duermes.",
    Preview: AgentPanel,
  },
  {
    n: "02",
    eyebrow: "Carritos abandonados",
    icon: ShoppingCart,
    title: "Recupera cada",
    titleMuted: "carrito abandonado.",
    body: "Cuando alguien deja la compra a medias, el agente le escribe solo, resuelve la duda y recupera la venta antes de que se enfríe.",
    Preview: CartRecoveryPanel,
  },
  {
    n: "03",
    eyebrow: "Recompras",
    icon: RotateCcw,
    title: "Recompras automáticas,",
    titleMuted: "sin que muevas un dedo.",
    body: "Seguimiento post-venta y recordatorios de recompra para tus clientes dormidos. Configuras las recompras una sola vez y el agente las envía cuando es más probable que vuelvan a comprar.",
    Preview: FlowPreview,
  },
  {
    n: "04",
    eyebrow: "Soporte",
    icon: Headset,
    title: "Atiende y avisa,",
    titleMuted: "las 24 horas.",
    body: "Confirma cada pedido, envía el número de guía y resuelve dudas al instante. Tus clientes siempre saben en qué va su compra, a cualquier hora.",
    Preview: SupportPreview,
  },
  {
    n: "05",
    eyebrow: "Comentarios",
    icon: MessageSquare,
    title: "También responde",
    titleMuted: "los comentarios.",
    body: "Responde al instante cada comentario en tus publicaciones y anuncios de Instagram y Facebook, y se lleva la conversación al DM para cerrar la venta.",
    Preview: CommentsPreview,
  },
  {
    n: "06",
    eyebrow: "Campañas",
    icon: Megaphone,
    title: "Campañas masivas en",
    titleMuted: "WhatsApp e Instagram.",
    body: "Lanza una promoción a miles de contactos por WhatsApp e Instagram y mira en vivo quién la recibió, quién la leyó, quién te respondió y quién te compró.",
    Preview: CampaignPreview,
  },
  {
    n: "07",
    eyebrow: "Bandeja",
    icon: Inbox,
    title: "Y todo, en una",
    titleMuted: "sola bandeja.",
    body: "WhatsApp, Instagram, Messenger y correo en una sola pantalla. Tu equipo y el agente trabajan codo a codo y a ningún cliente lo dejan en visto.",
    Preview: InboxPreview,
  },
  {
    n: "08",
    eyebrow: "Productos",
    icon: Package,
    title: "Conecta Shopify",
    titleMuted: "y vende con datos reales.",
    body: "Inventario, precios y pedidos sincronizados. El agente recomienda, arma el pedido y cobra con información al día.",
    Preview: ProductPreview,
  },
  {
    n: "09",
    eyebrow: "Configuración",
    icon: MousePointerClick,
    title: "Listo en minutos,",
    titleMuted: "con unos cuantos clics.",
    body: "Conectas tus canales y tu tienda, activas el agente y ya está vendiendo. Sin código y sin los dolores de cabeza de otras plataformas.",
    Preview: SetupPreview,
  },
  {
    n: "10",
    eyebrow: "Resultados",
    icon: BarChart3,
    title: "Un ROAS claro,",
    titleMuted: "no corazonadas.",
    body: "Cada venta queda atribuida al agente, así sabes cuánto te devuelve cada peso que inviertes. Y como contesta en segundos y atiende muchos chats a la vez, te rinde más que cualquier humano.",
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
              <h1 className={`max-w-[15ch] animate-in fade-in slide-in-from-bottom-3 text-balance duration-700 ${DISPLAY}`}>
                Convierte cada chat{" "}
                <span className="text-muted-foreground">en una venta.</span>
              </h1>
              <p className="mt-6 max-w-[34ch] animate-in fade-in slide-in-from-bottom-3 text-[clamp(16px,1.6vw,20px)] leading-relaxed tracking-[-0.01em] text-muted-foreground duration-700 sm:max-w-[46ch]">
                Un agente de IA que atiende, recomienda y cierra ventas en WhatsApp e Instagram. Recupera carritos, hace volver a tus clientes y te muestra cuánto vendes, las 24 horas.
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
              <ChannelLogo channel={c.id} size={22} /> {c.label}
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

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="relative overflow-hidden rounded-[2rem] bg-[#0b0b0a] px-6 py-20 text-center sm:px-12">
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
              <Sparkles className="size-3.5" /> Tu agente de ventas, listo hoy
            </span>
            <h2 className="mx-auto mt-6 max-w-[18ch] text-balance text-[clamp(32px,4.6vw,58px)] font-medium leading-[1.02] tracking-[-0.04em] text-white">
              Pon a tu agente a vender hoy.
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-white/55">
              Conectas WhatsApp e Instagram, activas el agente y empieza a contestar y a cerrar ventas. Toma minutos, no semanas.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/registro"
                className="group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.03]"
              >
                Empezar gratis
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/ingresar"
                className="rounded-full border border-white/15 px-6 py-3 text-sm font-medium text-white/80 transition-colors hover:bg-white/5"
              >
                Iniciar sesión
              </Link>
            </div>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-white/40">
              <span>Sin tarjeta de crédito</span>
              <span className="size-1 rounded-full bg-white/25" />
              <span>Listo en minutos</span>
              <span className="size-1 rounded-full bg-white/25" />
              <span>Cancela cuando quieras</span>
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
        <div className="grid items-center gap-10 md:grid-cols-[0.85fr_1.15fr] md:gap-12 lg:gap-16">
          <div className={flip ? "md:order-2" : undefined}>
            <h2 className={H2}>
              {s.title}{" "}
              <span className="text-muted-foreground">{s.titleMuted}</span>
            </h2>
            <p className={`mt-5 max-w-[420px] ${BODY}`}>{s.body}</p>
          </div>
          <div className={flip ? "md:order-1" : undefined}>
            <s.Preview />
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

const HERO_CONVOS: HeroConvo[] = [
  {
    channel: "whatsapp",
    name: "Laura M.",
    product: { emoji: "👟", name: "Tenis Aura", price: "$239.000" },
    order: "#1042",
    steps: [
      { kind: "them", text: "Hola 👋 ¿los Tenis Aura vienen en talla 39?" },
      { kind: "typing" },
      { kind: "you", text: "¡Hola Laura! Sí 🙌 quedan 6 pares en talla 39." },
      { kind: "you", text: "Hoy con 15% off y envío gratis. ¿Te los aparto?" },
      { kind: "them", text: "Sí, los quiero 💛" },
      { kind: "typing" },
      { kind: "you", text: "Listo, te dejo el pago seguro aquí 👇" },
      { kind: "sale" },
    ],
  },
  {
    channel: "instagram",
    name: "andres.q",
    product: { emoji: "🌸", name: "Perfume Solé", price: "$185.000" },
    order: "#1043",
    steps: [
      { kind: "them", text: "vi el Perfume Solé en tu historia, ¿aún hay? 👀" },
      { kind: "typing" },
      { kind: "you", text: "¡Hola Andrés! Sí, quedan pocas unidades 🙌" },
      { kind: "you", text: "Te incluyo muestra de regalo. ¿Lo pedimos?" },
      { kind: "them", text: "dale, lo quiero 🔥" },
      { kind: "typing" },
      { kind: "you", text: "Perfecto, aquí tu link de pago 👇" },
      { kind: "sale" },
    ],
  },
  {
    channel: "messenger",
    name: "Sofía R.",
    product: { emoji: "🎒", name: "Mochila Drift", price: "$129.000" },
    order: "#1044",
    steps: [
      { kind: "them", text: "¿La Mochila Drift es resistente al agua?" },
      { kind: "typing" },
      { kind: "you", text: "¡Hola Sofía! Sí, es impermeable y trae garantía 🙌" },
      { kind: "you", text: "Hoy con envío gratis. ¿Te la despacho?" },
      { kind: "them", text: "Sí porfa 🙌" },
      { kind: "typing" },
      { kind: "you", text: "Listo, te paso el pago seguro 👇" },
      { kind: "sale" },
    ],
  },
  {
    channel: "gmail",
    name: "Camilo R.",
    product: { emoji: "⌚", name: "Reloj Nórdico", price: "$320.000" },
    order: "#1045",
    steps: [
      { kind: "them", text: "¿El Reloj Nórdico tiene cuotas sin interés?" },
      { kind: "typing" },
      { kind: "you", text: "¡Hola Camilo! Sí, hasta 3 cuotas sin interés ✉️" },
      { kind: "you", text: "¿Quieres que te genere el pedido?" },
      { kind: "them", text: "Sí, gracias" },
      { kind: "typing" },
      { kind: "you", text: "Listo, aquí tu pago seguro 👇" },
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
            className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              c.id === convo.channel
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <ChannelLogo channel={c.id} size={15} /> {c.label}
          </button>
        ))}
      </div>

      {/* conversation header */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
        <ChannelLogo channel={convo.channel} size={20} />
        <div className="leading-tight">
          <div className="text-sm font-medium">{convo.name}</div>
          <div className="text-[11px] text-accent-ink">atiende la IA · responde en 4s</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-[10px] font-medium text-accent-ink">
          <Sparkles className="size-3" /> Agente activo
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
      {step.text}
    </div>
  );
}

// Confirmed-sale card (closes every hero conversation). Carries the Shopify
// brand mark so the source of truth for the order is unmistakable.
function SaleCard({ product, order }: { product: Product; order: string }) {
  return (
    <div className="self-stretch rounded-2xl border border-primary/45 bg-primary/10 p-3.5 duration-500 animate-in fade-in zoom-in-95">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-4" />
        </span>
        <span className="text-sm font-semibold">Venta confirmada</span>
        <span className="ml-auto text-sm font-semibold text-accent-ink">{product.price}</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {product.emoji} {product.name} · 1 ud.
        </span>
        <span className="inline-flex items-center gap-1">
          <ShopifyLogo size={15} /> Pedido {order}
        </span>
      </div>
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
// 01 · Agente de ventas — four knowledge sources on the left join the agent
// on the right through animated flowing lines. The agent reads "Entrenándose".
// ─────────────────────────────────────────────────────────────────────────

const AGENT_SOURCES: { icon: typeof Inbox; label: string; y: number }[] = [
  { icon: Boxes, label: "Catálogo", y: 15 },
  { icon: Tag, label: "Precios", y: 38 },
  { icon: Truck, label: "Envíos", y: 62 },
  { icon: Star, label: "Reseñas", y: 85 },
];

function AgentPanel() {
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setLit((i) => (i + 1) % (AGENT_SOURCES.length + 1)), 1000);
    return () => clearInterval(t);
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
            className={`absolute left-4 inline-flex -translate-y-1/2 items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-sm font-medium shadow-sm transition-all duration-300 ${
              lit === i
                ? "scale-105 border-primary/60 bg-primary/10 text-accent-ink"
                : integrated(i)
                  ? "border-primary/30 text-foreground"
                  : "border-border text-muted-foreground"
            }`}
          >
            <s.icon className="size-4" />
            {s.label}
          </div>
        ))}

        {/* agent — right side */}
        <div className="absolute right-4 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2.5 rounded-2xl border border-primary/40 bg-primary/5 px-5 py-5 backdrop-blur-sm">
          <span className="relative flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30">
            {!reduced && <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />}
            <Sparkles className="relative size-7" />
          </span>
          <span className="text-[13px] font-semibold text-accent-ink">
            {ready ? "Agente listo" : "Entrenándose"}
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
  const reduced = useReducedMotion();
  // phases: 0 abandoned · 1 agent reaches out · 2 recovered · 3 hold → loop.
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setPhase((p) => (p + 1) % 4), 1500);
    return () => clearInterval(t);
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
          <span className="text-sm font-medium">Mariana L.</span>
          <span
            className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              recovered
                ? "bg-primary/15 text-accent-ink"
                : "border border-amber-500/40 text-amber-600 dark:text-amber-400"
            }`}
          >
            <span className={`size-1.5 rounded-full ${recovered ? "bg-primary" : "animate-pulse bg-amber-500"}`} />
            {recovered ? "Recuperado" : "Abandonado"}
          </span>
        </div>

        {/* product */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-primary/30 via-primary/10 to-transparent text-lg">
            🎧
          </div>
          <span className="flex-1 truncate text-sm font-medium">Audífonos Pulse</span>
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
            <div className="text-sm font-semibold">Venta recuperada</div>
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

const COMMENTS: { user: string; text: string }[] = [
  { user: "ana_p", text: "¿Cuánto vale? 😍" },
  { user: "luis.gs", text: "¿Hacen envíos a todo el país?" },
  { user: "cami.rr", text: "Lo quiero en negro 🔥" },
];

function CommentsPreview() {
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setLit((i) => (i + 1) % COMMENTS.length), 1500);
    return () => clearInterval(t);
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
            <div className="text-sm font-medium">tu.marca</div>
            <div className="text-[11px] text-muted-foreground">Anuncio</div>
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
                <span className="text-muted-foreground">{c.text}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 pl-2 text-[11px] text-accent-ink">
                <CornerDownRight className="size-3" />
                <Sparkles className="size-3" /> Respondido por la IA · al DM
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

const SUPPORT_EVENTS: { icon: typeof Inbox; title: string; meta: string }[] = [
  { icon: Check, title: "Pedido confirmado", meta: "#1042" },
  { icon: Truck, title: "En camino · guía enviada", meta: "9400 1234" },
  { icon: MessageSquare, title: "“¿Cuándo llega?” resuelto", meta: "ahora" },
];

function SupportPreview() {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(1);
  useEffect(() => {
    if (reduced) {
      const raf = requestAnimationFrame(() => setShown(SUPPORT_EVENTS.length));
      return () => cancelAnimationFrame(raf);
    }
    const t = setInterval(
      () => setShown((s) => (s >= SUPPORT_EVENTS.length ? 1 : s + 1)),
      1400,
    );
    return () => clearInterval(t);
  }, [reduced]);

  return (
    <PreviewFrame>
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary/15 text-accent-ink">
            <Headset className="size-4" />
          </span>
          <span className="text-sm font-semibold">Soporte 24/7</span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-accent-ink">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" /> en línea
          </span>
        </div>

        {/* push-style notifications stacking in */}
        <div className="flex flex-col gap-2.5">
          {SUPPORT_EVENTS.slice(0, shown).map((e, i) => (
            <div
              key={e.title}
              className={`flex items-center gap-3 rounded-xl border p-3 duration-300 animate-in fade-in slide-in-from-top-2 ${
                i === shown - 1 ? "border-primary/45 bg-primary/5" : "border-border bg-background/60"
              }`}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <e.icon className="size-4" />
              </span>
              <span className="text-sm font-medium">{e.title}</span>
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{e.meta}</span>
            </div>
          ))}
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
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0); // 0..3 (3 = all done) → loop
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setStep((s) => (s + 1) % 4), 1100);
    return () => clearInterval(t);
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
            <div className="text-sm font-semibold">Configura tu agente</div>
            <div className="text-[11px] text-muted-foreground">3 pasos · ~2 minutos</div>
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
          <span className="text-sm font-medium">Conecta tus canales</span>
          <span className="ml-auto">
            <SetupToggle on={done(0)} />
          </span>
        </div>

        {/* step 2 — connect store */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
          <ShopifyLogo size={20} />
          <span className="text-sm font-medium">Conecta tu tienda</span>
          <span className="ml-auto">
            <SetupToggle on={done(1)} />
          </span>
        </div>

        {/* step 3 — activate */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/15 text-accent-ink">
            <Sparkles className="size-4" />
          </span>
          <span className="text-sm font-medium">Activa el agente</span>
          <span
            className={`ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              done(2) ? "bg-primary/15 text-accent-ink" : "bg-primary text-primary-foreground"
            }`}
          >
            {done(2) ? (
              <>
                <Check className="size-3" /> Activo
              </>
            ) : (
              "Activar"
            )}
          </span>
        </div>

        <div className="text-center text-[11px] text-muted-foreground">
          Sin código · sin dolores de cabeza.
        </div>
      </div>
    </PreviewFrame>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 03 · Automatizaciones — a flow with a pulsing active node
// ─────────────────────────────────────────────────────────────────────────

const FLOW: { icon: typeof Inbox; sub: string }[] = [
  { icon: ShoppingBag, sub: "Compró hace 30 días" },
  { icon: Clock, sub: "Espera el momento ideal" },
  { icon: Send, sub: "Envía la oferta de recompra" },
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
                <div className="text-sm font-medium">{node.sub}</div>
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
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    const start = setTimeout(() => setCycle(1), 60);
    const loop = setInterval(() => setCycle((c) => c + 1), 5200);
    return () => {
      clearTimeout(start);
      clearInterval(loop);
    };
  }, []);
  const run = cycle > 0;

  const sent = useCountUp(1240, run, 1100, cycle);
  const delivered = useCountUp(1198, run, 1100, cycle);
  const read = useCountUp(932, run, 1100, cycle);
  const replied = useCountUp(214, run, 1100, cycle);
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
            <div className="text-sm font-semibold">Nueva colección 👟</div>
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
            <span className="absolute inset-0 grid place-items-center text-2xl">👟</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Tenis Aura</div>
                <div className="text-[11px] text-muted-foreground">Calzado · unisex</div>
              </div>
              <div className="text-sm font-semibold text-accent-ink">$239.000</div>
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
            <ShopifyLogo size={18} />
            <span className="font-medium text-foreground">Sincronizado con Shopify</span>
          </span>
          <span className="inline-flex items-center gap-1 text-[11px] text-accent-ink">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" /> al día
          </span>
        </div>

        <div className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-xs text-foreground duration-500 animate-in fade-in">
          <ShoppingBag className="size-3.5 text-accent-ink" />
          Pedido <strong>#1042</strong> creado por la IA.
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
  // setInterval-driven so the counters reliably start and re-animate (a one-shot
  // requestAnimationFrame can be dropped if the tab mounts in the background).
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    const start = setTimeout(() => setCycle(1), 60);
    const loop = setInterval(() => setCycle((c) => c + 1), 5200);
    return () => {
      clearTimeout(start);
      clearInterval(loop);
    };
  }, []);
  const run = cycle > 0;

  const roas = useCountUp(4.2, run, 1100, cycle);
  const ingresos = useCountUp(1.84, run, 1100, cycle);
  const recup = useCountUp(420, run, 1100, cycle);

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
            <div className="mt-1 text-[11px] text-muted-foreground">por cada $1 invertido</div>
          </div>
        </div>

        {/* supporting stats */}
        <div className="grid grid-cols-3 gap-2.5">
          {[
            { label: "Ingresos", value: `$${ingresos.toFixed(2)}M` },
            { label: "Recuperado", value: `$${Math.round(recup)}K` },
            { label: "Respuesta", value: "4s" },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-border bg-background/60 p-3">
              <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{m.label}</div>
              <div className="mt-1 text-lg font-semibold tracking-[-0.02em]">{m.value}</div>
            </div>
          ))}
        </div>

        {/* revenue attributed to the agent */}
        <div className="rounded-xl border border-border bg-background/60 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium">Ingresos del agente · 7 días</span>
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
