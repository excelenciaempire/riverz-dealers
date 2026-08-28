"use client";

import { Check } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import {
  AgentPanel,
  CartRecoveryPanel,
  HeroInbox,
  MetricsPreview,
  SupportPreview,
} from "@/components/landing/landing";
import { Label, Rise } from "./bits";

/**
 * Cómo trabaja — el mecanismo, en cinco pasos.
 *
 * Este es el argumento que separa a Riverz de la categoría entera: **un
 * chatbot termina cuando responde; Riverz recién termina cuando la venta
 * avanzó o cuando la conversación quedó en manos de la persona correcta.**
 *
 * Antes esto era una escena clavada de 500vh donde los cinco pasos se cruzaban
 * en el mismo lugar al scrollear. Se fue por dos motivos. Uno: cinco pantallas
 * de scroll para leer cinco párrafos es un peaje, y quien no scrollea hasta el
 * final se lleva uno de cinco. Dos: ya hay una escena clavada en la página —el
 * Operator— y dos seguidas dejan de ser un recurso para ser un tic. Apilados,
 * los cinco se ven de una y se pueden comparar de un vistazo.
 *
 * Tampoco se llama «Loop» en ningún lado. Era un nombre interno: nadie que
 * entra por primera vez sabe qué es un loop, y una portada no es el lugar para
 * enseñar vocabulario propio.
 */

const PASOS = [
  {
    n: "01",
    title: "landingV4.loop1Title",
    body: "landingV4.loop1Body",
    points: ["landingV4.loop1P1", "landingV4.loop1P2", "landingV4.loop1P3"],
    Panel: HeroInbox,
  },
  {
    n: "02",
    title: "landingV4.loop2Title",
    body: "landingV4.loop2Body",
    points: ["landingV4.loop2P1", "landingV4.loop2P2", "landingV4.loop2P3"],
    Panel: AgentPanel,
  },
  {
    n: "03",
    title: "landingV4.loop3Title",
    body: "landingV4.loop3Body",
    points: ["landingV4.loop3P1", "landingV4.loop3P2", "landingV4.loop3P3"],
    Panel: SupportPreview,
  },
  {
    n: "04",
    title: "landingV4.loop4Title",
    body: "landingV4.loop4Body",
    points: ["landingV4.loop4P1", "landingV4.loop4P2", "landingV4.loop4P3"],
    Panel: CartRecoveryPanel,
  },
  {
    n: "05",
    title: "landingV4.loop5Title",
    body: "landingV4.loop5Body",
    points: ["landingV4.loop5P1", "landingV4.loop5P2", "landingV4.loop5P3"],
    Panel: MetricsPreview,
  },
] as const;

export function Scene() {
  const t = useT();

  return (
    <section id="loop" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 lg:py-24">
      <Rise>
        <Label>{t("landingV4.loopLabel")}</Label>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 className="sn-h2 max-w-[16ch]">{t("landingV4.loopTitle")}</h2>
          <p className="sn-body max-w-[44ch] !text-[15px]">{t("landingV4.loopLead")}</p>
        </div>
      </Rise>

      <div className="mt-14 space-y-14 lg:mt-20 lg:space-y-24">
        {PASOS.map((a, i) => (
          <Rise key={a.n} delay={60}>
            <div
              className={`grid min-w-0 items-center gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14 ${
                // Se alterna el lado de la vista previa. Cinco filas idénticas
                // con el texto siempre a la izquierda se leen como un
                // formulario; alternadas, el ojo vuelve a mirar.
                i % 2 ? "lg:[&>*:first-child]:order-2" : ""
              }`}
            >
              <div>
                <p className="sn-label mb-4">{a.n}</p>
                <h3 className="sn-h2 max-w-[13ch] !text-[clamp(26px,3vw,42px)]">{t(a.title)}</h3>
                <p className="sn-body mt-4 max-w-[42ch]">{t(a.body)}</p>
                <ul className="mt-6 space-y-3">
                  {a.points.map((p) => (
                    <li key={p} className="flex items-start gap-3">
                      <span
                        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
                        style={{ background: "var(--sn-accent)" }}
                      >
                        <Check className="size-3" style={{ color: "var(--sn-ink)" }} />
                      </span>
                      <span className="sn-body !text-[15px]">{t(p)}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* min-w-0: la vista previa tiene un ancho mínimo propio y sin
                  esto estira la celda por encima del ancho de la pantalla. */}
              <div className="sn-card sn-panel min-w-0 overflow-x-auto p-3 sm:p-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <a.Panel />
              </div>
            </div>
          </Rise>
        ))}
      </div>
    </section>
  );
}
