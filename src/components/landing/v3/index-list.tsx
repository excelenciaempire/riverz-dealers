"use client";

import { useState } from "react";
import { useT } from "@/hooks/use-locale";
import {
  AgentPanel,
  CallPreview,
  CampaignPreview,
  CartRecoveryPanel,
  CommentsPreview,
  ContactsPreview,
  FlowPreview,
  InboxPreview,
  LivePreview,
  MetricsPreview,
  ProductPreview,
  SetupPreview,
  SupportPreview,
} from "@/components/landing/landing";

/**
 * [04] Índice — las trece funciones en trece renglones.
 *
 * La portada vieja les daba una sección entera a cada una: trece pantallas
 * seguidas que dicen «tenemos muchas cosas». Acá son una lista tipográfica y
 * la vista previa aparece al lado, en un panel que no se mueve. Las trece
 * vistas previas son las mismas de siempre, importadas tal cual.
 *
 * Los títulos salen del catálogo `landing`, no de `landingV3`: si mañana se
 * corrige el nombre de una función, se corrige en un solo lugar.
 */

const ROWS = [
  { n: "01", title: "landing.sec01Title", muted: "landing.sec01TitleMuted", Panel: AgentPanel },
  { n: "02", title: "landing.sec02Title", muted: "landing.sec02TitleMuted", Panel: CartRecoveryPanel },
  { n: "03", title: "landing.sec03Title", muted: "landing.sec03TitleMuted", Panel: FlowPreview },
  { n: "04", title: "landing.sec04Title", muted: "landing.sec04TitleMuted", Panel: SupportPreview },
  { n: "05", title: "landing.secVoiceTitle", muted: "landing.secVoiceTitleMuted", Panel: CallPreview },
  { n: "06", title: "landing.sec05Title", muted: "landing.sec05TitleMuted", Panel: CommentsPreview },
  { n: "07", title: "landing.sec06Title", muted: "landing.sec06TitleMuted", Panel: CampaignPreview },
  { n: "08", title: "landing.sec07Title", muted: "landing.sec07TitleMuted", Panel: InboxPreview },
  { n: "09", title: "landing.secLiveTitle", muted: "landing.secLiveTitleMuted", Panel: LivePreview },
  { n: "10", title: "landing.secContactsTitle", muted: "landing.secContactsTitleMuted", Panel: ContactsPreview },
  { n: "11", title: "landing.sec08Title", muted: "landing.sec08TitleMuted", Panel: ProductPreview },
  { n: "12", title: "landing.sec09Title", muted: "landing.sec09TitleMuted", Panel: SetupPreview },
  { n: "13", title: "landing.sec10Title", muted: "landing.sec10TitleMuted", Panel: MetricsPreview },
] as const;

export function IndexList() {
  const t = useT();
  const [on, setOn] = useState(0);
  // En pantalla chica no hay panel al costado: el renglón que se toca se abre
  // debajo y el resto queda cerrado.
  const [open, setOpen] = useState<number | null>(null);
  const Panel = ROWS[on].Panel;

  return (
    <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
      <ul className="min-w-0">
        {ROWS.map((r, i) => (
          <li key={r.n} className="pl-row" data-on={on === i}>
            <button
              type="button"
              onMouseEnter={() => setOn(i)}
              onFocus={() => setOn(i)}
              onClick={() => {
                setOn(i);
                setOpen(open === i ? null : i);
              }}
              aria-expanded={open === i}
              className="flex w-full items-baseline gap-4 px-2 py-4 text-left sm:gap-6 sm:py-5"
            >
              <span
                className="pl-mono shrink-0"
                style={{ color: on === i ? "var(--pl-acid-ink)" : undefined }}
              >
                {r.n}
              </span>
              <span className="pl-row-title pl-h2 min-w-0 !text-[clamp(20px,2.4vw,30px)]">
                {t(r.title)}{" "}
                <span style={{ color: "var(--pl-ink-soft)" }}>{t(r.muted)}</span>
              </span>
            </button>

            {open === i && (
              <div className="pl-panel mb-5 rounded-2xl lg:hidden">
                <r.Panel />
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* El panel del costado no se mueve mientras se recorre la lista. */}
      <div className="hidden lg:block">
        <div className="sticky top-24">
          <div className="pl-panel rounded-2xl">
            <Panel />
          </div>
        </div>
      </div>
    </div>
  );
}
