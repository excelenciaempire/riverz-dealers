'use client';

import {
  FileText,
  Image as ImageIcon,
  Video as VideoIcon,
  ExternalLink,
  List,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Mini WhatsApp message bubble — rendered inside every flow node card
 * that produces a customer-facing message (send_message, send_buttons,
 * send_list, send_cta_url, media). Mirrors WhatsApp's incoming-bubble
 * chrome (white card, double check, beige canvas tint) so the merchant
 * sees exactly what the customer will see.
 *
 * Kept narrow on purpose — the bubble is decorative-but-honest, not a
 * full chat simulator. Quick Reply buttons enforce Meta's 3-max and
 * 20-char title cap visually (extra titles truncate with ellipsis).
 */

export type BubbleKind =
  | 'text'
  | 'buttons'
  | 'list'
  | 'cta_url'
  | 'image'
  | 'video'
  | 'document';

interface BubbleButton {
  title: string;
}

interface BubbleListRow {
  title: string;
  description?: string;
}

interface WhatsappBubblePreviewProps {
  kind: BubbleKind;
  text?: string;
  /** For buttons (≤3 — Meta cap). */
  buttons?: BubbleButton[];
  /** For list — flattened rows across all sections (≤10 total). */
  listRows?: BubbleListRow[];
  /** For list — visible label on the tap-to-expand chip. */
  listButtonLabel?: string;
  /** For cta_url — visible button label. */
  ctaTitle?: string;
  /** For cta_url — URL the chip points at (rendered as small hint). */
  ctaUrl?: string;
  /** For media — public preview URL. */
  mediaUrl?: string;
  /** For media — optional caption shown beneath the asset. */
  caption?: string;
  /** For document — filename shown to the recipient. */
  filename?: string;
}

const BG = '#e5ddd5'; // WhatsApp chat canvas (light beige)
const BUBBLE = '#ffffff';
const META = '#667781';
const TITLE = '#111b21';
const LINK = '#00a5f4';

export function WhatsappBubblePreview(props: WhatsappBubblePreviewProps) {
  const text = (props.text ?? '').trim();
  return (
    <div
      className="space-y-1.5 rounded-md p-2"
      style={{
        backgroundColor: BG,
        backgroundImage:
          'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)',
        backgroundSize: '10px 10px',
      }}
    >
      <Bubble>
        {props.kind === 'image' && (
          <MediaPlaceholder kind="image" url={props.mediaUrl} />
        )}
        {props.kind === 'video' && (
          <MediaPlaceholder kind="video" url={props.mediaUrl} />
        )}
        {props.kind === 'document' && (
          <DocumentRow filename={props.filename} />
        )}

        {text ? (
          <p
            className="whitespace-pre-wrap break-words text-[11px] leading-snug"
            style={{ color: TITLE }}
          >
            {text}
          </p>
        ) : (
          <p className="text-[11px] italic" style={{ color: META }}>
            (mensaje vacío)
          </p>
        )}

        {props.caption && (
          <p
            className="mt-0.5 whitespace-pre-wrap break-words text-[10px] leading-snug"
            style={{ color: META }}
          >
            {props.caption}
          </p>
        )}

        {/* List trigger button — sits INSIDE the bubble */}
        {props.kind === 'list' && (
          <div
            className="mt-1 flex items-center justify-center gap-1.5 rounded-md py-1 text-[11px] font-medium"
            style={{ color: LINK, backgroundColor: '#f0f2f5' }}
          >
            <List className="h-3 w-3" />
            {(props.listButtonLabel ?? 'Ver opciones').slice(0, 20)}
          </div>
        )}

        <Meta />
      </Bubble>

      {/* Reply / cta_url buttons render as their own bubbles below */}
      {props.kind === 'buttons' && (props.buttons ?? []).length > 0 && (
        <div className="space-y-0.5">
          {(props.buttons ?? []).slice(0, 3).map((b, i) => (
            <div
              key={i}
              className="flex items-center justify-center rounded-md bg-white px-2 py-1 text-[11px] font-medium shadow-sm"
              style={{ color: LINK }}
              title={b.title}
            >
              {(b.title || 'Botón').slice(0, 20)}
            </div>
          ))}
        </div>
      )}

      {props.kind === 'cta_url' && props.ctaTitle && (
        <div
          className="flex items-center justify-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] font-medium shadow-sm"
          style={{ color: LINK }}
          title={props.ctaUrl}
        >
          <ExternalLink className="h-3 w-3" />
          {props.ctaTitle.slice(0, 20)}
        </div>
      )}

      {/* List rows preview — collapsed below the bubble for honesty */}
      {props.kind === 'list' && (props.listRows ?? []).length > 0 && (
        <div className="space-y-0.5 rounded-md bg-white px-1.5 py-1 shadow-sm">
          {(props.listRows ?? []).slice(0, 4).map((r, i) => (
            <div key={i} className="border-b border-black/5 py-0.5 last:border-b-0">
              <p className="text-[10px] font-medium" style={{ color: TITLE }}>
                {(r.title || 'Opción').slice(0, 24)}
              </p>
              {r.description && (
                <p className="text-[9px]" style={{ color: META }}>
                  {r.description.slice(0, 72)}
                </p>
              )}
            </div>
          ))}
          {(props.listRows ?? []).length > 4 && (
            <p
              className="px-0.5 py-0.5 text-[9px]"
              style={{ color: META }}
            >
              + {(props.listRows ?? []).length - 4} más…
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="max-w-full rounded-md rounded-tl-none px-2 py-1.5 shadow-sm"
      style={{ backgroundColor: BUBBLE }}
    >
      {children}
    </div>
  );
}

function Meta() {
  return (
    <div className="mt-0.5 flex items-center justify-end gap-0.5">
      <span className="text-[9px]" style={{ color: META }}>
        12:00
      </span>
      <svg viewBox="0 0 16 11" className="h-2.5 w-2.5 fill-[#53bdeb]">
        <path d="M11.07.65a.5.5 0 0 0-.7.02L5.3 6.05 3.4 4.1a.5.5 0 1 0-.72.7l2.26 2.3a.5.5 0 0 0 .72 0L11.1 1.36a.5.5 0 0 0-.03-.71Z" />
        <path d="M15.07.65a.5.5 0 0 0-.7.02L9.3 6.05l-.5-.5a.5.5 0 0 0-.72.7l.86.88a.5.5 0 0 0 .72 0L15.1 1.36a.5.5 0 0 0-.03-.71Z" />
      </svg>
    </div>
  );
}

function MediaPlaceholder({
  kind,
  url,
}: {
  kind: 'image' | 'video';
  url?: string;
}) {
  const Icon = kind === 'image' ? ImageIcon : VideoIcon;
  return (
    <div
      className={cn(
        'mb-1 flex h-14 items-center justify-center rounded',
        'bg-[#ccd0d5]',
      )}
    >
      {url ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={url}
          alt=""
          className="h-full w-full rounded object-cover"
        />
      ) : (
        <Icon className="h-5 w-5 text-white/70" />
      )}
    </div>
  );
}

function DocumentRow({ filename }: { filename?: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 rounded bg-[#f0f2f5] px-1.5 py-1">
      <FileText className="h-3.5 w-3.5" style={{ color: META }} />
      <span
        className="truncate text-[10px] font-medium"
        style={{ color: TITLE }}
      >
        {filename || 'archivo.pdf'}
      </span>
    </div>
  );
}
