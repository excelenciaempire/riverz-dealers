"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Inbox,
  Sparkles,
  Workflow,
  Megaphone,
  ShoppingBag,
  BarChart3,
  ArrowRight,
} from "lucide-react";
import { ChannelLogo } from "@/components/inbox/channel-logo";

/**
 * Public marketing landing for riverz.co (logged-out root). Interactive,
 * theme-aware, lime accent, Inter Tight. The hero preview cycles through
 * channels live and reacts to click/hover. No real customer data.
 */

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

const FEATURES = [
  { icon: Inbox, title: "Bandeja unificada", body: "WhatsApp, Instagram, Messenger y correo en una pantalla." },
  { icon: Sparkles, title: "Asistente de IA", body: "Conoce tus productos y responde por ti." },
  { icon: Workflow, title: "Automatizaciones", body: "Mensajes que salen solos en el momento justo." },
  { icon: Megaphone, title: "Campañas", body: "Envíos masivos por WhatsApp con seguimiento real." },
  { icon: ShoppingBag, title: "Productos", body: "Conecta Shopify y vende con datos reales." },
  { icon: BarChart3, title: "Métricas", body: "Ventas y tiempos de respuesta, en vivo." },
];

export function Landing() {
  const [active, setActive] = useState<Ch>("whatsapp");
  const paused = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      if (paused.current) return;
      setActive((cur) => {
        const i = CHANNELS.findIndex((c) => c.id === cur);
        return CHANNELS[(i + 1) % CHANNELS.length].id;
      });
    }, 3200);
    return () => clearInterval(t);
  }, []);

  const t = THREADS[active];

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
        <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-12 sm:pt-28">
          <h1 className="max-w-3xl animate-in fade-in slide-in-from-bottom-3 text-[2.6rem] font-semibold leading-[1.03] tracking-tight duration-700 sm:text-[4.2rem]">
            Una bandeja para todos tus clientes.
          </h1>
          <p className="mt-5 max-w-lg animate-in fade-in slide-in-from-bottom-3 text-lg leading-relaxed text-muted-foreground duration-700">
            Todos tus canales en un solo lugar. La IA responde y vende por ti.
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

          <div
            className="mt-14 animate-in fade-in duration-1000"
            onMouseEnter={() => (paused.current = true)}
            onMouseLeave={() => (paused.current = false)}
          >
            <InboxPreview active={active} setActive={setActive} thread={t} />
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

      {/* Features */}
      <section id="funciones" className="mx-auto max-w-6xl px-5 py-24">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-[2.6rem]">Una herramienta, no cinco.</h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-border bg-card p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-foreground/25"
            >
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-accent-ink transition-transform group-hover:scale-110">
                <f.icon className="size-5" />
              </div>
              <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <div className="relative overflow-hidden rounded-3xl border border-border bg-card px-8 py-16 text-center">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-32 mx-auto h-72 w-[600px] rounded-full bg-primary/15 blur-[100px]" />
          <h2 className="relative mx-auto max-w-xl text-3xl font-semibold tracking-tight sm:text-[2.6rem]">
            Empieza hoy.
          </h2>
          <p className="relative mx-auto mt-4 max-w-sm text-muted-foreground">
            Crea tu cuenta y conecta tu primer canal en minutos.
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

function InboxPreview({
  active,
  setActive,
  thread,
}: {
  active: Ch;
  setActive: (c: Ch) => void;
  thread: { name: string; them: string; you: string };
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/20">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="size-3 rounded-full bg-muted-foreground/25" />
        <span className="size-3 rounded-full bg-muted-foreground/25" />
        <span className="size-3 rounded-full bg-muted-foreground/25" />
        <span className="ml-3 text-xs font-medium lowercase tracking-[0.04em] text-accent-ink">riverz</span>
      </div>

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
      <div key={active} className="animate-in fade-in slide-in-from-bottom-2 flex min-h-[210px] flex-col gap-3 p-5 duration-300">
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
  );
}
