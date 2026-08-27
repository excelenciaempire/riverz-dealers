"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Send, ShieldCheck, Sparkles } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import { useReducedMotion } from "@/components/landing/landing";
import { Rise } from "./bits";

/**
 * Operator — la pieza que no tiene nadie más en la categoría.
 *
 * Todos los competidores venden lo mismo: un agente que le contesta a tu
 * cliente. Acá además le hablas al software y el software se cambia solo. Por
 * eso se lleva un bloque entero sobre fondo tinta, y no una ficha más.
 *
 * La animación cuenta el mecanismo real, no una metáfora: se escribe un
 * pedido en castellano, aparece el reparto entre especialistas —cada uno con
 * su dominio—, hay que APROBARLO, y recién ahí trabajan. El botón de aprobar
 * es lo importante: es lo que separa esto de un bot suelto en la cuenta.
 *
 * Sin dependencias nuevas: estado de React y transiciones de CSS. Cada paso
 * dura lo suyo y el ciclo vuelve a empezar. Con `prefers-reduced-motion` no se
 * anima nada y se muestra el estado final, que es el que más información da.
 */

// Un paso por cada momento del ciclo. La duración va con el paso para poder
// leer el ritmo entero de un vistazo.
const STEPS = [
  { id: "typing", ms: 2400 },
  { id: "plan", ms: 1500 },
  { id: "approve", ms: 1400 },
  { id: "work1", ms: 900 },
  { id: "work2", ms: 900 },
  { id: "work3", ms: 1400 },
  { id: "done", ms: 2600 },
] as const;

type StepId = (typeof STEPS)[number]["id"];

const TASKS = [
  { who: "operation.subContactos", what: "landingV4.opTask1" },
  { who: "operation.subPlantillas", what: "landingV4.opTask2" },
  { who: "operation.subAutomatizaciones", what: "landingV4.opTask3" },
] as const;

export function Operator() {
  const t = useT();
  const reduced = useReducedMotion();
  const [i, setI] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reduced) return;
    timer.current = setTimeout(() => setI((n) => (n + 1) % STEPS.length), STEPS[i].ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [i, reduced]);

  // Con movimiento reducido se muestra el final: el reparto aprobado y hecho,
  // que es el fotograma que más cuenta.
  const step: StepId = reduced ? "done" : STEPS[i].id;
  const order = STEPS.findIndex((s) => s.id === step);
  const at = (id: StepId) => STEPS.findIndex((s) => s.id === id);

  const planVisible = order >= at("plan");
  const approved = order >= at("work1");
  const doneCount = approved ? Math.min(3, order - at("work1") + 1) : 0;
  const allDone = order >= at("done");

  // El texto se escribe letra por letra durante el primer paso; en los demás
  // ya está entero.
  const prompt = t("landingV4.opPrompt");

  return (
    <section id="operator" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 lg:py-24">
      <div
        className="overflow-hidden rounded-[26px] px-6 py-12 sm:px-10 sm:py-16 lg:px-16"
        style={{ background: "var(--sn-ink)" }}
      >
        <div className="grid items-center gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-16">
          <Rise className="min-w-0">
            <span className="sn-label" style={{ color: "var(--sn-accent)" }}>
              {t("landingV4.operatorLabel")}
            </span>
            <h2 className="sn-h2 mt-5 max-w-[15ch]" style={{ color: "var(--sn-card)" }}>
              {t("landingV4.operatorTitle")}
            </h2>
            <p
              className="mt-5 max-w-[46ch] text-[16px] leading-relaxed"
              style={{ color: "rgba(250,247,241,0.66)" }}
            >
              {t("landingV4.operatorBody")}
            </p>

            <ul className="mt-8 space-y-3">
              {["landingV4.operatorP1", "landingV4.operatorP2", "landingV4.operatorP3"].map((k) => (
                <li key={k} className="flex items-start gap-3">
                  <ShieldCheck
                    className="mt-0.5 size-[18px] shrink-0"
                    style={{ color: "var(--sn-accent)" }}
                  />
                  <span className="text-[15px]" style={{ color: "rgba(250,247,241,0.82)" }}>
                    {t(k)}
                  </span>
                </li>
              ))}
            </ul>
          </Rise>

          <div className="min-w-0">
            <div
              className="rounded-2xl p-4 sm:p-5"
              style={{ background: "rgba(250,247,241,0.05)" }}
            >
              {/* Lo que se escribe */}
              <div
                className="flex items-center gap-3 rounded-xl px-3.5 py-3"
                style={{ background: "rgba(250,247,241,0.07)" }}
              >
                <Sparkles className="size-4 shrink-0" style={{ color: "var(--sn-accent)" }} />
                <span
                  className="min-w-0 flex-1 truncate text-[14px]"
                  style={{ color: "rgba(250,247,241,0.9)" }}
                >
                  <Typed text={prompt} run={step === "typing" && !reduced} />
                </span>
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full"
                  style={{ background: "var(--sn-accent)" }}
                >
                  <Send className="size-3.5" style={{ color: "var(--sn-ink)" }} />
                </span>
              </div>

              {/* El reparto */}
              <div
                className="mt-4 rounded-xl p-3.5 transition-all duration-500 sm:p-4"
                style={{
                  background: "rgba(250,247,241,0.04)",
                  opacity: planVisible ? 1 : 0,
                  transform: planVisible ? "none" : "translateY(10px)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="sn-label" style={{ color: "rgba(250,247,241,0.5)" }}>
                    {t("landingV4.opPlanTitle")}
                  </span>
                  <span
                    className="sn-label"
                    style={{ color: allDone ? "var(--sn-accent)" : "rgba(250,247,241,0.5)" }}
                  >
                    {allDone
                      ? t("landingV4.opDone")
                      : approved
                        ? t("landingV4.opWorking")
                        : `3 · 14`}
                  </span>
                </div>

                <ul className="mt-3 space-y-2">
                  {TASKS.map((task, n) => {
                    const ticked = n < doneCount;
                    return (
                      <li
                        key={task.what}
                        className="flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors duration-500"
                        style={{
                          background: ticked
                            ? "rgba(247,255,158,0.09)"
                            : "rgba(250,247,241,0.04)",
                        }}
                      >
                        <span
                          className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full transition-colors duration-500"
                          style={{
                            background: ticked ? "var(--sn-accent)" : "rgba(250,247,241,0.12)",
                          }}
                        >
                          {ticked && (
                            <Check className="size-2.5" style={{ color: "var(--sn-ink)" }} />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span
                            className="sn-label block"
                            style={{ color: "rgba(250,247,241,0.45)" }}
                          >
                            {t(task.who)}
                          </span>
                          <span
                            className="mt-1 block text-[14px] leading-snug"
                            style={{ color: "rgba(250,247,241,0.88)" }}
                          >
                            {t(task.what)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>

                {/* El botón: lo que separa esto de un bot suelto en la cuenta. */}
                <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
                  <span
                    className="text-[12px] leading-snug"
                    style={{ color: "rgba(250,247,241,0.42)" }}
                  >
                    {t("landingV4.opNote")}
                  </span>
                  <span
                    className="shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-all duration-500"
                    style={{
                      background: approved ? "rgba(250,247,241,0.1)" : "var(--sn-accent)",
                      color: approved ? "rgba(250,247,241,0.6)" : "var(--sn-ink)",
                      transform:
                        step === "approve" && !reduced ? "scale(0.94)" : "scale(1)",
                    }}
                  >
                    {approved ? t("landingV4.opWorking") : t("landingV4.opApprove")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Escribe un texto letra por letra. Cuando `run` es falso lo muestra entero:
 * así el reparto no espera a que termine de tipear, y con movimiento reducido
 * no se mueve nada.
 */
function Typed({ text, run }: { text: string; run: boolean }) {
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
    }, 55);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [run, text]);

  // Fuera del paso de tipeo el texto va entero: el reparto no tiene por qué
  // esperar a que termine de escribirse.
  const shown = run ? text.slice(0, n) : text;

  return (
    <>
      {shown}
      {run && n < text.length && (
        <span aria-hidden style={{ opacity: 0.6 }}>
          |
        </span>
      )}
    </>
  );
}
