"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { FIRST_MONTH_DISCOUNT_PERCENT } from "@/lib/billing/first-month-offer";

/**
 * La oferta — barra de aviso que abre un diálogo.
 *
 * Estuvo como sección propia en medio de la página, con los cinco pasos
 * desplegados. Se saca de ahí porque **es una oferta temporal**: cuando deje
 * de estar vigente hay que poder retirarla sin dejar un hueco en el recorrido
 * ni tener que recomponer el orden de las secciones. Acá vive entera en un
 * solo componente: se borra este archivo y su llamada, y la portada sigue
 * teniendo sentido de punta a punta.
 *
 * La barra sigue arriba porque es lo primero que mata la objeción más grande
 * del avatar —«esto va a ser otro proyecto de meses»—, pero el detalle queda
 * a un clic en vez de ocupar una pantalla entera.
 */

const PASOS = [
  { t: "landingV4.launch1Title", b: "landingV4.launch1Body" },
  { t: "landingV4.launch2Title", b: "landingV4.launch2Body" },
  { t: "landingV4.launch3Title", b: "landingV4.launch3Body" },
  { t: "landingV4.launch4Title", b: "landingV4.launch4Body" },
  { t: "landingV4.launch5Title", b: "landingV4.launch5Body" },
] as const;

export function Oferta() {
  const t = useT();
  const [abierto, setAbierto] = useState(false);
  const cerrar = useRef<HTMLButtonElement>(null);

  // Escape cierra, y mientras está abierto la página de atrás no se mueve.
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(() => cerrar.current?.focus());
    return () => {
      document.body.style.overflow = previo;
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, [abierto]);

  return (
    <>
      {/* Pegada arriba, en todos los anchos: es la única barra fija de la
          página. Antes lo era el menú; la oferta vale más a la vista que
          cuatro anclas, y una sola barra fija deja el teléfono respirar. */}
      <div className="sticky top-0 z-30 px-3 pt-3">
        {/* En el teléfono el aviso es UNA sola línea: la promesa y el enlace.
            La frase larga se cae en pantalla chica —a 390 px ocupaba tres
            renglones y el bloque negro se comía media portada antes de que se
            viera nada—. Quien quiera el detalle lo abre; para eso está el
            diálogo. */}
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-haspopup="dialog"
          className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-full px-4 py-2.5 text-center transition-opacity hover:opacity-90 sm:px-5"
          style={{ background: "var(--sn-ink)" }}
        >
          <span className="sn-label" style={{ color: "var(--sn-accent)" }}>
            {t("landingV4.bannerLead")}
          </span>
          <span className="sn-label" style={{ color: "var(--sn-accent)" }}>
            · {t("landingV4.bannerDiscount", { percent: FIRST_MONTH_DISCOUNT_PERCENT })}
          </span>
          <span
            className="hidden text-[13px] sm:inline"
            style={{ color: "rgba(250,247,241,0.82)" }}
          >
            <span aria-hidden>— </span>
            {t("landingV4.bannerText")}
          </span>
          <span
            className="sn-label ml-1 underline underline-offset-4"
            style={{ color: "rgba(250,247,241,0.82)" }}
          >
            {t("landingV4.bannerVer")}
          </span>
        </button>
      </div>

      {abierto && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto p-3 sm:items-center sm:p-6"
          style={{ background: "rgba(18,32,31,0.55)", backdropFilter: "blur(6px)" }}
          onClick={() => setAbierto(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("landingV4.launchLabel")}
            onClick={(e) => e.stopPropagation()}
            className="sn-card relative my-auto w-full max-w-2xl overflow-hidden p-6 sm:p-10"
          >
            <button
              ref={cerrar}
              type="button"
              onClick={() => setAbierto(false)}
              aria-label={t("landingV4.cerrar")}
              className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full transition-colors"
              style={{ background: "var(--sn-sand)", color: "var(--sn-ink)" }}
            >
              <X className="size-4" />
            </button>

            <h2 className="sn-h2 max-w-[14ch]">{t("landingV4.launchTitle")}</h2>
            <p className="sn-body mt-4 max-w-[46ch] !text-[15px]">{t("landingV4.launchBody")}</p>

            {/* La ilustración de la bandeja y no la foto de archivo: acá hay
                que mostrar QUÉ te queda montado, y eso es el dibujo de los
                canales entrando a un solo lugar y saliendo a la tienda. Una
                foto de manos con cajas no dice nada de eso. Se ve en todos los
                anchos —antes estaba oculta en el teléfono, que es justo donde
                más falta hace algo que descanse la lista. */}
            <div className="relative mt-7 aspect-[4/3] w-full overflow-hidden rounded-2xl bg-[var(--sn-card)] sm:aspect-[2/1]">
              <Image
                src="/portada-b/i-bandeja-3.jpg"
                alt=""
                fill
                sizes="(min-width: 640px) 640px, 92vw"
                className="object-contain"
              />
            </div>

            <ol className="mt-7">
              {PASOS.map((p, i) => (
                <li
                  key={p.t}
                  className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t py-4"
                  style={{ borderColor: "var(--sn-line)" }}
                >
                  <span
                    className="row-span-2 font-[family-name:var(--font-editorial)] text-[26px] leading-none"
                    style={{ color: "var(--sn-tan)" }}
                  >
                    {i + 1}
                  </span>
                  <h3 className="sn-h3 !text-[18px]">{t(p.t)}</h3>
                  <p className="sn-body !text-[14px]">{t(p.b)}</p>
                </li>
              ))}
            </ol>

            <a
              href="#acceso"
              onClick={() => setAbierto(false)}
              className="sn-pill mt-7 w-full sm:w-auto"
            >
              {t("landingV4.launchCta")}
            </a>
          </div>
        </div>
      )}
    </>
  );
}
