import { ChannelLogo } from '@/components/inbox/channel-logo'
import { CHANNEL_DISPLAY } from '@/lib/channels/display'
import type { ChannelMixPoint } from '@/lib/dashboard/types'
import type { Channel } from '@/types'
import { cn } from '@/lib/utils'

interface ChannelMixCardProps {
  mix: ChannelMixPoint[]
}

/**
 * "Where is the inbox load coming from?" — last-7-days message volume
 * broken down by channel, with inbound vs outbound bars per row so the
 * team can spot a channel that's exploding (or one that's gone quiet).
 */
export function ChannelMixCard({ mix }: ChannelMixCardProps) {
  const total = mix.reduce((n, m) => n + m.inbound + m.outbound, 0)
  const peak = Math.max(1, ...mix.map((m) => m.inbound + m.outbound))
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Volumen por canal</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Total: <span className="font-semibold text-foreground tabular-nums">{total.toLocaleString()}</span>
        </p>
      </header>
      <ul className="space-y-3">
        {mix.map((m) => {
          const display = CHANNEL_DISPLAY[m.channel as Channel] ?? null
          const sum = m.inbound + m.outbound
          const inboundPct = (m.inbound / peak) * 100
          const outboundPct = (m.outbound / peak) * 100
          return (
            <li key={m.channel} className="flex items-center gap-3">
              <div className="flex w-28 shrink-0 items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-md bg-muted">
                  <ChannelLogo channel={m.channel as Channel} size={14} />
                </span>
                <span className="truncate text-xs font-medium text-foreground">
                  {display?.label ?? m.channel}
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
              <div className="w-32 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                <span className={cn('font-semibold text-foreground')}>{sum.toLocaleString()}</span>
                <span className="ml-2 text-muted-foreground">
                  ↓ {m.inbound} · ↑ {m.outbound}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="mt-4 flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-foreground/40" />
          Recibidos
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm bg-primary" />
          Enviados
        </span>
      </div>
    </section>
  )
}
