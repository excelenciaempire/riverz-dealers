"use client";

import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import { useT } from "@/hooks/use-locale";

/**
 * El marco de las pantallas de acceso.
 *
 * Antes eran una tarjeta de shadcn centrada sobre el fondo: la misma pantalla
 * que tienen diez mil aplicaciones, y la primera que ve alguien que todavía no
 * decidió si nos va a confiar su WhatsApp.
 *
 * Ahora es una pantalla partida. A la izquierda la tira oscura de la casa —la
 * misma que la barra lateral usa en los DOS modos, así que quien entra ya
 * estuvo mirando esto—, con la marca, una frase y las credenciales. A la
 * derecha, el formulario y nada más.
 *
 * Las insignias no son decoración: la duda de quien vende por WhatsApp es que
 * el número se le caiga, y este es el momento exacto en que la tiene. Decirlo
 * acá vale más que decirlo en la portada, que ya la leyó hace rato.
 *
 * Por debajo de `lg` la tira desaparece entera y queda el formulario con la
 * marca arriba: en un teléfono, media pantalla de adorno es media pantalla
 * menos para escribir, y el teclado ya se come el resto.
 */
export function MarcoAuth({ children }: { children: ReactNode }) {
  const t = useT();
  const credenciales = [
    t("auth.trustOfficialApi"),
    t("auth.trustReviewed"),
    t("auth.trustYourNumber"),
  ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ── La tira ── */}
      <aside className="relative hidden overflow-hidden bg-sidebar px-12 py-14 lg:flex lg:flex-col xl:px-16">
        {/* La trama y el halo del Operador: es la materia de la casa, y acá
            evita que medio metro de negro se lea como un vacío. */}
        <div className="app-trama pointer-events-none absolute inset-0 opacity-[0.55]" aria-hidden />
        <div className="app-halo pointer-events-none absolute inset-0 opacity-60" aria-hidden />

        <span className="relative text-[26px] font-semibold lowercase leading-none tracking-[0.04em] text-sidebar-primary">
          riverz
        </span>

        <div className="relative mt-auto">
          <p
            className="max-w-[15ch] text-[40px] font-medium leading-[1.05] tracking-[-0.03em] text-sidebar-foreground xl:text-[46px]"
            style={{ textWrap: "balance" }}
          >
            {t("auth.frameTitle")}
          </p>
          <p className="mt-5 max-w-[38ch] text-[15px] leading-relaxed text-sidebar-foreground/60">
            {t("auth.frameBody")}
          </p>

          <ul className="mt-10 flex flex-col gap-3">
            {credenciales.map((c) => (
              <li
                key={c}
                className="flex items-center gap-2.5 text-[13.5px] text-sidebar-foreground/75"
              >
                <BadgeCheck
                  aria-hidden
                  strokeWidth={1.75}
                  className="size-[17px] shrink-0 text-sidebar-primary"
                />
                {c}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* ── El formulario ── */}
      <main className="flex items-center justify-center px-5 py-14 sm:px-8">
        <div className="w-full max-w-[26rem]">
          {/* La marca sólo cuando la tira no está: si no, se repite. */}
          <span className="mb-9 block text-[24px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink lg:hidden">
            riverz
          </span>
          {children}
        </div>
      </main>
    </div>
  );
}

/** Encabezado del formulario. Un título, y una línea si hace falta. */
export function TituloAuth({
  titulo,
  bajada,
}: {
  titulo: string;
  bajada?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <h1 className="text-[27px] font-medium leading-tight tracking-[-0.025em] text-foreground">
        {titulo}
      </h1>
      {bajada && (
        <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted-foreground">{bajada}</p>
      )}
    </header>
  );
}
