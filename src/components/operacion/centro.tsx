'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from '@/components/i18n/locale-link'
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock,
  DollarSign,
  Radio,
  ShoppingBag,
  Zap,
} from 'lucide-react'
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

export interface Overview {
  estado: {
    canales: { channel: string; status: string }[]
    automatizaciones: { id: string; name: string; is_active: boolean }[]
    corridas_24h: { total: number; exito: number; parciales: number; fallidas: number }
  } | null
  metricas: {
    periodo: { dias: number }
    resueltas: { actual: number; anterior: number }
    ia: { respondio: number; se_abstuvo: number; fallo: number }
    pedidos: { cantidad: number; facturado: number; moneda: string | null }
  } | null
  pendientes:
    | {
        conversation_id: string
        contacto: string
        canal: string
        horas_esperando: number | null
        pidio_humano: string | null
      }[]
    | null
  agentes: { id: string; is_active: boolean }[] | null
  plantillas: { total: number; rechazadas: number; pendientes: number } | null
  campanas: {
    trabadas: number
    campanas: {
      id: string
      sent_count: number | null
      delivered_count: number | null
      read_count: number | null
      replied_count: number | null
      failed_count: number | null
    }[]
  } | null
}

/**
 * El estado de la operación, para todas las piezas del panel.
 *
 * `dias` sigue al filtro de fechas del panel: si el comercio pide 30 días y
 * estas cifras siguieran en 7, dos tarjetas de la misma pantalla estarían
 * midiendo períodos distintos sin decirlo.
 */
export function useOperacion(dias = 7) {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState(false)

  const load = useCallback(async (d: number) => {
    setError(false)
    try {
      const res = await fetch(`/api/operacion/overview?dias=${d}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('failed')
      setData((await res.json()) as Overview)
    } catch {
      setError(true)
    }
  }, [])

  useEffect(() => {
    void load(dias)
  }, [load, dias])

  return { data, error, reload: () => load(dias) }
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

/**
 * Las cifras que el panel de siempre no tiene: lo que hizo la IA y lo que
 * entró en plata.
 *
 * Van dentro de la misma grilla de tarjetas y no en una fila aparte: son del
 * mismo período y responden a la misma pregunta ("¿cómo venimos?"). Separarlas
 * sugeriría que miden otra cosa.
 */
export function TarjetasOperacion({ data }: { data: Overview | null }) {
  const t = useT()
  const m = data?.metricas
  if (!m) return null

  const moneda = m.pedidos.moneda ?? ''
  return (
    <>
      <MetricCard
        title={t('operation.mResolved')}
        value={String(m.resueltas.actual)}
        icon={CheckCircle2}
      />
      <MetricCard
        title={t('operation.mAiAnswered')}
        value={String(m.ia.respondio)}
        icon={Bot}
        subtitle={t('operation.mAiBreakdown', {
          skipped: m.ia.se_abstuvo,
          failed: m.ia.fallo,
        })}
      />
      <MetricCard
        title={t('operation.mOrders')}
        value={String(m.pedidos.cantidad)}
        icon={ShoppingBag}
      />
      <MetricCard
        title={t('operation.mRevenue')}
        value={`${m.pedidos.facturado.toLocaleString()} ${moneda}`.trim()}
        icon={DollarSign}
      />
    </>
  )
}

/**
 * Lo que puede estar frenando los envíos.
 *
 * Una plantilla rechazada no se puede usar en ninguna campaña ni
 * automatización, y una campaña trabada en "enviando" parece haber salido y no
 * salió. Son las dos causas más frecuentes de "no salió nada" y hasta ahora no
 * tenían pantalla.
 */
export function PlantillasYCampanas({ data }: { data: Overview | null }) {
  const t = useT()
  const p = data?.plantillas
  const c = data?.campanas
  if (!p && !c) return null

  const envio = (c?.campanas ?? []).reduce(
    (a, b) => ({
      enviados: a.enviados + (b.sent_count ?? 0),
      entregados: a.entregados + (b.delivered_count ?? 0),
      leidos: a.leidos + (b.read_count ?? 0),
      respondidos: a.respondidos + (b.replied_count ?? 0),
      fallidos: a.fallidos + (b.failed_count ?? 0),
    }),
    { enviados: 0, entregados: 0, leidos: 0, respondidos: 0, fallidos: 0 },
  )

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {p && (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-medium text-foreground">
            {t('operation.templatesTitle')}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Cifra label={t('operation.templatesTotal')} valor={p.total} />
            <Cifra
              label={t('operation.templatesRejected')}
              valor={p.rechazadas}
              alerta={p.rechazadas > 0}
            />
            <Cifra label={t('operation.templatesPending')} valor={p.pendientes} />
          </div>
        </div>
      )}

      {c && (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-medium text-foreground">
            {t('operation.campaignsTitle')}
          </p>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Cifra label={t('operation.cSent')} valor={envio.enviados} />
            <Cifra label={t('operation.cDelivered')} valor={envio.entregados} />
            <Cifra label={t('operation.cRead')} valor={envio.leidos} />
            <Cifra label={t('operation.cReplied')} valor={envio.respondidos} />
            <Cifra
              label={t('operation.cFailed')}
              valor={envio.fallidos}
              alerta={envio.fallidos > 0}
            />
            <Cifra
              label={t('operation.cStalled')}
              valor={c.trabadas}
              alerta={c.trabadas > 0}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Cifra({
  label,
  valor,
  alerta = false,
}: {
  label: string
  valor: number
  alerta?: boolean
}) {
  return (
    <div>
      <p
        className={cn(
          'text-lg font-semibold tabular-nums',
          alerta && valor > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground',
        )}
      >
        {valor}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

/** Qué está trabajando solo ahora mismo. */
export function QueEstaCorriendo({ data }: { data: Overview | null }) {
  const t = useT()
  if (!data?.estado || !data.agentes) return null

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
