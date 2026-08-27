'use client';

import { MessageCircle, Paperclip, Send, X } from 'lucide-react';
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
 */
export function VistaPrevia({
  cfg,
  fallbackName,
}: {
  cfg: WebchatConfig;
  fallbackName: string;
}) {
  const t = useT();
  const color = cfg.primary_color || '#A3E635';
  const nombre = cfg.brand_name?.trim() || fallbackName;
  const saludo = cfg.greeting?.trim() || t('webchat.greetingPlaceholder');
  const sugeridas = (cfg.quick_replies ?? []).filter(Boolean);
  const invitacion = cfg.proactive_message?.trim();
  const izquierda = cfg.position === 'left';

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="mb-3 text-sm font-medium text-foreground">{t('webchat.preview')}</p>

      {/* El marco imita una página de tienda: sin un fondo detrás, el chat
          flotando en el vacío no dice de qué lado va a quedar. */}
      <div className="relative h-[420px] overflow-hidden rounded-lg border border-border bg-gradient-to-b from-muted/60 to-muted/20 p-3">
        <div
          className={cn(
            'absolute bottom-3 flex w-[248px] flex-col gap-2',
            izquierda ? 'left-3 items-start' : 'right-3 items-end',
          )}
        >
          {/* La ventana */}
          <div className="w-full overflow-hidden rounded-xl border border-border bg-background shadow-lg">
            <div
              className="flex items-center gap-2 px-3 py-2.5"
              style={{ backgroundColor: color }}
            >
              <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black/10 text-[10px] font-semibold text-black/70">
                {cfg.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- imagen del comercio
                  <img src={cfg.avatar_url} alt="" className="size-full object-cover" />
                ) : (
                  nombre.slice(0, 2).toUpperCase()
                )}
              </div>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-black/80">
                {nombre}
              </span>
              <X className="size-3.5 text-black/50" aria-hidden />
            </div>

            <div className="space-y-2 px-3 py-3">
              <p className="max-w-[85%] rounded-xl rounded-tl-sm bg-muted px-2.5 py-1.5 text-[11px] leading-snug text-foreground">
                {saludo}
              </p>
              {sugeridas.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {sugeridas.map((q) => (
                    <span
                      key={q}
                      className="rounded-full border px-2 py-0.5 text-[10px] leading-snug text-foreground"
                      style={{ borderColor: color }}
                    >
                      {q}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-2 border-t border-border px-3 py-2">
              {cfg.allow_uploads !== false ? (
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              ) : null}
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {t('webchat.previewComposer')}
              </span>
              <Send className="size-3.5 shrink-0" style={{ color }} aria-hidden />
            </div>
          </div>

          {/* La invitación y el botón */}
          <div
            className={cn('flex w-full items-end gap-2', izquierda ? 'flex-row-reverse' : '')}
          >
            {invitacion ? (
              <p className="min-w-0 flex-1 truncate rounded-xl border border-border bg-background px-2.5 py-1.5 text-[11px] text-foreground shadow-sm">
                {invitacion}
              </p>
            ) : (
              <span className="flex-1" />
            )}
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-full shadow-lg"
              style={{ backgroundColor: color }}
            >
              <MessageCircle className="size-5 text-black/70" aria-hidden />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
