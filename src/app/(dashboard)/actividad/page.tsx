'use client'

import Link from '@/components/i18n/locale-link'
import { useEffect, useState } from 'react'
import {
  MessageSquare,
  MessageCircle,
  PhoneCall,
  UserPlus,
  Radio,
  Zap,
  Inbox,
  Loader2,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadActivity } from '@/lib/dashboard/queries'
import type { ActivityItem, ActivityKind } from '@/lib/dashboard/types'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import type { TFn } from '@/lib/i18n/translate'

/**
 * Actividad reciente GLOBAL de todo Riverz — lista completa (mensajes,
 * comentarios, llamadas, contactos, campañas, automatizaciones). NO se filtra
 * por fecha: siempre los eventos más recientes. Accesible desde "Ver todo" del
 * panel.
 */
const THEME: Record<ActivityKind, { icon: ComponentType<{ className?: string }>; badge: string }> = {
  message: { icon: MessageSquare, badge: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  comment: { icon: MessageCircle, badge: 'bg-pink-500/10 text-pink-600 dark:text-pink-400' },
  call: { icon: PhoneCall, badge: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
  contact: { icon: UserPlus, badge: 'bg-primary/10 text-accent-ink' },
  broadcast: { icon: Radio, badge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  automation: { icon: Zap, badge: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' },
}

export default function ActivityPage() {
  const t = useT()
  const fmt = useFormat()
  const [items, setItems] = useState<ActivityItem[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const db = createClient()
    let cancelled = false
    loadActivity(db, t, 200)
      .then((a) => {
        if (!cancelled) setItems(a)
      })
      .catch((err) => console.error('[actividad] load failed:', err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // t en deps: si cambia el idioma, recargamos el texto del feed.
  }, [t])

  return (
    <div className="space-y-5">
      <h1 className="app-page-title">{t('dashboard.recentActivity')}</h1>

      <section className="rounded-xl border border-border bg-card">
        {loading || !items ? (
          <div className="flex items-center gap-2 px-5 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('dashboard.loading')}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-16 text-center">
            <Inbox className="h-7 w-7 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('dashboard.noActivity')}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it, i) => {
              const theme = THEME[it.kind]
              const Icon = theme.icon
              const stripe = i % 2 === 0 ? 'bg-transparent' : 'bg-muted/40'
              const row = (
                <div className="flex items-center gap-3 px-5 py-2.5">
                  <span
                    className={cn(
                      'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full',
                      theme.badge,
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{it.text}</span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">
                    {relativeTime(it.at, t, fmt.date)}
                  </span>
                </div>
              )
              return (
                <li key={it.id} className={cn(stripe, 'transition-colors hover:bg-accent')}>
                  {it.href ? (
                    <Link href={it.href} className="block">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function relativeTime(
  iso: string,
  t: TFn,
  df: (v: Date | string | number, opts?: Intl.DateTimeFormatOptions) => string,
): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return t('dashboard.agoSeconds', { n: Math.max(1, diffSec) })
  if (diffSec < 3600) return t('dashboard.agoMinutes', { n: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return t('dashboard.agoHours', { n: Math.floor(diffSec / 3600) })
  if (diffSec < 2_592_000) return t('dashboard.agoDays', { n: Math.floor(diffSec / 86400) })
  return df(iso, { day: 'numeric', month: 'numeric', year: 'numeric' })
}
