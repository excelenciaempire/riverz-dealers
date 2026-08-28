"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import { useT } from "@/hooks/use-locale";

/**
 * Las ilustraciones de la portada, reusadas acá.
 *
 * No se dibujó nada nuevo a propósito: son las mismas piezas que ya vio quien
 * llegó desde riverz.co, así que entrar se siente como seguir en el mismo
 * lugar y no como saltar a un formulario prestado. Y son fichas claras sobre
 * crema, o sea que flotan sobre el fondo noche sin ningún tratamiento.
 */
export const ARTE = {
  bandeja: "/portada-b/i-bandeja-3.jpg",
  vendedor: "/portada-b/i-vendedor.jpg",
  atencion: "/portada-b/i-atencion.jpg",
  envivo: "/portada-b/i-envivo-2.jpg",
} as const;

export type Arte = (typeof ARTE)[keyof typeof ARTE];

/**
 * El marco de las pantallas de acceso.
 *
 * Antes eran una tarjeta de shadcn centrada sobre el fondo: la misma pantalla
 * que tienen diez mil aplicaciones, y la primera que ve alguien que todavía no
 * decidió si nos va a confiar su WhatsApp.
 *
 * Ahora es una pantalla partida. A la izquierda el fondo noche de la portada
 * con una pieza del producto flotando encima; a la derecha el formulario y
 * nada más. Debajo de la ilustración van las credenciales: la duda de quien
 * vende por WhatsApp es que el número se le caiga, y éste es el momento exacto
 * en que la tiene — decirlo acá vale más que decirlo en una portada que ya
 * leyó hace rato.
 *
 * Por debajo de `lg` la tira desaparece entera y queda el formulario con la
 * marca arriba: en un teléfono, media pantalla de adorno es media pantalla
 * menos para escribir, y el teclado ya se come el resto.
 */
export function MarcoAuth({
  children,
  arte = ARTE.bandeja,
}: {
  children: ReactNode;
  /** La pieza que acompaña a ESTA pantalla. */
  arte?: Arte;
}) {
  const t = useT();
  const credenciales = [
    t("auth.trustOfficialApi"),
    t("auth.trustReviewed"),
    t("auth.trustYourNumber"),
  ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* ── La tira ── */}
      <aside className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-center lg:px-12 lg:py-14 xl:px-16">
        <Image
          src="/portada-b/fondo-noche.jpg"
          alt=""
          fill
          sizes="50vw"
          priority
          className="object-cover"
        />
        {/* Un velo para que la letra no dependa de por dónde caiga el
            degradado: el fondo tiene una zona clara arriba a la derecha. */}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(105deg, rgba(10,10,10,0.82), rgba(10,10,10,0.45))" }}
          aria-hidden
        />

        <div className="relative flex flex-col">
          <span className="text-[26px] font-semibold lowercase leading-none tracking-[0.04em] text-sidebar-primary">
            riverz
          </span>

          {/* La pieza. `max-h` en vh y no en px: en un portátil de 13" con la
              barra del navegador quedan ~600px de alto, y una ilustración fija
              empujaba las credenciales fuera de la pantalla. */}
          <div className="mt-9 overflow-hidden rounded-2xl bg-[#f7f3ec] shadow-[0_24px_60px_-20px_rgba(0,0,0,0.55)]">
            <Image
              src={arte}
              alt=""
              width={1300}
              height={975}
              sizes="(min-width: 1280px) 44vw, 46vw"
              className="h-auto max-h-[42vh] w-full object-cover object-center"
            />
          </div>

          <p className="mt-9 max-w-[15ch] text-[34px] font-medium leading-[1.06] tracking-[-0.03em] text-sidebar-foreground xl:text-[38px]">
            {t("auth.frameTitle")}
          </p>

          <ul className="mt-7 flex flex-col gap-2.5">
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
      <main className="flex items-center justify-center px-5 py-12 sm:px-8 sm:py-14">
        <div className="w-full max-w-[26rem]">
          {/* La marca sólo cuando la tira no está: si no, se repite. */}
          <span className="mb-8 block text-[24px] font-semibold lowercase leading-none tracking-[0.04em] text-accent-ink lg:hidden">
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
      <h1 className="text-[26px] font-medium leading-tight tracking-[-0.025em] text-foreground sm:text-[27px]">
        {titulo}
      </h1>
      {bajada && (
        <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted-foreground">{bajada}</p>
      )}
    </header>
  );
}
