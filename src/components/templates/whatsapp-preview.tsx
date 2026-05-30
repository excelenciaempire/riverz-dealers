'use client';

import { FileText, Image as ImageIcon, Video, Reply, ExternalLink, Phone } from 'lucide-react';
import type {
  TemplateHeaderType,
  TemplateButtonInput,
} from '@/lib/whatsapp/template-components';

interface WhatsappPreviewProps {
  headerType: TemplateHeaderType;
  headerText?: string;
  bodyText: string;
  footerText?: string;
  buttons?: TemplateButtonInput[];
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
  footerText,
  buttons,
}: WhatsappPreviewProps) {
  const activeButtons = (buttons ?? []).filter((b) => b.text?.trim());

  return (
    <div className="mx-auto w-full max-w-[360px]">
      {/* Phone frame */}
      <div className="overflow-hidden rounded-[2.25rem] border-[7px] border-foreground/90 bg-[#0b141a] shadow-2xl">
        {/* Chat header */}
        <div className="flex items-center gap-2 bg-[#075e54] px-4 py-3">
          <div className="h-8 w-8 rounded-full bg-white/20" />
          <div className="text-sm font-medium text-white">Tu negocio</div>
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
              {bodyText.trim() || (
                <span className="text-[#667781]">
                  El cuerpo de tu mensaje aparecerá aquí…
                </span>
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

          {/* Buttons render as separate tappable rows under the bubble */}
          {activeButtons.length > 0 && (
            <div className="mt-1 max-w-[85%] space-y-0.5">
              {activeButtons.map((b, i) => (
                <div
                  key={i}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[13px] font-medium text-[#00a5f4] shadow-sm"
                >
                  {b.type === 'URL' ? (
                    <ExternalLink className="h-3.5 w-3.5" />
                  ) : b.type === 'PHONE_NUMBER' ? (
                    <Phone className="h-3.5 w-3.5" />
                  ) : (
                    <Reply className="h-3.5 w-3.5" />
                  )}
                  {b.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
