"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/hooks/use-locale";
import {
  AgentPanel,
  HeroInbox,
  InboxPreview,
  useReducedMotion,
} from "@/components/landing/landing";
import { Rule } from "./primitives";

/**
 * [03] El turno — el escenario negro.
 *
 * La sección se fija a la pantalla mientras se recorren tres actos: llega el
 * mensaje, el agente responde, el pedido queda creado. Los paneles no se
 * apilan: se apoyan en una mesa que se aleja (`rotateX`), y el acto activo se
 * adelanta. Es la lección de jesperlandberg.com —jerarquía por profundidad,
 * no por tamaño de caja— hecha con transformaciones CSS, sin WebGL ni una
 * dependencia nueva.
 *
 * La mesa también se puede arrastrar de lado: el scroll de la página elige el
 * acto, pero si la persona desliza, manda ella y el scroll deja de corregir.
 */

const ACTS = [
  { title: "landingV3.stageAct1Title", body: "landingV3.stageAct1Body", Panel: InboxPreview },
  { title: "landingV3.stageAct2Title", body: "landingV3.stageAct2Body", Panel: HeroInbox },
  { title: "landingV3.stageAct3Title", body: "landingV3.stageAct3Body", Panel: AgentPanel },
] as const;

export function Stage() {
  const t = useT();
  const reduced = useReducedMotion();
  const outer = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [act, setAct] = useState(0);
  // Mientras la persona arrastra, el scroll de la página no le corrige la
  // posición: se sentiría como un forcejeo.
  const dragging = useRef(0);

  // Acto activo según cuánto se avanzó dentro de la sección fija.
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
      setAct(Math.min(ACTS.length - 1, Math.floor(p * ACTS.length)));
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

  // Llevar la mesa al acto activo, salvo que la estén arrastrando.
  useEffect(() => {
    const el = track.current;
    if (!el || Date.now() < dragging.current) return;
    const card = el.children[act] as HTMLElement | undefined;
    if (!card) return;
    el.scrollTo({
      left: card.offsetLeft - (el.clientWidth - card.clientWidth) / 2,
      behavior: reduced ? "auto" : "smooth",
    });
  }, [act, reduced]);

  const held = () => {
    dragging.current = Date.now() + 2500;
  };

  return (
    // Sin `overflow-hidden` en la sección: un ancestro que recorta convierte
    // al `sticky` de adentro en un pegado a esa caja y la escena deja de
    // clavarse a la pantalla. El recorte va en `.pl-scene-in`.
    <section
      ref={outer}
      className="pl-stage pl-grain pl-scene relative"
      aria-label={t("landingV3.stageRuleLeft")}
    >
      <div className="pl-scene-in flex flex-col overflow-hidden">
        <div aria-hidden className="pl-floor" />

        <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 pt-6 pb-8 sm:pt-10">
          <Rule
            left={t("landingV3.stageRuleLeft")}
            right={t("landingV3.stageRuleRight")}
          />

          <div className="grid flex-1 items-center gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:gap-14">
            <div>
              <h2 className="pl-h2 max-w-[15ch]">
                {t("landingV3.stageTitleA")}{" "}
                <span className="pl-mark" data-lit="true">
                  {t("landingV3.stageTitleMark")}
                </span>{" "}
                {t("landingV3.stageTitleB")}
              </h2>

              <ol className="mt-8 space-y-0 sm:mt-10">
                {ACTS.map((a, i) => (
                  <li
                    key={a.title}
                    className="pl-act border-t py-4"
                    data-on={i === act}
                    style={{ borderColor: "var(--pl-line-stage)" }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        held();
                        setAct(i);
                      }}
                      className="flex w-full items-baseline gap-4 text-left"
                    >
                      <span
                        className="pl-mono shrink-0"
                        style={{ color: i === act ? "var(--pl-acid)" : undefined }}
                      >
                        {`0${i + 1}`}
                      </span>
                      <span className="min-w-0">
                        <span className="pl-h2 block !text-[clamp(20px,2.2vw,28px)]">
                          {t(a.title)}
                        </span>
                        <span className="pl-body mt-1 block !text-[15px]">
                          {t(a.body)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>

            {/* La mesa */}
            <div className="pl-table min-w-0">
              <div
                ref={track}
                onPointerDown={held}
                onWheel={held}
                className="flex snap-x snap-mandatory gap-6 overflow-x-auto px-[6vw] pb-10 pt-4 lg:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {ACTS.map((a, i) => (
                  <div
                    key={a.title}
                    data-active={i === act}
                    data-on={i === act}
                    className="pl-plank pl-panel w-[78vw] max-w-[440px] shrink-0 snap-center rounded-2xl"
                  >
                    <a.Panel />
                  </div>
                ))}
              </div>
              <p className="pl-mono px-[6vw] lg:px-8" style={{ color: "var(--pl-stage-soft)" }}>
                {t("landingV3.stageHint")}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
