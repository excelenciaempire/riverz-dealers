'use client'

import { Bot, Inbox, MessageSquare, Send, Sparkles, UserPlus } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { MetricCard } from '@/components/dashboard/metric-card'
import type { Atribucion } from '@/lib/dashboard/use-attribution'
import type { MetricsBundle } from '@/lib/dashboard/types'

/**
 * Lo que generó Riverz, y las cifras de siempre.
 *
 * La primera tarjeta es la que no existía y es la que contesta si conviene
 * seguir pagando: la plata de los pedidos que pasaron por Riverz, sobre el
 * total que vendió la tienda. Las otras cinco son las de toda la vida.
 *
 * Lo que NO está, y es a propósito: las ventas totales de la tienda y el ticket
 * promedio. Son del comercio, no de Riverz — sin nosotros pasan igual. La
 * facturación de la tienda sigue apareciendo, pero como el denominador del
 * porcentaje de la primera tarjeta, que es donde significa algo.
 *
 * Tampoco están "automatizaciones activas", "canales conectados" ni "agentes
 * activos": eso es configuración, no resultado. Suben igual cuando la cuenta
 * anda mal.
 */
export function TarjetasRoi({
  metrics,
  atribucion,
  respuestasIa,
  sufijo,
}: {
  metrics: MetricsBundle
  atribucion: Atribucion | null
  /** Mensajes que escribió la IA en el período. */
  respuestasIa: number | null
  /** "vs 7 días previos", ya traducido. */
  sufijo: string
}) {
  const t = useT()
  const fmt = useFormat()

  const cargando = atribucion === null
  const sinTienda = !cargando && atribucion.not_connected === true
  const ventasTienda = atribucion?.totals?.revenue.current ?? 0
  const porRiverz = atribucion?.attributed

  const salientes = metrics.messagesSent.current

  return (
    <>
      {/* Sin tienda conectada no hay pedidos que atribuir y la tarjeta no
          aplica. Mientras todavía no se sabe se muestra con un guion: hacerla
          aparecer un segundo después correría las otras cinco de lugar justo
          cuando alguien las está leyendo. */}
      {!sinTienda && (
        <MetricCard
          title={t('dashboard.roiRevenue')}
          value={
            cargando
              ? '—'
              : fmt.currency(
                  porRiverz?.revenue ?? 0,
                  porRiverz?.currency ?? atribucion?.totals?.currency,
                )
          }
          icon={Sparkles}
          subtitle={
            cargando
              ? undefined
              : porRiverz && porRiverz.orders > 0
                ? t('dashboard.roiRevenueSub', {
                    orders: porRiverz.orders,
                    share:
                      ventasTienda > 0
                        ? Math.round((porRiverz.revenue / ventasTienda) * 100)
                        : 0,
                  })
                : t('dashboard.roiRevenueNone')
          }
        />
      )}

      <MetricCard
        title={t('dashboard.conversations')}
        value={fmt.number(metrics.conversations.current)}
        icon={MessageSquare}
        delta={delta(
          metrics.conversations.current,
          metrics.conversations.previous,
          sufijo,
          t,
          fmt.number,
        )}
      />
      <MetricCard
        title={t('dashboard.newContacts')}
        value={fmt.number(metrics.newContacts.current)}
        icon={UserPlus}
        delta={delta(
          metrics.newContacts.current,
          metrics.newContacts.previous,
          sufijo,
          t,
          fmt.number,
        )}
      />
      <MetricCard
        title={t('dashboard.messagesReceived')}
        value={fmt.number(metrics.messagesReceived.current)}
        icon={Inbox}
        delta={delta(
          metrics.messagesReceived.current,
          metrics.messagesReceived.previous,
          sufijo,
          t,
          fmt.number,
        )}
      />
      <MetricCard
        title={t('dashboard.messagesSent')}
        value={fmt.number(salientes)}
        icon={Send}
        delta={delta(salientes, metrics.messagesSent.previous, sufijo, t, fmt.number)}
      />
      <MetricCard
        title={t('dashboard.roiAiReplies')}
        value={respuestasIa === null ? '—' : fmt.number(respuestasIa)}
        icon={Bot}
        subtitle={
          respuestasIa !== null && salientes > 0
            ? t('dashboard.roiAiRepliesSub', {
                share: Math.min(100, Math.round((respuestasIa / salientes) * 100)),
              })
            : undefined
        }
      />
    </>
  )
}

type TFn = ReturnType<typeof useT>

function delta(
  actual: number,
  anterior: number,
  sufijo: string,
  t: TFn,
  formato: (v: number) => string,
) {
  const d = actual - anterior
  const label =
    d === 0
      ? t('dashboard.noChange', { suffix: sufijo })
      : t('dashboard.deltaChange', {
          delta: `${d > 0 ? '+' : '-'}${formato(Math.abs(d))}`,
          suffix: sufijo,
        })
  return { sign: d, label }
}
