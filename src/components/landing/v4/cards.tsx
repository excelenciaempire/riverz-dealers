"use client";

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
import { Rise } from "./bits";

/**
 * Qué hace — las trece fichas.
 *
 * Son EXACTAMENTE las trece funciones de la portada principal, en su orden y
 * con sus palabras: los textos salen del catálogo `landing`, no de uno propio.
 * Si mañana se corrige el nombre de una función, se corrige en un solo lugar y
 * las tres portadas quedan iguales.
 *
 * Crema sobre crema, esquina generosa y sin borde: la ficha se despega del
 * fondo por tono, no por línea.
 */

const CARDS = [
  { title: "landing.sec01Title", muted: "landing.sec01TitleMuted", body: "landing.sec01Body", Panel: AgentPanel },
  { title: "landing.sec02Title", muted: "landing.sec02TitleMuted", body: "landing.sec02Body", Panel: CartRecoveryPanel },
  { title: "landing.sec03Title", muted: "landing.sec03TitleMuted", body: "landing.sec03Body", Panel: FlowPreview },
  { title: "landing.sec04Title", muted: "landing.sec04TitleMuted", body: "landing.sec04Body", Panel: SupportPreview },
  { title: "landing.secVoiceTitle", muted: "landing.secVoiceTitleMuted", body: "landing.secVoiceBody", Panel: CallPreview },
  { title: "landing.sec05Title", muted: "landing.sec05TitleMuted", body: "landing.sec05Body", Panel: CommentsPreview },
  { title: "landing.sec06Title", muted: "landing.sec06TitleMuted", body: "landing.sec06Body", Panel: CampaignPreview },
  { title: "landing.sec07Title", muted: "landing.sec07TitleMuted", body: "landing.sec07Body", Panel: InboxPreview },
  { title: "landing.secLiveTitle", muted: "landing.secLiveTitleMuted", body: "landing.secLiveBody", Panel: LivePreview },
  { title: "landing.secContactsTitle", muted: "landing.secContactsTitleMuted", body: "landing.secContactsBody", Panel: ContactsPreview },
  { title: "landing.sec08Title", muted: "landing.sec08TitleMuted", body: "landing.sec08Body", Panel: ProductPreview },
  { title: "landing.sec09Title", muted: "landing.sec09TitleMuted", body: "landing.sec09Body", Panel: SetupPreview },
  { title: "landing.sec10Title", muted: "landing.sec10TitleMuted", body: "landing.sec10Body", Panel: MetricsPreview },
] as const;

export function Cards() {
  const t = useT();
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:gap-6">
      {CARDS.map((c, i) => (
        <Rise key={c.title} delay={(i % 2) * 90} className="min-w-0">
          <article className="sn-card flex h-full min-w-0 flex-col overflow-hidden p-5 sm:p-8">
            <h3 className="sn-h3 max-w-[20ch]">
              {t(c.title)} <span style={{ color: "var(--sn-muted)" }}>{t(c.muted)}</span>
            </h3>
            <p className="sn-body mt-3 max-w-[46ch] !text-[15px]">{t(c.body)}</p>
            {/* min-w-0 en la celda, en la ficha y acá: sin eso, el ancho
                mínimo del contenido de la vista previa estira la celda de la
                cuadrícula por encima del ancho de la pantalla, y el párrafo de
                arriba sale cortado. Si aun así no entra, la vista previa se
                desliza sola en vez de empujar la ficha. */}
            <div className="sn-panel mt-7 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <c.Panel />
            </div>
          </article>
        </Rise>
      ))}
    </div>
  );
}
