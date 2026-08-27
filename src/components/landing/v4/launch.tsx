"use client";

import Image from "next/image";
import { useT } from "@/hooks/use-locale";
import { Label, Rise } from "./bits";

/**
 * Riverz Launch — la oferta.
 *
 * Es el argumento más fuerte que tenemos y no estaba en la página. La
 * investigación de mercado lo dice sin vueltas: la objeción más grande del
 * avatar no es el precio ni la IA, es «integrarlo va a ser otro proyecto de
 * meses». Contra eso, la oferta responde tres veces: no lo configuras vos, no
 * cuesta la instalación, y el pago empieza cuando ya esté demostrando valor.
 *
 * Va como una lista numerada grande sobre papel, con la foto al costado. Cinco
 * pasos, sin adornos: cada uno es una frase que se entiende sola.
 */

const PASOS = [
  { t: "landingV4.launch1Title", b: "landingV4.launch1Body" },
  { t: "landingV4.launch2Title", b: "landingV4.launch2Body" },
  { t: "landingV4.launch3Title", b: "landingV4.launch3Body" },
  { t: "landingV4.launch4Title", b: "landingV4.launch4Body" },
  { t: "landingV4.launch5Title", b: "landingV4.launch5Body" },
] as const;

export function Launch() {
  const t = useT();

  return (
    <section id="launch" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 lg:py-24">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <Rise className="min-w-0">
          <Label>{t("landingV4.launchLabel")}</Label>
          <h2 className="sn-h2 mt-5 max-w-[14ch]">{t("landingV4.launchTitle")}</h2>
          <p className="sn-body mt-5 max-w-[44ch]">{t("landingV4.launchBody")}</p>

          {/* La foto ancla el bloque y le da al papel algo que no sea texto. */}
          <div className="relative mt-10 hidden aspect-[3/2] w-full overflow-hidden rounded-[22px] lg:block">
            <Image
              src="/portada-b/launch.jpg"
              alt=""
              fill
              sizes="45vw"
              className="object-cover"
            />
          </div>
        </Rise>

        <Rise className="min-w-0" delay={90}>
          <ol className="min-w-0">
            {PASOS.map((p, i) => (
              <li
                key={p.t}
                className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1 border-t py-6 sm:gap-x-7"
                style={{ borderColor: "var(--sn-line)" }}
              >
                {/* El número en la serif grande: es una lista de pasos, y se
                    tiene que leer como una lista de pasos. */}
                <span
                  className="row-span-2 font-[family-name:var(--font-editorial)] text-[clamp(30px,3vw,44px)] leading-none"
                  style={{ color: "var(--sn-tan)" }}
                >
                  {i + 1}
                </span>
                <h3 className="sn-h3 !text-[clamp(19px,1.7vw,24px)]">{t(p.t)}</h3>
                <p className="sn-body max-w-[44ch] !text-[15px]">{t(p.b)}</p>
              </li>
            ))}
          </ol>
        </Rise>
      </div>
    </section>
  );
}
