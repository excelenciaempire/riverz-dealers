"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import { useT } from "@/hooks/use-locale";

/**
 * Obra a sangre, una por pantalla.
 *
 * Antes acá había una ilustración de la portada metida en una tarjeta blanca
 * flotando sobre una foto de noche: dos imágenes peleándose el mismo cuadro y
 * ninguna hecha para estar ahí. Y era material reciclado, que en la primera
 * pantalla de la marca se nota.
 *
 * Estas tres son propias y ocupan la mitad de la ventana entera. El tema es la
 * corriente —el nombre de la marca, que nadie en la categoría está usando—:
 * verde petróleo casi negro, una sola luz amarilla, exposición larga. Cada
 * pantalla tiene la suya y ninguna se repite:
 *
 *   nace   la corriente arranca de un hilo y se abre — crear cuenta
 *   plena  la corriente trenzada, en pleno caudal — entrar
 *   llega  muchos hilos que se juntan y se aquietan — cuenta creada
 *
 * Están compuestas con el tercio inferior izquierdo vacío y oscuro a
 * propósito, que es donde cae el texto: así alcanza un velo suave y la obra no
 * queda tapada por una cortina negra.
 */
export const ARTE = {
  nace: "/auth/corriente-nace.jpg",
  plena: "/auth/corriente-plena.jpg",
  llega: "/auth/corriente-llega.jpg",
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
  arte = ARTE.plena,
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
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* ── La tira ── */}
      <aside className="relative hidden overflow-hidden lg:block">
        <Image src={arte} alt="" fill sizes="50vw" priority className="object-cover" />
        {/* Un velo que sube desde abajo y nada más. La obra ya está compuesta
            con el pie oscuro, así que no hace falta una cortina sobre todo. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(6,12,11,0.94) 0%, rgba(6,12,11,0.6) 32%, rgba(6,12,11,0) 62%)",
          }}
        />

        <span className="absolute left-12 top-12 text-[26px] font-semibold lowercase leading-none tracking-[0.04em] text-sidebar-primary xl:left-16 xl:top-14">
          riverz
        </span>

        <div className="absolute inset-x-12 bottom-12 xl:inset-x-16 xl:bottom-14">
          <p className="max-w-[15ch] text-[34px] font-medium leading-[1.06] tracking-[-0.03em] text-sidebar-foreground xl:text-[38px]">
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
