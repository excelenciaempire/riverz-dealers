"use client";

import { useEffect, useRef, useState } from "react";
import { LOCALES } from "@/lib/i18n/config";
import { useLocale } from "@/hooks/use-locale";

/**
 * Piezas compartidas de la portada «Papel y Señal».
 *
 * Las tres firmas de la página —la regla, el marcador y el descubrimiento
 * línea por línea— viven acá para que las seis secciones las usen igual y
 * corregir una sea corregir todas.
 */

/**
 * Enciende un elemento la primera vez que entra en pantalla, y no lo apaga.
 *
 * Devuelve también `armed`, que es falso hasta que el componente montó en el
 * navegador. Importa: el estado apagado del titular lo esconde con un
 * `translateY`, así que si el HTML del servidor ya viniera apagado, la portada
 * llegaría con el titular INVISIBLE hasta que termine de cargar el JavaScript
 * —en un contenedor recién despierto, varios segundos— y sin JavaScript no se
 * vería nunca. Con `armed`, el servidor manda el texto puesto y la animación
 * solo existe si hay navegador que la corra.
 */
export function useLit<T extends HTMLElement>(margin = 0.12) {
  const ref = useRef<T>(null);
  const [lit, setLit] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let arm = 0;
    let raf = 0;
    let done = false;

    // Se mide el rectángulo y punto, en vez de usar `IntersectionObserver`:
    // el observador no reporta nada mientras la pestaña no se mira, y ahí un
    // titular apagado —que está escondido— no se encendía nunca. Medir
    // funciona igual en segundo plano, y es lo mismo que ya hace la escena.
    const check = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.top < vh * (1 - margin) && r.bottom > vh * margin) {
        done = true;
        setLit(true);
        stop();
      }
    };
    const onScroll = () => {
      if (!raf && !done) raf = requestAnimationFrame(check);
    };
    const stop = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };

    // Dos cuadros a propósito: en el primero se arma —el texto pasa a su
    // estado apagado— y en el segundo se mide. Si se hiciera todo junto, lo
    // que ya está a la vista pasaría de puesto a puesto sin animarse.
    arm = requestAnimationFrame(() => {
      arm = 0;
      setArmed(true);
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      raf = requestAnimationFrame(check);
    });

    return () => {
      if (arm) cancelAnimationFrame(arm);
      if (raf) cancelAnimationFrame(raf);
      stop();
    };
  }, [margin]);

  // Terminada la entrada, el atributo se retira: la transición desaparece con
  // él y con ella la capa que el compositor mantiene aparte. Un titular que ya
  // llegó no tiene por qué seguir siendo una capa viva.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!lit) return;
    const id = setTimeout(() => setSettled(true), 1400);
    return () => clearTimeout(id);
  }, [lit]);

  // `undefined` deja el atributo fuera del HTML, que es lo que el CSS lee como
  // «esto no se anima»: sin atributo, el texto está puesto.
  const veil = !armed || settled ? undefined : String(lit);
  return { ref, lit, veil };
}

/**
 * La regla. Cada sección abre con esta línea a todo el ancho: a la izquierda
 * el nombre de la sección, a la derecha el dato. Es la columna vertebral de
 * la página.
 */
export function Rule({ left, right }: { left: string; right: string }) {
  return (
    <div className="pl-rule pl-mono">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
}

/**
 * Titular de tres partes, con la del medio sobre la barra amarilla. Cada
 * parte se descubre desde abajo con un desfase corto cuando entra en pantalla.
 */
export function Headline({
  a,
  mark,
  b,
  className = "pl-display",
}: {
  a: string;
  mark: string;
  b: string;
  className?: string;
}) {
  const { ref, veil } = useLit<HTMLHeadingElement>();
  return (
    <h2 ref={ref} className={`pl-veil ${className}`} data-lit={veil}>
      <span>
        <i>{a}</i>
      </span>
      <span>
        <i>
          <em className="pl-mark not-italic" data-lit={veil}>
            {mark}
          </em>
        </i>
      </span>
      <span>
        <i>{b}</i>
      </span>
    </h2>
  );
}

/** Conmutador de idioma, en la letra mono de la portada. */
export function LocaleSwitch() {
  const { locale, setLocale } = useLocale();
  return (
    <div className="pl-mono flex items-center gap-2">
      {LOCALES.map((loc, i) => (
        <span key={loc} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden className="opacity-40">/</span>}
          <button
            type="button"
            onClick={() => setLocale(loc)}
            aria-pressed={locale === loc}
            className={
              locale === loc
                ? "underline decoration-2 underline-offset-4"
                : "opacity-50 transition-opacity hover:opacity-100"
            }
            style={
              locale === loc
                ? { textDecorationColor: "var(--pl-acid-ink)" }
                : undefined
            }
          >
            {loc}
          </button>
        </span>
      ))}
    </div>
  );
}
