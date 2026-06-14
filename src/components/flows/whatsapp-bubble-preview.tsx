'use client';

import { useEffect, useRef } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Video as VideoIcon,
  ExternalLink,
  List,
  Plus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Mini WhatsApp message bubble — rendered como única vista de cada
 * nodo "mensaje" en el lienzo. Cuando `editable` está en true, el texto
 * y los labels de botones/filas pasan a ser inputs in-place; cualquier
 * cambio dispara los handlers correspondientes (onTextChange,
 * onButtonChange…) que escriben al config del nodo en flow-builder
 * via onUpdateConfig. Sin formularios paralelos, sin paneles abajo —
 * lo que ves es lo que el cliente va a ver, y lo editas ahí mismo.
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

export interface WhatsappBubblePreviewProps {
  kind: BubbleKind;
  text?: string;
  buttons?: BubbleButton[];
  listRows?: BubbleListRow[];
  listButtonLabel?: string;
  ctaTitle?: string;
  ctaUrl?: string;
  mediaUrl?: string;
  caption?: string;
  filename?: string;
  // ── Edición inline ──
  /** Activa el modo edición — el texto y los botones pasan a ser inputs. */
  editable?: boolean;
  onTextChange?: (text: string) => void;
  onCaptionChange?: (caption: string) => void;
  onMediaUrlChange?: (url: string) => void;
  onFilenameChange?: (filename: string) => void;
  onButtonChange?: (idx: number, title: string) => void;
  onAddButton?: () => void;
  onRemoveButton?: (idx: number) => void;
  onListLabelChange?: (label: string) => void;
  onListRowChange?: (
    rowIdx: number,
    patch: { title?: string; description?: string },
  ) => void;
  onAddListRow?: () => void;
  onRemoveListRow?: (rowIdx: number) => void;
  onCtaTitleChange?: (title: string) => void;
  onCtaUrlChange?: (url: string) => void;
  // ── Conexiones (drag-to-connect) ──
  /**
   * Cuando true, renderiza un "hueco" (port) en el borde derecho de
   * cada opción conectable (botones / filas de lista / botón CTA).
   * El user puede agarrar ese port y arrastrar a otro card para
   * crear la conexión.
   */
  connectablePorts?: boolean;
  /** Estado actual de cada conexión saliente; usado para marcar el
   *  port como "conectado" (lleno) o "vacío". */
  buttonConnected?: boolean[];
  listRowConnected?: boolean[];
  ctaConnected?: boolean;
  textConnected?: boolean;
  /** Disparado al apretar el mousedown sobre un port. El consumidor
   *  inicia un drag y maneja la conexión cuando se suelta el mouse. */
  onPortMouseDown?: (
    kind: "button" | "list_row" | "cta" | "text",
    idx: number,
    e: React.MouseEvent,
  ) => void;
}

const BG = '#e5ddd5';
const BUBBLE = '#ffffff';
const META = '#667781';
const TITLE = '#111b21';
const LINK = '#00a5f4';

export function WhatsappBubblePreview(props: WhatsappBubblePreviewProps) {
  const text = props.text ?? '';
  const editable = !!props.editable;

  // Tipos con UNA sola salida — el port va sobre el bubble principal.
  // Para "buttons" / "list" / "cta_url", el port vive en cada opción
  // (botón / fila / chip CTA) y este wrapper no muestra port suelto.
  const showSingleOutPort =
    props.connectablePorts &&
    (props.kind === 'text' ||
      props.kind === 'image' ||
      props.kind === 'video' ||
      props.kind === 'document');

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
      <div className="relative" data-port-kind="text">
        {showSingleOutPort && (
          <ConnectionPort
            connected={!!props.textConnected}
            onMouseDown={(e) => props.onPortMouseDown?.('text', 0, e)}
          />
        )}
      <Bubble>
        {props.kind === 'image' && (
          <MediaPlaceholder
            kind="image"
            url={props.mediaUrl}
            editable={editable}
            onUrlChange={props.onMediaUrlChange}
          />
        )}
        {props.kind === 'video' && (
          <MediaPlaceholder
            kind="video"
            url={props.mediaUrl}
            editable={editable}
            onUrlChange={props.onMediaUrlChange}
          />
        )}
        {props.kind === 'document' && (
          <DocumentRow
            filename={props.filename}
            editable={editable}
            onFilenameChange={props.onFilenameChange}
          />
        )}

        {/* Texto principal — el área editable más grande */}
        {editable ? (
          <BubbleTextarea
            value={text}
            placeholder={
              props.kind === 'image' ||
              props.kind === 'video' ||
              props.kind === 'document'
                ? 'Caption (opcional)…'
                : 'Escribe el mensaje…'
            }
            onChange={(v) => props.onTextChange?.(v)}
          />
        ) : text.trim() ? (
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

        {props.caption !== undefined &&
          (editable ? (
            <BubbleTextarea
              value={props.caption}
              placeholder="Caption (opcional)…"
              tiny
              onChange={(v) => props.onCaptionChange?.(v)}
            />
          ) : (
            props.caption.trim() && (
              <p
                className="mt-0.5 whitespace-pre-wrap break-words text-[10px] leading-snug"
                style={{ color: META }}
              >
                {props.caption}
              </p>
            )
          ))}

        {/* List trigger button — sits INSIDE the bubble */}
        {props.kind === 'list' && (
          <div
            className="mt-1 flex items-center justify-center gap-1.5 rounded-md py-1 text-[11px] font-medium"
            style={{ color: LINK, backgroundColor: '#f0f2f5' }}
          >
            <List className="h-3 w-3" />
            {editable ? (
              <InlineInput
                value={props.listButtonLabel ?? ''}
                placeholder="Ver opciones"
                maxLength={20}
                style={{ color: LINK }}
                onChange={(v) => props.onListLabelChange?.(v)}
              />
            ) : (
              (props.listButtonLabel ?? 'Ver opciones').slice(0, 20)
            )}
          </div>
        )}

        <Meta />
      </Bubble>
      </div>

      {/* Reply buttons render as their own bubbles below */}
      {props.kind === 'buttons' && (
        <div className="space-y-0.5">
          {(props.buttons ?? []).slice(0, 3).map((b, i) => (
            <ButtonChip
              key={i}
              title={b.title}
              editable={editable}
              onChange={(v) => props.onButtonChange?.(i, v)}
              onRemove={
                editable ? () => props.onRemoveButton?.(i) : undefined
              }
              port={
                props.connectablePorts
                  ? {
                      connected: !!props.buttonConnected?.[i],
                      onMouseDown: (e) =>
                        props.onPortMouseDown?.('button', i, e),
                    }
                  : undefined
              }
            />
          ))}
          {editable && (props.buttons ?? []).length < 3 && (
            <button
              type="button"
              onClick={() => props.onAddButton?.()}
              className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed bg-white/60 px-2 py-1 text-[11px] font-medium shadow-sm transition-colors hover:bg-white"
              style={{ color: LINK, borderColor: '#cfd9df' }}
            >
              <Plus className="h-3 w-3" />
              Agregar botón
            </button>
          )}
          {editable && (props.buttons ?? []).length === 3 && (
            <p
              className="px-1 text-[9px] italic"
              style={{ color: META }}
            >
              WhatsApp permite máximo 3 botones.
            </p>
          )}
        </div>
      )}

      {props.kind === 'cta_url' && (
        <div
          className="relative flex items-center justify-center gap-1.5 rounded-md bg-white px-2 py-1 text-[11px] font-medium shadow-sm"
          style={{ color: LINK }}
          data-port-kind="cta"
        >
          <ExternalLink className="h-3 w-3" />
          {editable ? (
            <InlineInput
              value={props.ctaTitle ?? ''}
              placeholder="Botón…"
              maxLength={20}
              style={{ color: LINK }}
              onChange={(v) => props.onCtaTitleChange?.(v)}
            />
          ) : (
            (props.ctaTitle ?? 'Botón').slice(0, 20)
          )}
          {props.connectablePorts && (
            <ConnectionPort
              connected={!!props.ctaConnected}
              onMouseDown={(e) => props.onPortMouseDown?.('cta', 0, e)}
            />
          )}
        </div>
      )}
      {props.kind === 'cta_url' && editable && (
        <div className="flex items-center gap-1 rounded-md bg-white/60 px-2 py-1 text-[10px] shadow-sm">
          <span style={{ color: META }}>URL:</span>
          <InlineInput
            value={props.ctaUrl ?? ''}
            placeholder="https://…"
            style={{ color: TITLE }}
            onChange={(v) => props.onCtaUrlChange?.(v)}
          />
        </div>
      )}

      {/* List rows preview — collapsed below the bubble */}
      {props.kind === 'list' && (
        <div className="space-y-0.5 rounded-md bg-white px-1.5 py-1 shadow-sm">
          {(props.listRows ?? []).slice(0, 10).map((r, i) => (
            <div
              key={i}
              className="group/row relative flex items-start gap-1 border-b border-black/5 py-0.5 last:border-b-0"
              data-port-kind="list_row"
            >
              <div className="min-w-0 flex-1">
                {editable ? (
                  <InlineInput
                    value={r.title}
                    placeholder={`Opción ${i + 1}`}
                    maxLength={24}
                    className="font-medium"
                    style={{ color: TITLE, fontSize: 10 }}
                    onChange={(v) =>
                      props.onListRowChange?.(i, { title: v })
                    }
                  />
                ) : (
                  <p
                    className="text-[10px] font-medium"
                    style={{ color: TITLE }}
                  >
                    {(r.title || 'Opción').slice(0, 24)}
                  </p>
                )}
                {editable ? (
                  <InlineInput
                    value={r.description ?? ''}
                    placeholder="Descripción (opcional)"
                    maxLength={72}
                    style={{ color: META, fontSize: 9 }}
                    onChange={(v) =>
                      props.onListRowChange?.(i, { description: v })
                    }
                  />
                ) : (
                  r.description && (
                    <p className="text-[9px]" style={{ color: META }}>
                      {r.description.slice(0, 72)}
                    </p>
                  )
                )}
              </div>
              {editable && (
                <button
                  type="button"
                  onClick={() => props.onRemoveListRow?.(i)}
                  className="mr-3 rounded p-0.5 opacity-0 transition-opacity group-hover/row:opacity-100"
                  style={{ color: META }}
                  aria-label="Quitar fila"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
              {props.connectablePorts && (
                <ConnectionPort
                  connected={!!props.listRowConnected?.[i]}
                  onMouseDown={(e) =>
                    props.onPortMouseDown?.('list_row', i, e)
                  }
                />
              )}
            </div>
          ))}
          {editable && (props.listRows ?? []).length < 10 && (
            <button
              type="button"
              onClick={() => props.onAddListRow?.()}
              className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed py-0.5 text-[10px] font-medium transition-colors hover:bg-white"
              style={{ color: LINK, borderColor: '#cfd9df' }}
            >
              <Plus className="h-2.5 w-2.5" />
              Agregar fila
            </button>
          )}
          {!editable && (props.listRows ?? []).length > 4 && (
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

/**
 * Textarea que crece sola con el contenido y se ve como texto normal
 * dentro del bubble (sin borde, sin fondo). Usa onInput para auto-
 * resize. El valor se commit-ea en cada cambio (onChange espejo) así
 * la edición es 100% controlada.
 */
function BubbleTextarea({
  value,
  placeholder,
  onChange,
  tiny = false,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  tiny?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      rows={1}
      className={cn(
        'w-full resize-none border-0 bg-transparent p-0 leading-snug outline-none focus:ring-0',
        tiny ? 'text-[10px]' : 'text-[11px]',
      )}
      style={{ color: TITLE }}
    />
  );
}

/**
 * Input pequeño in-place — usado para labels de botones, filas de lista,
 * URL, etc. Sin borde por defecto; subrayado azul claro al hover/focus
 * para que el usuario sepa que se puede editar.
 */
function InlineInput({
  value,
  placeholder,
  maxLength,
  onChange,
  className,
  style,
}: {
  value: string;
  placeholder: string;
  maxLength?: number;
  onChange: (v: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        'w-full min-w-0 border-0 bg-transparent p-0 leading-snug outline-none focus:ring-0',
        className,
      )}
      style={style}
    />
  );
}

function MediaPlaceholder({
  kind,
  url,
  editable,
  onUrlChange,
}: {
  kind: 'image' | 'video';
  url?: string;
  editable: boolean;
  onUrlChange?: (url: string) => void;
}) {
  const Icon = kind === 'image' ? ImageIcon : VideoIcon;
  return (
    <div className="mb-1 space-y-1">
      <div className="flex h-14 items-center justify-center rounded bg-[#ccd0d5]">
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
      {editable && (
        <div className="flex items-center gap-1 rounded bg-white/60 px-1.5 py-0.5 text-[10px]">
          <span style={{ color: META }}>URL:</span>
          <InlineInput
            value={url ?? ''}
            placeholder="https://…"
            style={{ color: TITLE }}
            onChange={(v) => onUrlChange?.(v)}
          />
        </div>
      )}
    </div>
  );
}

function DocumentRow({
  filename,
  editable,
  onFilenameChange,
}: {
  filename?: string;
  editable: boolean;
  onFilenameChange?: (v: string) => void;
}) {
  return (
    <div className="mb-1 flex items-center gap-1.5 rounded bg-[#f0f2f5] px-1.5 py-1">
      <FileText className="h-3.5 w-3.5" style={{ color: META }} />
      {editable ? (
        <InlineInput
          value={filename ?? ''}
          placeholder="archivo.pdf"
          style={{ color: TITLE, fontSize: 10 }}
          className="font-medium"
          onChange={(v) => onFilenameChange?.(v)}
        />
      ) : (
        <span
          className="truncate text-[10px] font-medium"
          style={{ color: TITLE }}
        >
          {filename || 'archivo.pdf'}
        </span>
      )}
    </div>
  );
}

function ButtonChip({
  title,
  editable,
  onChange,
  onRemove,
  port,
}: {
  title: string;
  editable: boolean;
  onChange: (v: string) => void;
  onRemove?: () => void;
  port?: { connected: boolean; onMouseDown: (e: React.MouseEvent) => void };
}) {
  return (
    <div
      className="group/btn relative flex items-center justify-center rounded-md bg-white px-2 py-1 text-[11px] font-medium shadow-sm"
      style={{ color: LINK }}
      data-port-kind="button"
    >
      {editable ? (
        <InlineInput
          value={title}
          placeholder="Botón"
          maxLength={20}
          className="text-center"
          style={{ color: LINK }}
          onChange={onChange}
        />
      ) : (
        <span>{(title || 'Botón').slice(0, 20)}</span>
      )}
      {editable && onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-5 rounded p-0.5 opacity-0 transition-opacity group-hover/btn:opacity-100"
          style={{ color: META }}
          aria-label="Quitar botón"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
      {port && <ConnectionPort {...port} />}
    </div>
  );
}

/**
 * Hueco circular en el borde derecho. Si está conectado (`connected`),
 * se ve relleno; si no, hueco. Agarrarlo con el mouse arranca el flujo
 * de drag-to-connect que el canvas resuelve.
 */
function ConnectionPort({
  connected,
  onMouseDown,
}: {
  connected: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  return (
    <span
      data-connection-port="true"
      onMouseDown={(e) => {
        // No queremos que el mousedown propague al card (que dispara
        // drag del nodo entero). Tampoco a otros listeners. El consumidor
        // decide qué hacer.
        e.stopPropagation();
        e.preventDefault();
        onMouseDown(e);
      }}
      className={cn(
        'absolute right-[-7px] top-1/2 z-10 -translate-y-1/2 cursor-crosshair rounded-full border-2 transition-all',
        'h-3 w-3',
        connected
          ? 'border-[#00a5f4] bg-[#00a5f4] shadow-[0_0_0_2px_rgba(0,165,244,0.18)]'
          : 'border-[#9aa6ad] bg-white hover:border-[#00a5f4] hover:scale-125 hover:shadow-[0_0_0_3px_rgba(0,165,244,0.22)]',
      )}
      aria-label={connected ? 'Conexión existente' : 'Conectar a otro paso'}
      role="button"
    />
  );
}
