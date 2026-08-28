"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useReducedMotion } from "@/components/landing/landing";

/**
 * Operator sobre el bloque violeta.
 *
 * Es la misma pieza que en /portada-b —se escribe un pedido, el reparto llega
 * en renglones con el nombre del especialista, y hay que aprobarlo— pero
 * vestida para este sistema: violeta saturado, grotesca blanca, sin serif.
 *
 * Está escrita aparte a propósito y no reutiliza la de la otra portada.
 * Compartir un componente entre dos sistemas visuales distintos obliga a
 * llenarlo de condicionales de estilo, y a la tercera variante ya no se
 * entiende cuál es cuál. La lógica son treinta líneas; el costo de repetirla
 * es menor que el de acoplar dos diseños.
 */

const PASOS = [
  { who: "operation.subContactos", line: "landingV4.opLine1" },
  { who: "operation.subPlantillas", line: "landingV4.opLine2" },
  { who: "operation.subAutomatizaciones", line: "landingV4.opLine3" },
] as const;

const ESCRIBIR = 2600;
const ENTRE = 1100;
const PREGUNTA = 900;
const DESCANSO = 3200;

export function OperatorDark() {
  const t = useT();
  const reduced = useReducedMotion();
  const [paso, setPaso] = useState(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reduced) return;
    const espera =
      paso === -1 ? ESCRIBIR : paso === 3 ? PREGUNTA : paso === 4 ? DESCANSO : ENTRE;
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
    <div className="relative mx-auto min-h-[400px] max-w-[620px] text-left">
      {/* El campo arranca centrado, como el de ChatGPT cuando no hay nada
          escrito; al enviarse sube a la esquina y aparece la respuesta. */}
      <div
        className="absolute transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={
          escribiendo
            ? { top: "40%", left: "50%", transform: "translate(-50%, -50%)" }
            : { top: 0, left: "100%", transform: "translate(-100%, 0)" }
        }
      >
        <div
          className="flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-all duration-700"
          style={{
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.14)",
            width: escribiendo ? "100%" : "fit-content",
            maxWidth: "100%",
          }}
        >
          <span className="min-w-0 flex-1 text-[15px] leading-snug text-white">
            <Escribe text={t("landingV4.opPrompt")} run={escribiendo && !reduced} />
          </span>
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-full transition-opacity duration-500"
            style={{ background: "#fff", opacity: escribiendo ? 1 : 0.5 }}
          >
            <ArrowUp className="size-4" style={{ color: "#0a0f0e" }} />
          </span>
        </div>
      </div>

      <div
        className="absolute inset-x-0 top-[92px] transition-opacity duration-500"
        style={{ opacity: escribiendo ? 0 : 1 }}
      >
        <ul className="space-y-3">
          {PASOS.map((s, i) => (
            <li
              key={s.line}
              className="flex items-start gap-3 rounded-xl px-3.5 py-3 transition-all duration-500"
              style={{
                background: i < visibles ? "rgba(255,255,255,0.06)" : "transparent",
                opacity: i < visibles ? 1 : 0,
                transform: i < visibles ? "none" : "translateY(8px)",
              }}
            >
              <span
                className="mt-[3px] flex size-[18px] shrink-0 items-center justify-center rounded-full"
                style={{ background: "var(--sh-accent)" }}
              >
                <Check className="size-2.5" style={{ color: "#0a0f0e" }} />
              </span>
              <span className="min-w-0">
                <span className="sh-label" style={{ color: "rgba(255,255,255,0.5)" }}>
                  {t(s.who)}
                </span>
                <span className="mt-1 block text-[15px] leading-snug text-white">
                  {t(s.line)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div
          className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3 transition-all duration-500"
          style={{
            opacity: preguntando ? 1 : 0,
            transform: preguntando ? "none" : "translateY(8px)",
          }}
        >
          <span className="text-[15px] text-white">{t("landingV4.opAsk")}</span>
          <span
            className="rounded-full px-4 py-2 text-[13px] font-medium transition-colors duration-500"
            style={{
              background: aprobado ? "rgba(255,255,255,0.12)" : "#fff",
              color: aprobado ? "rgba(255,255,255,0.6)" : "#0a0f0e",
            }}
          >
            {t("landingV4.opApprove")}
          </span>
          <span className="sh-label" style={{ color: "rgba(255,255,255,0.4)" }}>
            {t("landingV4.opNote")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Escribe letra por letra mientras `run`; fuera de eso muestra el texto entero. */
function Escribe({ text, run }: { text: string; run: boolean }) {
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!run) return;
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

  return (
    <>
      {run ? text.slice(0, n) : text}
      {run && n < text.length && (
        <span aria-hidden style={{ opacity: 0.5 }}>
          |
        </span>
      )}
    </>
  );
}
