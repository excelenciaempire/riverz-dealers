"use client";

import Image from "next/image";
import type { ReactNode } from "react";

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
 * Ahora es una pantalla partida. A la izquierda la obra, entera y sin nada
 * encima salvo el nombre; a la derecha el formulario y nada más. Hubo un
 * titular con tres credenciales sobre la obra y se fueron: quien llega acá ya
 * leyó la portada, y una imagen que vale por sí sola no necesita pie de foto.
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
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* ── La tira ── */}
      <aside className="relative hidden overflow-hidden lg:block">
        <Image src={arte} alt="" fill sizes="50vw" priority className="object-cover" />
        {/* Un velo corto desde arriba, y solo por la marca. La obra cambia de
            pantalla en pantalla y en una de ellas la corriente pasa justo por
            donde va el nombre; sin este piso, «riverz» se pierde contra la
            parte encendida. El resto del cuadro queda limpio. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-44"
          style={{
            background:
              "linear-gradient(to bottom, rgba(6,12,11,0.72) 0%, rgba(6,12,11,0.34) 45%, rgba(6,12,11,0) 100%)",
          }}
        />

        <span className="absolute left-12 top-12 text-[26px] font-semibold lowercase leading-none tracking-[0.04em] text-sidebar-primary xl:left-16 xl:top-14">
          riverz
        </span>
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
