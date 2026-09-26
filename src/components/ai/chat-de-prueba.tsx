'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  ExternalLink,
  FastForward,
  Pencil,
  Phone,
  Reply,
  
  
  UserRound,
} from 'lucide-react';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
import type { Channel } from '@/types';

/**
 * Las piezas del chat de "Probar como cliente": el teléfono, las burbujas y
 * los avisos. Las usan la prueba en vivo y la lista de pruebas guardadas, así
 * una prueba se revisa exactamente como se vio.
 *
 * Los hex de acá son el cromo REAL de WhatsApp, como en la vista previa de
 * plantillas: el chat se ve como el teléfono del cliente, no sigue el tema.
 */

export type EscenarioDePrueba =
  | 'mensaje'
  | 'shopify_order_created'
  | 'shopify_abandoned_checkout'
  | 'shopify_order_fulfilled'
  | 'shopify_order_delivered'
  | 'shopify_order_cancelled'
  | 'payment_rejected';

export const ESCENARIOS_DE_PRUEBA: Array<{ id: EscenarioDePrueba; key: string }> = [
  { id: 'mensaje', key: 'assistant.probarEscMensaje' },
  { id: 'shopify_order_created', key: 'assistant.probarEscPedido' },
  { id: 'shopify_abandoned_checkout', key: 'assistant.probarEscCarrito' },
  { id: 'payment_rejected', key: 'assistant.probarEscPagoRechazado' },
  { id: 'shopify_order_fulfilled', key: 'assistant.probarEscDespachado' },
  { id: 'shopify_order_delivered', key: 'assistant.probarEscEntregado' },
  { id: 'shopify_order_cancelled', key: 'assistant.probarEscCancelado' },
];

/** `label` es el nombre de la marca tal cual, o una clave i18n (`assistant.`). */
export const CANALES_DE_PRUEBA: Array<{ id: Channel; label: string }> = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'messenger', label: 'Messenger' },
  { id: 'ig_comment', label: 'assistant.channelIgComments' },
  { id: 'fb_comment', label: 'assistant.channelFbComments' },
  { id: 'mercadolibre', label: 'Mercado Libre' },
  { id: 'gmail', label: 'Gmail' },
  { id: 'webchat', label: 'assistant.channelWebchat' },
];

/** Lo que se ve en el hilo. `biz` es lo que manda el comercio (automatización o asistente). */
export type ItemChat =
  | {
      k: 'biz';
      texto: string;
      botones?: Array<{ text: string; type: string }>;
      /** Sólo para comentarios: si la respuesta es pública o por privado. */
      nota?: string;
      /** Se puede marcar bien o mal: la respuesta entera, no cada burbuja. */
      opinable?: boolean;
      hora?: string;
    }
  | { k: 'me'; texto: string; hora?: string }
  | { k: 'sys'; texto: string; icono?: 'espera' | 'llamada' | 'persona' }
  | { k: 'typing' };

export interface MarcaDeFeedback {
  voto: 'bien' | 'mal' | null;
  nota: string;
}

/**
 * El teléfono. En pantallas chicas ocupa todo el ancho, sin marco: se prueba
 * desde el celular y un teléfono dibujado adentro de otro sólo quita lugar.
 */
export function MarcoDeTelefono({
  titulo,
  subtitulo,
  acciones,
  children,
  pie,
  className,
  hiloRef,
  alto,
}: {
  titulo: string;
  subtitulo?: string | null;
  acciones?: React.ReactNode;
  children: React.ReactNode;
  pie?: React.ReactNode;
  className?: string;
  /** El contenedor que scrollea, para bajar al último mensaje. */
  hiloRef?: React.Ref<HTMLDivElement>;
  /** Clases de alto, si no es la pantalla de prueba. */
  alto?: string;
}) {
  const inicial = titulo.trim().charAt(0).toUpperCase() || 'R';
  return (
    <div
      className={cn(
        'mx-auto w-full overflow-hidden rounded-xl bg-[#0b141a] shadow-lg sm:max-w-[380px] sm:rounded-[2.25rem] sm:border-[7px] sm:border-foreground/90 sm:shadow-2xl',
        className
      )}
    >
      <div
        className={cn(
          'flex flex-col',
          alto ?? 'h-[calc(100dvh-6rem)] max-h-[720px] min-h-[420px] sm:h-[min(640px,72vh)] sm:min-h-[460px]'
        )}
      >
        <div className="flex items-center gap-2.5 bg-[#075e54] px-3 py-2.5">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-white/20 text-sm font-semibold text-white">
            {inicial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{titulo}</p>
            {subtitulo ? <p className="truncate text-[11px] text-white/75">{subtitulo}</p> : null}
          </div>
          {acciones}
        </div>
        <div
          ref={hiloRef}
          className="flex-1 space-y-1.5 overflow-y-auto px-3 py-3"
          style={{
            backgroundColor: '#e5ddd5',
            backgroundImage: 'radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)',
            backgroundSize: '14px 14px',
          }}
        >
          {children}
        </div>
        {pie}
      </div>
    </div>
  );
}

/** Un botón redondo del encabezado verde. */
export function BotonDeTelefono({
  etiqueta,
  onClick,
  children,
  marcado,
}: {
  etiqueta: string;
  onClick: () => void;
  children: React.ReactNode;
  marcado?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className="relative grid size-9 shrink-0 place-items-center rounded-full text-white/85 hover:bg-white/10"
    >
      {children}
      {marcado ? <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-[#25d366]" /> : null}
    </button>
  );
}

export function Chip({ texto, icono }: { texto: string; icono?: 'espera' | 'llamada' | 'persona' }) {
  return (
    <div className="flex justify-center py-1">
      <span className="inline-flex max-w-[92%] items-center gap-1.5 rounded-lg bg-[#fff5c4] px-2.5 py-1 text-center text-[11px] text-[#54656f] shadow-sm">
        {icono === 'espera' ? <FastForward className="size-3 shrink-0" /> : null}
        {icono === 'llamada' ? <Phone className="size-3 shrink-0" /> : null}
        {icono === 'persona' ? <UserRound className="size-3 shrink-0" /> : null}
        {texto}
      </span>
    </div>
  );
}

/**
 * Una línea del hilo. Con `onFeedback`, la respuesta del comercio se puede
 * marcar como bien o mal y comentar; sin él, la marca sólo se muestra.
 */
export function Linea({
  it,
  onBoton,
  feedback,
  onFeedback,
}: {
  it: ItemChat;
  onBoton?: (texto: string) => void;
  feedback?: MarcaDeFeedback | null;
  onFeedback?: (f: MarcaDeFeedback) => void;
}) {
  if (it.k === 'sys') return <Chip texto={it.texto} icono={it.icono} />;
  if (it.k === 'typing') {
    return (
      <div className="flex justify-start">
        <div className="rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm shadow-sm">
          <span className="animate-pulse text-[#8696a0]">•••</span>
        </div>
      </div>
    );
  }
  if (it.k === 'me') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-tr-none bg-[#dcf8c6] px-2.5 py-1.5 text-[14px] leading-snug text-[#111b21] shadow-sm sm:max-w-[82%] sm:text-[13px]">
          <p className="whitespace-pre-wrap break-words">{it.texto}</p>
          <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
            {it.hora} <CheckCheck className="size-3 text-[#53bdeb]" />
          </p>
        </div>
      </div>
    );
  }
  const botones = it.botones ?? [];
  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 text-[14px] leading-snug text-[#111b21] shadow-sm sm:max-w-[82%] sm:text-[13px]">
        <p className="whitespace-pre-wrap break-words">{it.texto}</p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-[#667781]">
          {it.hora} <Check className="size-3" />
        </p>
      </div>
      {botones.length > 0 ? (
        <div className="mt-1 w-[85%] max-w-[85%] space-y-0.5 sm:w-[82%] sm:max-w-[82%]">
          {botones.map((b, i) => (
            <button
              key={i}
              type="button"
              onClick={() => (b.type === 'QUICK_REPLY' && onBoton ? onBoton(b.text) : undefined)}
              className={cn(
                'flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-2 py-1.5 text-[13px] font-medium text-[#00a5f4] shadow-sm',
                b.type === 'QUICK_REPLY' && onBoton ? 'hover:bg-white/80' : 'cursor-default'
              )}
            >
              {b.type === 'URL' ? <ExternalLink className="size-3.5" /> : b.type === 'QUICK_REPLY' ? <Reply className="size-3.5" /> : null}
              {b.text}
            </button>
          ))}
        </div>
      ) : null}
      {/* Las pruebas viejas guardaban en la nota quién contestó o la plantilla: no se muestran. */}
      {it.nota && it.opinable ? <p className="mt-0.5 max-w-[85%] rounded bg-white/60 px-1.5 text-[10px] text-[#54656f] sm:max-w-[82%]">{it.nota}</p> : null}
      {/* Las pruebas guardadas antes de `opinable` marcaban la respuesta con la nota. */}
      {(it.opinable || it.nota) && (onFeedback || feedback) ? (
        <Opinion marca={feedback ?? null} onCambio={onFeedback} />
      ) : null}
    </div>
  );
}

/**
 * La nota sobre una respuesta: qué estuvo mal o qué debería haber dicho. Sin
 * 👍/👎: un voto solo no dice qué cambiar, y la mejora sale de la nota.
 */
function Opinion({ marca, onCambio }: { marca: MarcaDeFeedback | null; onCambio?: (f: MarcaDeFeedback) => void }) {
  const t = useT();
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(marca?.nota ?? '');
  const campo = useRef<HTMLTextAreaElement | null>(null);
  const nota = marca?.nota ?? '';

  useEffect(() => {
    if (editando) campo.current?.focus();
  }, [editando]);

  if (!onCambio) {
    if (!nota) return null;
    return (
      <p className="mt-1 max-w-[85%] rounded-md bg-[#fff5c4] px-2 py-1 text-[11px] whitespace-pre-wrap break-words text-[#54656f] sm:max-w-[82%]">
        {nota}
      </p>
    );
  }

  const guardar = () => {
    setEditando(false);
    if (borrador.trim() !== nota) onCambio({ voto: null, nota: borrador.trim() });
  };
  const abrir = () => {
    setBorrador(nota);
    setEditando(true);
  };

  return (
    <div className="mt-1 w-[85%] max-w-[85%] sm:w-[82%] sm:max-w-[82%]">
      {editando ? (
        <textarea
          ref={campo}
          value={borrador}
          rows={2}
          maxLength={1000}
          onChange={(e) => setBorrador(e.target.value)}
          onBlur={guardar}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              guardar();
            }
            if (e.key === 'Escape') setEditando(false);
          }}
          placeholder={t('assistant.pruebasNotaPlaceholder')}
          className="w-full resize-none rounded-md border-0 bg-[#fff5c4] px-2 py-1.5 text-base text-[#111b21] shadow-sm outline-none placeholder:text-[#8696a0] sm:text-[12px]"
        />
      ) : nota ? (
        <button
          type="button"
          onClick={abrir}
          className="block w-full rounded-md bg-[#fff5c4] px-2 py-1 text-left text-[12px] whitespace-pre-wrap break-words text-[#54656f] shadow-sm sm:text-[11px]"
        >
          {nota}
        </button>
      ) : (
        <button
          type="button"
          onClick={abrir}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-[#54656f]/80 hover:bg-white/60"
        >
          <Pencil className="size-3" />
          {t('assistant.pruebasComentar')}
        </button>
      )}
    </div>
  );
}

/** Qué se probó, en palabras: la situación y el canal. */
export function etiquetaDeEscenario(t: ReturnType<typeof useT>, id: string | null): string {
  const e = ESCENARIOS_DE_PRUEBA.find((x) => x.id === id);
  return e ? t(e.key) : (id ?? '—');
}

export function etiquetaDeCanal(t: ReturnType<typeof useT>, id: string | null): string {
  const c = CANALES_DE_PRUEBA.find((x) => x.id === id);
  if (!c) return id ?? '—';
  return c.label.startsWith('assistant.') ? t(c.label) : c.label;
}
