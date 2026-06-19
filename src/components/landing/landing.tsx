import Link from "next/link";
import {
  Inbox,
  Sparkles,
  Workflow,
  Megaphone,
  ShoppingBag,
  BarChart3,
  ArrowRight,
  Check,
} from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";

/**
 * Public marketing landing for riverz.co — shown to logged-out visitors at
 * the root. Theme-aware (uses the design tokens), premium-minimalist, lime
 * accent. No real customer data: the product preview is a styled mockup.
 */

const FEATURES = [
  {
    icon: Inbox,
    title: "Bandeja unificada",
    body: "WhatsApp, Instagram, Messenger y correo en una sola pantalla. Tu equipo responde todo sin cambiar de app.",
  },
  {
    icon: Sparkles,
    title: "Asistente de IA",
    body: "Un asistente que conoce tus productos y responde como tu mejor vendedor — y pasa a un humano cuando hace falta.",
  },
  {
    icon: Workflow,
    title: "Automatizaciones",
    body: "Carritos abandonados, confirmaciones, recompras… mensajes que se envían solos cuando pasa lo importante.",
  },
  {
    icon: Megaphone,
    title: "Campañas",
    body: "Envía campañas masivas segmentadas por WhatsApp y mide aperturas, respuestas y ventas.",
  },
  {
    icon: ShoppingBag,
    title: "Productos y Shopify",
    body: "Conecta tu catálogo de Shopify o sube productos a mano. La IA vende con datos reales de cada producto.",
  },
  {
    icon: BarChart3,
    title: "Métricas en vivo",
    body: "Conversaciones, tiempos de respuesta y ventas, en tiempo real y por canal.",
  },
] as const;

const STEPS = [
  { n: "01", title: "Conecta tus canales", body: "WhatsApp, Instagram, Messenger, correo y Shopify en minutos." },
  { n: "02", title: "Activa la IA y las automatizaciones", body: "El asistente responde y los flujos trabajan solos." },
  { n: "03", title: "Responde y vende", body: "Todo desde una sola bandeja, con tu equipo y tus métricas." },
] as const;

export function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <span className="text-[19px] font-semibold lowercase tracking-[0.04em] text-accent-ink">
            riverz
          </span>
          <div className="hidden items-center gap-7 text-sm text-muted-foreground sm:flex">
            <a href="#funciones" className="hover:text-foreground">Funciones</a>
            <a href="#como-funciona" className="hover:text-foreground">Cómo funciona</a>
            <Link href="/ingresar" className="hover:text-foreground">Iniciar sesión</Link>
          </div>
          <Link
            href="/registro"
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Empezar gratis
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-5 pt-16 pb-10 sm:pt-24">
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          CRM omnicanal con inteligencia artificial
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          Toda la atención de tus clientes,{" "}
          <span className="text-accent-ink">en una sola bandeja.</span>
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          WhatsApp, Instagram, Messenger y correo — con respuestas de IA,
          automatizaciones y campañas. Para que tu equipo responda más rápido y
          venda más.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/registro"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Empezar gratis <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/ingresar"
            className="inline-flex items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Iniciar sesión
          </Link>
        </div>

        {/* Product mockup (styled, no real data) */}
        <div className="mt-14">
          <InboxMockup />
        </div>
      </section>

      {/* Channels strip */}
      <section className="border-y border-border/60 bg-muted/30">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-8 sm:flex-row sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Conecta los canales donde ya están tus clientes
          </p>
          <div className="flex items-center gap-6">
            {(["whatsapp", "instagram", "messenger", "gmail"] as const).map((c) => (
              <ChannelLogo key={c} channel={c} size={26} />
            ))}
            <span className="text-sm font-medium text-muted-foreground">+ Shopify</span>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="funciones" className="mx-auto max-w-6xl px-5 py-20">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Todo lo que necesitas para atender y vender
        </h2>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Una sola herramienta, en lugar de cinco. Minimalista por fuera,
          potente por dentro.
        </p>
        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-background p-7">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-accent-ink">
                <f.icon className="size-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="como-funciona" className="border-t border-border/60 bg-muted/20">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Empieza en 3 pasos</h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n}>
                <span className="text-sm font-semibold tabular-nums text-accent-ink">{s.n}</span>
                <h3 className="mt-2 text-lg font-semibold text-foreground">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <div className="overflow-hidden rounded-3xl border border-border bg-card px-8 py-16 text-center">
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Empieza a responder mejor — y a vender más — hoy.
          </h2>
          <p className="mx-auto mt-4 max-w-md text-muted-foreground">
            Conecta tus canales y deja que la IA y las automatizaciones hagan el
            trabajo pesado.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/registro"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Empezar gratis <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/ingresar"
              className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Iniciar sesión
            </Link>
          </div>
          <ul className="mx-auto mt-8 flex max-w-md flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {["Sin tarjeta para empezar", "Conecta en minutos", "Soporte en español"].map((t) => (
              <li key={t} className="inline-flex items-center gap-1.5">
                <Check className="size-3.5 text-accent-ink" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-[17px] font-semibold lowercase tracking-[0.04em] text-accent-ink">
              riverz
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              CRM omnicanal con IA · {" "}
              <a href="mailto:info@riverzai.com" className="hover:text-foreground">
                info@riverzai.com
              </a>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <a href="#funciones" className="hover:text-foreground">Funciones</a>
            <Link href="/ingresar" className="hover:text-foreground">Iniciar sesión</Link>
            <Link href="/privacidad" className="hover:text-foreground">Privacidad</Link>
            <Link href="/eliminar-datos" className="hover:text-foreground">Eliminar datos</Link>
          </div>
        </div>
        <div className="border-t border-border/40 py-4 text-center text-[11px] text-muted-foreground">
          © 2026 riverz. Todos los derechos reservados.
        </div>
      </footer>
    </div>
  );
}

/** Styled inbox preview — no real customer data, pure presentation. */
function InboxMockup() {
  const convos = [
    { ch: "whatsapp" as const, name: "Laura M.", snip: "¿Tienen envío a Medellín?", t: "ahora" },
    { ch: "instagram" as const, name: "@andres.q", snip: "Me interesa el serum 💛", t: "2m" },
    { ch: "messenger" as const, name: "Sofía R.", snip: "¿Cómo lo uso?", t: "9m" },
    { ch: "gmail" as const, name: "Pedidos", snip: "Confirmación de compra", t: "1h" },
  ];
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/20">
      {/* window bar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="size-3 rounded-full bg-muted-foreground/30" />
        <span className="size-3 rounded-full bg-muted-foreground/30" />
        <span className="size-3 rounded-full bg-muted-foreground/30" />
        <span className="ml-3 text-xs font-medium lowercase tracking-[0.04em] text-accent-ink">riverz · bandeja</span>
      </div>
      <div className="grid sm:grid-cols-[260px_1fr]">
        {/* conversation list */}
        <div className="border-r border-border">
          {convos.map((c, i) => (
            <div
              key={c.name}
              className={`flex items-center gap-3 border-b border-border/60 px-4 py-3 ${i === 0 ? "bg-primary/10" : ""}`}
            >
              <ChannelLogo channel={c.ch} size={20} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">{c.snip}</p>
              </div>
              <span className="text-[10px] text-muted-foreground">{c.t}</span>
            </div>
          ))}
        </div>
        {/* conversation */}
        <div className="hidden flex-col gap-3 p-5 sm:flex">
          <div className="max-w-[80%] self-start rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2 text-sm text-foreground">
            ¿Tienen envío a Medellín? 👀
          </div>
          <div className="max-w-[80%] self-end rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
            ¡Hola Laura! Sí, enviamos a todo el país. Tu pedido llegaría en 2–3 días 📦
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
            <Sparkles className="size-3 text-accent-ink" />
            Sugerido por la IA · enviado en 4s
          </div>
        </div>
      </div>
    </div>
  );
}
