"use client";

import { useEffect, useRef, useState } from "react";
import { LOCALES } from "@/lib/i18n/config";
import { useLocale } from "@/hooks/use-locale";

/**
 * Piezas compartidas de la portada editorial.
 *
 * La entrada al scrollear se mide con el rectángulo del elemento y no con
 * `IntersectionObserver`: el observador no reporta nada mientras la pestaña no
 * se mira, y un bloque que arranca invisible se quedaba invisible.
 */

/** Marca un elemento como «ya entró» la primera vez que se ve. */
export function useInView<T extends HTMLElement>(margin = 0.1) {
  const ref = useRef<T>(null);
  const [state, setState] = useState<"raw" | "out" | "in">("raw");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let arm = 0;
    let raf = 0;
    let done = false;

    const check = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.top < vh * (1 - margin) && r.bottom > vh * margin) {
        done = true;
        setState("in");
        stop();
      }
    };
    let tick: ReturnType<typeof setInterval> | null = null;

    const onScroll = () => {
      if (!raf && !done) raf = requestAnimationFrame(check);
    };
    const stop = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (tick) clearInterval(tick);
      tick = null;
    };

    // Dos cuadros: en el primero se arma (el bloque pasa a su estado de
    // entrada) y en el segundo se mide. Junto, lo que ya está a la vista
    // aparecería puesto en vez de subir.
    arm = requestAnimationFrame(() => {
      arm = 0;
      setState("out");
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      // Además del scroll, un latido cada 250 ms mientras el bloque siga
      // apagado. El estado apagado ESCONDE el contenido, así que no puede
      // depender de que llegue un evento: alcanza con que la ventana cambie
      // de tamaño en medio de un scroll, o con que el navegador agrupe los
      // eventos, para que una ficha se quede invisible para siempre. El
      // latido se corta solo en cuanto la ficha entra.
      tick = setInterval(check, 250);
      raf = requestAnimationFrame(check);
    });

    return () => {
      if (arm) cancelAnimationFrame(arm);
      if (raf) cancelAnimationFrame(raf);
      stop();
    };
  }, [margin]);

  // Sin atributo (HTML del servidor, o sin JavaScript) el bloque está puesto:
  // nunca se pierde contenido por esperar a que cargue un script.
  return { ref, inView: state === "raw" ? undefined : String(state === "in") };
}

/** Bloque que sube y aparece al entrar en pantalla. */
export function Rise({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      data-in={inView}
      className={`sn-rise ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

/** Etiqueta mono en mayúsculas: abre cada sección. */
export function Label({ children }: { children: React.ReactNode }) {
  return <p className="sn-label">{children}</p>;
}

/** Conmutador de idioma, en la letra mono de la portada. */
export function LocaleSwitch() {
  const { locale, setLocale } = useLocale();
  return (
    <div className="sn-label flex items-center gap-2">
      {LOCALES.map((loc, i) => (
        <span key={loc} className="flex items-center gap-2">
          {i > 0 && (
            <span aria-hidden className="opacity-40">
              /
            </span>
          )}
          <button
            type="button"
            onClick={() => setLocale(loc)}
            aria-pressed={locale === loc}
            className={
              locale === loc
                ? "underline underline-offset-4"
                : "opacity-55 transition-opacity hover:opacity-100"
            }
            style={locale === loc ? { color: "var(--sn-ink)" } : undefined}
          >
            {loc}
          </button>
        </span>
      ))}
    </div>
  );
}
