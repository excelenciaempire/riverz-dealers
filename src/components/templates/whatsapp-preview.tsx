'use client';

/* Los hex sueltos de este archivo (#ece5dd, #111b21, #dcf8c6, #667781…) son
 * el cromo REAL de WhatsApp, no un descuido del sistema de temas. La vista
 * previa tiene que verse como el teléfono del cliente, así que no siguen el
 * modo claro/oscuro ni se cambian por tokens. */

import { FileText, Image as ImageIcon, Video, Reply, ExternalLink, Phone } from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import type {
  TemplateHeaderType,
  TemplateButtonInput,
} from '@/lib/whatsapp/template-components';

interface WhatsappPreviewProps {
  headerType: TemplateHeaderType;
  headerText?: string;
  bodyText: string;
  /** Tramos de `bodyText` que vienen del ejemplo de una variable. Se pintan
   *  resaltados para que "los valores resaltados son ejemplos" sea literal. */
  bodyHighlights?: Array<{ start: number; end: number }>;
  footerText?: string;
  buttons?: TemplateButtonInput[];
}

/**
 * Destino real de un botón para el preview. Un botón URL dinámico (carrito,
 * tracking…) recibe su link por cliente recién al enviar, así que no tiene
 * destino acá y se deja sin enlazar.
 */
function buttonHref(b: TemplateButtonInput): string | null {
  if (b.type === 'PHONE_NUMBER') {
    const phone = (b.phone_number ?? '').replace(/[^\d+]/g, '');
    return phone ? `tel:${phone}` : null;
  }
  if (b.type !== 'URL' || b.url_variable) return null;
  const url = (b.url ?? '').trim();
  // Un {{n}} sin resolver no es un destino navegable.
  if (!url || /\{\{\s*\d+\s*\}\}/.test(url)) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Cuerpo con los tramos de ejemplo resaltados (el resto, texto plano). */
function renderBody(
  body: string,
  highlights?: Array<{ start: number; end: number }>,
): React.ReactNode {
  if (!highlights || highlights.length === 0) return body;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  highlights.forEach((h, i) => {
    if (h.start > cursor) parts.push(body.slice(cursor, h.start));
    parts.push(
      <mark
        key={i}
        className="rounded bg-[#fff3c4] px-0.5 text-[#111b21]"
      >
        {body.slice(h.start, h.end)}
      </mark>,
    );
    cursor = h.end;
  });
  if (cursor < body.length) parts.push(body.slice(cursor));
  return parts;
}

const MEDIA_ICON: Record<string, React.ReactNode> = {
  image: <ImageIcon className="h-8 w-8 text-white/70" />,
  video: <Video className="h-8 w-8 text-white/70" />,
  document: <FileText className="h-8 w-8 text-white/70" />,
};

/**
 * Live WhatsApp-style preview of the template being built — the phone mockup
 * on the right of the builder. Mirrors WhatsApp's chat chrome (teal header,
 * patterned beige canvas, white outgoing-style bubble with a double check).
 * Renders {{1}} placeholders verbatim so the user sees exactly where
 * variables land.
 */
export function WhatsappPreview({
  headerType,
  headerText,
  bodyText,
  bodyHighlights,
  footerText,
  buttons,
}: WhatsappPreviewProps) {
  const t = useT();
  const activeButtons = (buttons ?? []).filter((b) => b.text?.trim());

  return (
    <div className="mx-auto w-full max-w-[360px]">
      {/* Phone frame */}
      <div className="overflow-hidden rounded-[2.25rem] border-[7px] border-foreground/90 bg-[#0b141a] shadow-2xl">
        {/* Chat header */}
        <div className="flex items-center gap-2 bg-[#075e54] px-4 py-3">
          <div className="h-8 w-8 rounded-full bg-white/20" />
          <div className="text-sm font-medium text-white">{t('templates.yourBusiness')}</div>
        </div>

        {/* Canvas */}
        <div
          className="min-h-[460px] px-3 py-4"
          style={{
            backgroundColor: '#e5ddd5',
            backgroundImage:
              'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)',
            backgroundSize: '14px 14px',
          }}
        >
          {/* Incoming-style bubble (template render) */}
          <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-2.5 py-2 shadow-sm">
            {/* Header */}
            {headerType === 'text' && headerText?.trim() && (
              <p className="mb-1 text-[13px] font-semibold text-[#111b21]">
                {headerText}
              </p>
            )}
            {(headerType === 'image' ||
              headerType === 'video' ||
              headerType === 'document') && (
              <div className="mb-1.5 flex h-24 items-center justify-center rounded-md bg-[#ccd0d5]">
                {MEDIA_ICON[headerType]}
              </div>
            )}

            {/* Body */}
            <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-[#111b21]">
              {bodyText.trim() ? (
                renderBody(bodyText, bodyHighlights)
              ) : (
                <span className="text-[#667781]">{t('templates.messageAppearsHere')}</span>
              )}
            </p>

            {/* Footer */}
            {footerText?.trim() && (
              <p className="mt-1 text-[11px] text-[#667781]">{footerText}</p>
            )}

            {/* Timestamp + double check */}
            <div className="mt-1 flex items-center justify-end gap-1">
              <span className="text-[10px] text-[#667781]">12:00</span>
              <svg viewBox="0 0 16 11" className="h-3 w-3 fill-[#53bdeb]">
                <path d="M11.07.65a.5.5 0 0 0-.7.02L5.3 6.05 3.4 4.1a.5.5 0 1 0-.72.7l2.26 2.3a.5.5 0 0 0 .72 0L11.1 1.36a.5.5 0 0 0-.03-.71Z" />
                <path d="M15.07.65a.5.5 0 0 0-.7.02L9.3 6.05l-.5-.5a.5.5 0 0 0-.72.7l.86.88a.5.5 0 0 0 .72 0L15.1 1.36a.5.5 0 0 0-.03-.71Z" />
              </svg>
            </div>
          </div>

          {/* Buttons render as separate tappable rows under the bubble.
              Los que tienen destino real se abren de verdad al hacer clic. */}
          {activeButtons.length > 0 && (
            <div className="mt-1 max-w-[85%] space-y-0.5">
              {activeButtons.map((b, i) => {
                const icon =
                  b.type === 'URL' ? (
                    <ExternalLink className="h-3.5 w-3.5" />
                  ) : b.type === 'PHONE_NUMBER' ? (
                    <Phone className="h-3.5 w-3.5" />
                  ) : (
                    <Reply className="h-3.5 w-3.5" />
                  );
                const cls =
                  'flex items-center justify-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[13px] font-medium text-[#00a5f4] shadow-sm';
                const href = buttonHref(b);
                if (href) {
                  return (
                    <a
                      key={i}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${cls} hover:bg-white/80`}
                    >
                      {icon}
                      {b.text}
                    </a>
                  );
                }
                return (
                  <div key={i} className={cls}>
                    {icon}
                    {b.text}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
