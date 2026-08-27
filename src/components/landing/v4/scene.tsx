"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useT } from "@/hooks/use-locale";
import {
  AgentPanel,
  CartRecoveryPanel,
  HeroInbox,
  MetricsPreview,
  SupportPreview,
} from "@/components/landing/landing";
import { Label } from "./bits";

/**
 * Riverz Loop — el mecanismo, en cinco actos.
 *
 * Este es el argumento que separa a Riverz de la categoría entera, y sale
 * derecho de la investigación de mercado: **un chatbot termina cuando
 * responde; el Loop termina cuando la oportunidad avanzó o quedó en manos de
 * la persona correcta.** Los cinco pasos son los del documento —detecta la
 * señal, entiende el contexto, decide el siguiente paso, ejecuta, cierra el
 * ciclo— y no una versión aguada.
 *
 * En pantalla grande la sección se clava y los actos se cruzan en el mismo
 * lugar a medida que se scrollea. En el teléfono no se clava nada —la escena
 * entera no entra— y los cinco se leen uno debajo del otro.
 */

const ACTOS = [
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
  const outer = useRef<HTMLElement>(null);
  const [act, setAct] = useState(0);

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      if (span <= 0) return;
      const p = Math.min(1, Math.max(0, -r.top / span));
      setAct(Math.min(ACTOS.length - 1, Math.floor(p * ACTOS.length)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section ref={outer} id="loop" className="sn-scene relative scroll-mt-24">
      <div className="sn-scene-in">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 lg:py-0">
          <div className="mb-8 lg:mb-10">
            <Label>{t("landingV4.loopLabel")}</Label>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
              <h2 className="sn-h2 max-w-[16ch]">{t("landingV4.loopTitle")}</h2>
              <p className="sn-body max-w-[44ch] !text-[15px]">{t("landingV4.loopLead")}</p>
            </div>
            {/* Cinco tramos: el que va lleno dice en qué paso estamos. */}
            <div className="mt-7 hidden gap-1.5 lg:flex" aria-hidden>
              {ACTOS.map((a, i) => (
                <span key={a.n} className="sn-tick flex-1" data-on={i <= act}>
                  <i />
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-12 lg:grid lg:gap-0">
            {ACTOS.map((a, i) => (
              <div
                key={a.n}
                className="sn-act grid min-w-0 items-center gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14"
                data-on={i === act}
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
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
