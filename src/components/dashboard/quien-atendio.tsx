'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/hooks/use-locale'
import type { Cortes } from '@/lib/dashboard/cortes'
import { cn } from '@/lib/utils'

/**
 * Quién atendió: por canal y por agente.
 *
 * Inicio contaba el volumen por canal —cuántos mensajes entraron y salieron—
 * y nada más. Con eso no se puede contestar la pregunta que importa: **dónde
 * está trabajando la IA y dónde no**. Un comercio con cuatro canales conectados
 * veía un solo número de «respondió la IA» sin saber de cuál venía.
 *
 * El corte por agente muestra además en cuántas se ABSTUVO y por qué. Es lo que
 * explica un agente que parece apagado y no lo está: `ai_replies.skip_reason`
 * guarda el motivo desde siempre y no se mostraba en ninguna pantalla.
 */

const NOMBRE_CANAL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  webchat: 'Chat web',
  gmail: 'Gmail',
  outlook: 'Outlook',
  mercadolibre: 'Mercado Libre',
  ml_review: 'Opiniones ML',
  tiktok_comment: 'TikTok',
  ig_comment: 'Comentarios IG',
  fb_comment: 'Comentarios FB',
}

export function QuienAtendio({ start, end }: { start: string | null; end: string | null }) {
  const t = useT()
  const [d, setD] = useState<Cortes | null>(null)

  useEffect(() => {
    if (!start || !end) return
    let cancelado = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/analytics/cortes?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
          { cache: 'no-store' },
        )
        if (!cancelado) setD(res.ok ? ((await res.json()) as Cortes) : null)
      } catch {
        if (!cancelado) setD(null)
      }
    })()
    return () => {
      cancelado = true
    }
  }, [start, end])

  // Sin conversaciones en el rango no hay nada que cortar, y una tarjeta vacía
  // ocupa el mismo lugar que una con información.
  if (!d || (d.canales.length === 0 && d.agentes.length === 0)) return null

  const tope = Math.max(1, ...d.canales.map((c) => c.conversaciones))

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">{t('dashboard.whoTitle')}</h2>

      {d.canales.length > 0 && (
        <ul className="mt-3 space-y-2">
          {d.canales.map((c) => (
            <li key={c.canal} className="flex items-center gap-3 text-xs">
              <span className="w-28 shrink-0 truncate text-foreground">
                {NOMBRE_CANAL[c.canal] ?? c.canal}
              </span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                {/* Dos tramos sobre la misma barra: el ancho es el volumen del
                    canal, y la parte encendida es la que tocó la IA. Así se lee
                    de un vistazo dónde está trabajando y dónde no. */}
                <span
                  className="block h-full rounded-full bg-muted-foreground/30"
                  style={{ width: `${(c.conversaciones / tope) * 100}%` }}
                >
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{
                      width: `${c.conversaciones > 0 ? (c.conIa / c.conversaciones) * 100 : 0}%`,
                    }}
                  />
                </span>
              </span>
              <span className="w-32 shrink-0 text-right tabular-nums text-muted-foreground">
                {t('dashboard.whoOfWithAi', { n: c.conIa, total: c.conversaciones })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {d.agentes.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
          {d.agentes.map((a) => (
            <li key={a.agenteId} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span
                className={cn(
                  'font-medium',
                  a.activo ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {a.nombre}
              </span>
              {!a.activo && (
                <span className="text-muted-foreground">{t('dashboard.whoPaused')}</span>
              )}
              <span className="tabular-nums text-muted-foreground">
                {t('dashboard.whoAnswered', { n: a.respondio })}
              </span>
              {a.seAbstuvo > 0 && (
                <span className="tabular-nums text-muted-foreground">
                  · {t('dashboard.whoSkipped', { n: a.seAbstuvo })}
                  {a.motivo ? ` (${a.motivo})` : ''}
                </span>
              )}
              {a.fallo > 0 && (
                <span className="tabular-nums text-amber-600 dark:text-amber-400">
                  · {t('dashboard.whoFailed', { n: a.fallo })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
