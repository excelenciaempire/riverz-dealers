"use client";

import { useT } from "@/hooks/use-locale";
import {
  CallPreview,
  CampaignPreview,
  CommentsPreview,
  ContactsPreview,
  InboxPreview,
  MetricsPreview,
  SupportPreview,
  FlowPreview,
} from "@/components/landing/landing";
import { Rise } from "./bits";

/**
 * Capacidades — la cuadrícula de fichas.
 *
 * Crema sobre crema, esquina generosa y sin borde: la ficha se despega del
 * fondo por tono, no por línea. Los textos salen del catálogo `landing`, el
 * mismo que usa la portada actual, para que corregir el nombre de una función
 * no obligue a corregirlo dos veces.
 */

const CARDS = [
  { title: "landing.sec04Title", muted: "landing.sec04TitleMuted", body: "landing.sec04Body", Panel: SupportPreview },
  { title: "landing.secVoiceTitle", muted: "landing.secVoiceTitleMuted", body: "landing.secVoiceBody", Panel: CallPreview },
  { title: "landing.sec05Title", muted: "landing.sec05TitleMuted", body: "landing.sec05Body", Panel: CommentsPreview },
  { title: "landing.sec06Title", muted: "landing.sec06TitleMuted", body: "landing.sec06Body", Panel: CampaignPreview },
  { title: "landing.sec03Title", muted: "landing.sec03TitleMuted", body: "landing.sec03Body", Panel: FlowPreview },
  { title: "landing.secContactsTitle", muted: "landing.secContactsTitleMuted", body: "landing.secContactsBody", Panel: ContactsPreview },
  { title: "landing.sec07Title", muted: "landing.sec07TitleMuted", body: "landing.sec07Body", Panel: InboxPreview },
  { title: "landing.sec10Title", muted: "landing.sec10TitleMuted", body: "landing.sec10Body", Panel: MetricsPreview },
] as const;

export function Cards() {
  const t = useT();
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:gap-6">
      {CARDS.map((c, i) => (
        <Rise key={c.title} delay={(i % 2) * 90}>
          <article className="sn-card flex h-full flex-col overflow-hidden p-6 sm:p-8">
            <h3 className="sn-h3 max-w-[20ch]">
              {t(c.title)} <span style={{ color: "var(--sn-muted)" }}>{t(c.muted)}</span>
            </h3>
            <p className="sn-body mt-3 max-w-[46ch] !text-[15px]">{t(c.body)}</p>
            <div className="sn-panel mt-7">
              <c.Panel />
            </div>
          </article>
        </Rise>
      ))}
    </div>
  );
}
