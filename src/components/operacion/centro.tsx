'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from '@/components/i18n/locale-link'
import { ArrowRight, Bot, CheckCircle2, Clock, Radio, Zap } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { MetricCard } from '@/components/dashboard/metric-card'
import { cn } from '@/lib/utils'

/**
 * Lo que sólo la operación sabe.
 *
 * El panel de siempre ya cuenta lo que pasó —conversaciones, mensajes,
 * gráficos, actividad—. Lo que le falta es lo que Riverz está haciendo por su
 * cuenta: qué agentes trabajan, cuántas automatizaciones corren y cómo
 * salieron, y quién escribió y todavía no le contestó nadie.
 *
 * Por eso esto son dos piezas y no una pantalla: se insertan dentro del panel,
 * en el lugar que les toca, en vez de apilar dos paneles con las mismas cifras
 * repetidas.
 */

interface Overview {
  estado: {
    canales: { channel: string; status: string }[]
    automatizaciones: { id: string; is_active: boolean }[]
    corridas_24h: { total: number; exito: number; parciales: number; fallidas: number }
  }
  pendientes: {
    conversation_id: string
    contacto: string
    canal: string
    horas_esperando: number | null
    pidio_humano: string | null
  }[]
  agentes: { id: string; is_active: boolean }[]
}

/** Carga el estado de la operación una sola vez para las dos piezas. */
export function useOperacion(refreshKey = 0) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch('/api/operacion/overview', { cache: 'no-store' })
      if (!res.ok) throw new Error('failed')
      setData((await res.json()) as Overview)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  return { data, error, reload: load }
}

/**
 * Quién escribió y sigue esperando.
 *
 * Va con lo que necesita a una persona y no con las métricas: una conversación
 * sin responder desde hace seis horas es alguien esperando, no un número.
 */
export function ConversacionesPendientes({ data }: { data: Overview | null }) {
  const t = useT()
  const filas = data?.pendientes ?? []
  if (filas.length === 0) return null

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between px-4 py-2.5">
        <p className="text-xs font-medium text-muted-foreground">
          {t('operation.pendingReplies')}
        </p>
        <Link
          href="/bandeja"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('operation.seeAll')}
        </Link>
      </div>
      <ul className="divide-y divide-border border-t border-border">
        {filas.map((c) => (
          <li
            key={c.conversation_id}
            className="flex items-center gap-3 px-4 py-2.5 text-sm"
          >
            <Clock className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-foreground">{c.contacto}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {c.pidio_humano ??
                (c.horas_esperando !== null
                  ? t('operation.hoursWaiting', { n: c.horas_esperando })
                  : c.canal)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Qué está trabajando solo ahora mismo. */
export function QueEstaCorriendo({ data }: { data: Overview | null }) {
  const t = useT()
  if (!data) return null

  const agentes = data.agentes.filter((a) => a.is_active).length
  const autos = data.estado.automatizaciones.filter((a) => a.is_active).length
  const canales = data.estado.canales.filter((c) => c.status === 'connected').length
  const corridas = data.estado.corridas_24h

  if (agentes === 0 && autos === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-6 text-center">
        <p className="text-sm font-medium text-foreground">
          {t('operation.nothingRunning')}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('operation.nothingRunningHint')}
        </p>
        {/* La salida del estado vacío es el asistente, no una lista de
            secciones para recorrer a mano. */}
        <Link
          href="/operacion/activar"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {t('operation.activateCta')}
          <ArrowRight className="size-4" />
        </Link>
      </div>
    )
  }

  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4')}>
      <MetricCard title={t('operation.agentsActive')} value={String(agentes)} icon={Bot} />
      <MetricCard
        title={t('operation.automationsActive')}
        value={String(autos)}
        icon={Zap}
      />
      <MetricCard
        title={t('operation.channelsConnected')}
        value={String(canales)}
        icon={Radio}
      />
      <MetricCard
        title={t('operation.runs24h')}
        value={String(corridas.total)}
        icon={CheckCircle2}
        subtitle={t('operation.runsBreakdown', {
          ok: corridas.exito,
          partial: corridas.parciales,
          failed: corridas.fallidas,
        })}
      />
    </div>
  )
}
