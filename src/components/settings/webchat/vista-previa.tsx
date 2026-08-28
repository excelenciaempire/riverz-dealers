'use client';

import { Paperclip, Send, X } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
import type { WebchatConfig } from '@/types';

/**
 * Cómo se va a ver en la tienda, mientras se configura.
 *
 * Es la mitad que faltaba de esta pantalla. El color, el nombre, la imagen, el
 * saludo y las preguntas sugeridas se editaban a ciegas: había que guardar,
 * abrir la tienda en otra pestaña y recargar para ver si había quedado bien —
 * y ese viaje se hace una vez, no las cinco que hacen falta para acertar.
 *
 * No es el widget real. Es un dibujo del widget: mismas piezas, mismo orden,
 * mismos colores. Reutilizar el chat de verdad acá obligaría a montarlo sin
 * sesión ni token, y un chat que no puede mandar mensajes tampoco es real.
 *
 * Dos cosas que el dibujo no puede improvisar, porque en la tienda no se
 * negocian: el chat SIEMPRE es blanco —el widget se monta con
 * `color-scheme:light`—, así que el tema oscuro del panel no puede teñirlo; y
 * el texto sobre el color de marca sale negro o blanco según su brillo, con la
 * misma cuenta que hace el widget. Eso último es justo lo que hay que ver
 * antes de elegir un color donde el nombre no se lee.
 */
export function VistaPrevia({
  cfg,
  fallbackName,
}: {
  cfg: WebchatConfig;
  fallbackName: string;
}) {
  const t = useT();
  const [abierto, setAbierto] = useState(true);
  const color = cfg.primary_color || '#A3E635';
  const ink = contraste(color);
  const nombre = cfg.brand_name?.trim() || fallbackName;
  const saludo = cfg.greeting?.trim() || t('webchat.greetingPlaceholder');
  const sugeridas = (cfg.quick_replies ?? []).filter(Boolean);
  const invitacion = cfg.proactive_message?.trim();
  const izquierda = cfg.position === 'left';
  const lado = izquierda ? 'left-3' : 'right-3';

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{t('webchat.preview')}</p>
        {/* El widget nunca muestra la ventana y la invitación a la vez: o está
            abierto, o está cerrado llamando la atención. Un dibujo con las dos
            juntas enseña una pantalla que nadie va a ver. */}
        <div className="flex rounded-full border border-border p-0.5">
          {[
            { v: true, label: t('webchat.previewOpen') },
            { v: false, label: t('webchat.previewClosed') },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              onClick={() => setAbierto(o.v)}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs transition',
                abierto === o.v
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* El marco imita una página de tienda: sin un fondo detrás, el chat
          flotando en el vacío no dice de qué lado va a quedar. */}
      <div className="relative h-[420px] select-none overflow-hidden rounded-lg border border-border bg-neutral-100">
        <Pagina />

        {abierto ? (
          <div
            className={cn(
              'absolute bottom-[54px] top-5 flex w-[250px] flex-col overflow-hidden rounded-xl bg-white shadow-[0_16px_48px_rgba(0,0,0,.24)]',
              lado,
            )}
          >
            <div
              className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2.5"
              style={{ backgroundColor: color }}
            >
              {cfg.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- imagen del comercio
                <img
                  src={cfg.avatar_url}
                  alt=""
                  className="size-5 shrink-0 rounded-full object-cover"
                />
              ) : null}
              <span
                className="min-w-0 flex-1 truncate text-xs font-semibold"
                style={{ color: ink }}
              >
                {nombre}
              </span>
              <X className="size-3.5 shrink-0 opacity-70" style={{ color: ink }} aria-hidden />
            </div>

            <div className="flex-1 overflow-hidden px-3 py-3">
              <p className="mb-1 ml-1 flex items-center gap-1.5 text-[10px] font-medium text-neutral-500">
                <span className="truncate">{nombre}</span>
                <span className="rounded bg-neutral-200 px-1 text-[9px] font-semibold uppercase tracking-wide text-neutral-600">
                  {t('webchat.previewAi')}
                </span>
              </p>
              <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-neutral-100 px-2.5 py-1.5 text-[11px] leading-snug text-neutral-900">
                {saludo}
              </p>
              {sugeridas.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {sugeridas.map((q) => (
                    <span
                      key={q}
                      className="rounded-full border px-2 py-0.5 text-[10px] leading-snug text-neutral-700"
                      style={{ borderColor: color }}
                    >
                      {q}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2 border-t border-neutral-200 p-2.5">
              {cfg.allow_uploads !== false ? (
                <Paperclip className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
              ) : null}
              <span className="min-w-0 flex-1 truncate rounded-lg border border-neutral-300 px-2 py-1 text-[11px] text-neutral-400">
                {t('webchat.previewComposer')}
              </span>
              <span
                className="grid size-6 shrink-0 place-items-center rounded-full"
                style={{ backgroundColor: color }}
              >
                <Send className="size-3" style={{ color: ink }} aria-hidden />
              </span>
            </div>
          </div>
        ) : invitacion ? (
          <p
            className={cn(
              'absolute bottom-[54px] max-w-[164px] rounded-xl bg-white px-3 py-2 text-[11px] leading-snug text-neutral-900 shadow-[0_10px_32px_rgba(0,0,0,.18)]',
              lado,
            )}
          >
            {invitacion}
          </p>
        ) : null}

        <span
          className={cn(
            'absolute bottom-3 grid size-9 place-items-center rounded-full shadow-[0_6px_24px_rgba(0,0,0,.22)]',
            lado,
          )}
          style={{ backgroundColor: color }}
        >
          {abierto ? (
            <X className="size-4" style={{ color: ink }} aria-hidden />
          ) : (
            <IconoChat color={ink} />
          )}
        </span>
      </div>
    </div>
  );
}

/** El decorado: una tienda cualquiera, lo bastante apagada para no competir. */
function Pagina() {
  return (
    <div aria-hidden className="absolute inset-0 p-3">
      <div className="flex items-center gap-1.5 rounded-md bg-white px-2 py-1.5 shadow-sm">
        <span className="h-2 w-10 rounded-full bg-neutral-300" />
        <span className="ml-auto h-1.5 w-6 rounded-full bg-neutral-200" />
        <span className="h-1.5 w-6 rounded-full bg-neutral-200" />
      </div>
      <div className="mt-3 h-24 rounded-md bg-neutral-200/70" />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="h-14 rounded-md bg-neutral-200/70" />
        <div className="h-14 rounded-md bg-neutral-200/70" />
        <div className="h-14 rounded-md bg-neutral-200/70" />
      </div>
    </div>
  );
}

/** El mismo trazo que dibuja el lanzador en la tienda. */
function IconoChat({ color }: { color: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.7-.8L3 21l1.9-5a8.4 8.4 0 0 1-.8-3.6 8.5 8.5 0 0 1 8.5-8.4 8.4 8.4 0 0 1 8.4 8.5z" />
    </svg>
  );
}

/** Negro o blanco según el brillo del color: la misma cuenta que el widget. */
function contraste(hex: string): string {
  const c = (hex || '').replace('#', '');
  if (c.length !== 6) return '#111827';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#ffffff';
}
