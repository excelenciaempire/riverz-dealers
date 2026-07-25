'use client'

import { ChannelLogo } from '@/components/inbox/channel-logo'
import { CHANNEL_DISPLAY, channelLabel } from '@/lib/channels/display'
import type { ChannelMixPoint } from '@/lib/dashboard/types'
import type { Channel } from '@/types'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'

interface ChannelMixCardProps {
  mix: ChannelMixPoint[]
}

/**
 * "Where is the inbox load coming from?" — message volume over the selected
 * range broken down by channel, with inbound vs outbound bars per row so the
 * team can spot a channel that's exploding (or one that's gone quiet).
 *
 * La lista incluye TODOS los canales conectados del workspace: uno sin tráfico
 * en la ventana se muestra atenuado en 0 en vez de desaparecer de la tarjeta.
 */
export function ChannelMixCard({ mix }: ChannelMixCardProps) {
  const t = useT()
  const fmt = useFormat()
  const total = mix.reduce((n, m) => n + m.inbound + m.outbound, 0)
  const peak = Math.max(1, ...mix.map((m) => m.inbound + m.outbound))
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">{t('dashboard.channelVolume')}</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('dashboard.total')}: <span className="font-semibold text-foreground tabular-nums">{fmt.number(total)}</span>
        </p>
      </header>
      <ul className="space-y-3">
        {mix.map((m) => {
          const display = CHANNEL_DISPLAY[m.channel as Channel] ?? null
          const sum = m.inbound + m.outbound
          const inboundPct = (m.inbound / peak) * 100
          const outboundPct = (m.outbound / peak) * 100
          return (
            <li
              key={m.channel}
              className={cn('flex items-center gap-3', sum === 0 && 'opacity-45')}
            >
              <div className="flex w-16 sm:w-28 shrink-0 items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-muted">
                  <ChannelLogo channel={m.channel as Channel} size={14} />
                </span>
                <span className="truncate text-xs font-medium text-foreground">
                  {display ? channelLabel(m.channel as Channel, t) : m.channel}
                </span>
              </div>
              <div className="flex-1">
                <div className="relative h-2 overflow-hidden rounded-full bg-muted/60">
                  <div
                    className="absolute inset-y-0 left-0 bg-foreground/40"
                    style={{ width: `${inboundPct}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-primary"
                    style={{ width: `${outboundPct}%`, marginLeft: `${inboundPct}%` }}
                  />
                </div>
              </div>
              <div className="w-auto sm:w-32 shrink-0 whitespace-nowrap text-right text-[11px] text-muted-foreground tabular-nums">
                <span className={cn('font-semibold text-foreground')}>{fmt.number(sum)}</span>
                <span className="ml-2 text-muted-foreground">
                  ↓ {fmt.number(m.inbound)} · ↑ {fmt.number(m.outbound)}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-foreground/40" />
          {t('dashboard.received')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-primary" />
          {t('dashboard.sent')}
        </span>
      </div>
    </section>
  )
}
