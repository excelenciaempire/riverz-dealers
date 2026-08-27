"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useReducedMotion } from "@/components/landing/landing";

/**
 * Operator — a todo el ancho, y con la menor cantidad de texto posible.
 *
 * Es lo único de todo esto que no tiene nadie más en la categoría, así que se
 * lleva la pantalla entera: fondo tinta de borde a borde, un titular, una
 * línea, y la animación en el medio. Nada de viñetas explicando lo que la
 * animación ya muestra.
 *
 * La animación es un chat como el de GPT: se escribe el pedido, y la respuesta
 * llega en renglones que aparecen de a uno, cada uno con el nombre del
 * especialista que lo hizo. Termina preguntando si se activa — que es
 * exactamente el mecanismo real: el reparto se ve entero y nada sale hasta que
 * una persona lo aprueba.
 *
 * Sin dependencias: estado de React y transiciones de CSS. Con
 * `prefers-reduced-motion` no se anima nada y se muestra la conversación
 * terminada, que es el fotograma que más cuenta.
 */

const PASOS = [
  { who: "operation.subContactos", line: "landingV4.opLine1" },
  { who: "operation.subPlantillas", line: "landingV4.opLine2" },
  { who: "operation.subAutomatizaciones", line: "landingV4.opLine3" },
] as const;

// Ritmo del ciclo, en milisegundos y por paso.
const ESCRIBIR = 2600;
const ENTRE_RENGLONES = 1100;
const PREGUNTA = 900;
const DESCANSO = 3200;

export function Operator() {
  const t = useT();
  const reduced = useReducedMotion();
  // -1 escribiendo · 0..2 renglones · 3 la pregunta · 4 aprobado
  const [paso, setPaso] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reduced) return;
    const espera =
      paso === -1 ? ESCRIBIR : paso === 3 ? PREGUNTA : paso === 4 ? DESCANSO : ENTRE_RENGLONES;
    timer.current = setTimeout(() => setPaso((p) => (p >= 4 ? -1 : p + 1)), espera);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [paso, reduced]);

  const p = reduced ? 4 : paso;
  const escribiendo = p === -1;
  const visibles = Math.max(0, Math.min(PASOS.length, p + 1));
  const preguntando = p >= 3;
  const aprobado = p >= 4;

  return (
    <section id="operator" className="sn-full relative scroll-mt-24" style={{ background: "var(--sn-ink)" }}>
      <div className="mx-auto max-w-3xl px-5 py-20 text-center sm:py-28 lg:py-32">
        <span className="sn-label" style={{ color: "var(--sn-accent)" }}>
          {t("landingV4.operatorLabel")}
        </span>
        <h2 className="sn-h2 mx-auto mt-5 max-w-[15ch]" style={{ color: "var(--sn-card)" }}>
          {t("landingV4.operatorTitle")}
        </h2>
        <p
          className="mx-auto mt-5 max-w-[46ch] text-[16px] leading-relaxed"
          style={{ color: "rgba(250,247,241,0.6)" }}
        >
          {t("landingV4.operatorLead")}
        </p>

        {/* El chat.
            Arranca como arranca ChatGPT: el campo solo, centrado en el medio
            del bloque, sin nada alrededor. Al enviarse sube a la esquina y se
            convierte en el mensaje propio, y recién ahí aparece la respuesta.
            Ese movimiento es lo que hace entender de una que se le HABLA. */}
        <div className="relative mx-auto mt-10 min-h-[400px] max-w-[600px] text-left sm:mt-14">
          <div
            className="absolute transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={
              escribiendo
                ? { top: "42%", left: "50%", transform: "translate(-50%, -50%)" }
                : { top: 0, left: "100%", transform: "translate(-100%, 0)" }
            }
          >
            <div
              className="flex items-center gap-3 rounded-[20px] px-4 py-3 transition-all duration-700"
              style={{
                background: escribiendo ? "rgba(250,247,241,0.06)" : "rgba(250,247,241,0.1)",
                // Mientras se escribe ocupa el ancho de su caja, como el campo
                // de ChatGPT; después se encoge a su contenido y se va a la
                // esquina. Va en porcentaje de la caja y no en `min(520px,
                // 78vw)`: con vw, en pantallas angostas el campo se salía por
                // la izquierda porque el contenedor ya venía con su margen.
                width: escribiendo ? "100%" : "fit-content",
                maxWidth: "100%",
                boxShadow: escribiendo ? "0 0 0 1px rgba(250,247,241,0.08)" : "none",
              }}
            >
              <span
                className="min-w-0 flex-1 text-[15px] leading-snug"
                style={{ color: "rgba(250,247,241,0.92)" }}
              >
                <Escribe text={t("landingV4.opPrompt")} run={escribiendo && !reduced} />
              </span>
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full transition-opacity duration-500"
                style={{ background: "var(--sn-accent)", opacity: escribiendo ? 1 : 0.55 }}
              >
                <ArrowUp className="size-3.5" style={{ color: "var(--sn-ink)" }} />
              </span>
            </div>
          </div>

          {/* La respuesta: un renglón por especialista, apareciendo de a uno. */}
          <div
            className="absolute inset-x-0 top-[86px] transition-opacity duration-500"
            style={{ opacity: escribiendo ? 0 : 1 }}
          >
            <ul className="space-y-3.5">
              {PASOS.map((s, i) => {
                const on = i < visibles;
                return (
                  <li
                    key={s.line}
                    className="flex items-start gap-3 transition-all duration-500"
                    style={{ opacity: on ? 1 : 0, transform: on ? "none" : "translateY(8px)" }}
                  >
                    <span
                      className="mt-[3px] flex size-[18px] shrink-0 items-center justify-center rounded-full"
                      style={{ background: "var(--sn-accent)" }}
                    >
                      <Check className="size-2.5" style={{ color: "var(--sn-ink)" }} />
                    </span>
                    <span className="min-w-0">
                      <span className="sn-label" style={{ color: "rgba(250,247,241,0.42)" }}>
                        {t(s.who)}
                      </span>
                      <span
                        className="mt-1 block text-[15px] leading-snug"
                        style={{ color: "rgba(250,247,241,0.9)" }}
                      >
                        {t(s.line)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>

            {/* El final: la pregunta y el botón. Es el mecanismo entero en dos
                elementos — el reparto se ve, y no sale hasta que alguien
                aprueba. */}
            <div
              className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3 transition-all duration-500"
              style={{
                opacity: preguntando ? 1 : 0,
                transform: preguntando ? "none" : "translateY(8px)",
              }}
            >
              <span className="text-[15px]" style={{ color: "rgba(250,247,241,0.9)" }}>
                {t("landingV4.opAsk")}
              </span>
              <span
                className="rounded-full px-4 py-2 text-[13px] font-medium transition-colors duration-500"
                style={{
                  background: aprobado ? "rgba(250,247,241,0.1)" : "var(--sn-accent)",
                  color: aprobado ? "rgba(250,247,241,0.55)" : "var(--sn-ink)",
                }}
              >
                {t("landingV4.opApprove")}
              </span>
              <span className="sn-label" style={{ color: "rgba(250,247,241,0.32)" }}>
                {t("landingV4.opNote")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Escribe un texto letra por letra. Fuera del paso de tipeo va entero. */
function Escribe({ text, run }: { text: string; run: boolean }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!run) return;
    // El reinicio va en un cuadro aparte y no en el cuerpo del efecto: así no
    // encadena renders y, al volver a empezar el ciclo, el texto completo del
    // giro anterior no llega a pintarse.
    const raf = requestAnimationFrame(() => setN(0));
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) clearInterval(id);
    }, 52);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [run, text]);

  const visto = run ? text.slice(0, n) : text;

  return (
    <>
      {visto}
      {run && n < text.length && (
        <span aria-hidden style={{ opacity: 0.5 }}>
          |
        </span>
      )}
    </>
  );
}
