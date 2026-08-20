'use client'

import { Bot, Clock, DollarSign, MessageSquare, Receipt, Sparkles } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { MetricCard } from '@/components/dashboard/metric-card'
import type { Atribucion } from '@/lib/dashboard/use-attribution'
import type { MetricsBundle, ResponseTimeReport } from '@/lib/dashboard/types'

/**
 * Lo que Riverz devuelve, no lo que Riverz mueve.
 *
 * Antes acá había volumen —mensajes que entraron, mensajes que salieron,
 * contactos nuevos, automatizaciones activas, canales conectados—. Todo eso
 * sube igual si la cuenta anda bien o si anda mal: son cifras que no responden
 * la única pregunta que se hace quien paga, que es si le conviene seguir
 * pagando.
 *
 * Estas seis sí. Tres son plata (cuánto entró por Riverz, cuánto vendió la
 * tienda, cuánto vale un pedido) y tres son el trabajo que Riverz hizo en lugar
 * de una persona (cuánto contestó la IA, cuánta demanda llegó, cuánto tarda la
 * primera respuesta).
 *
 * "Automatizaciones activas" no está a propósito: tener cuatro prendidas no es
 * un logro, es una configuración. Lo que importa es cuánto facturaron, y eso
 * está en el desglose de abajo.
 */
export function TarjetasRoi({
  metrics,
  atribucion,
  responseTime,
  respuestasIa,
  sufijo,
}: {
  metrics: MetricsBundle
  atribucion: Atribucion | null
  responseTime: ResponseTimeReport | null
  /** Mensajes que escribió la IA en el período. */
  respuestasIa: number | null
  /** "vs 7 días previos", ya traducido. */
  sufijo: string
}) {
  const t = useT()
  const fmt = useFormat()

  const moneda = atribucion?.totals?.currency
  const ventasTienda = atribucion?.totals?.revenue.current ?? 0
  const ventasPrevias = atribucion?.totals?.revenue.previous ?? 0
  const pedidos = atribucion?.totals?.orders.current ?? 0
  const pedidosPrevios = atribucion?.totals?.orders.previous ?? 0
  const porRiverz = atribucion?.attributed

  // Sin tienda conectada no hay plata que mostrar y las tres tarjetas de
  // comercio no aplican. Mientras todavía no se sabe, se muestran con un
  // guion: esconderlas y hacerlas aparecer un segundo después movería de lugar
  // las otras tres justo cuando alguien las está leyendo.
  const cargando = atribucion === null
  const hayComercio = cargando || !atribucion.not_connected
  const plata = (v: number) => (cargando ? '—' : fmt.currency(v, moneda))

  const aov = pedidos > 0 ? ventasTienda / pedidos : 0
  const aovPrev = pedidosPrevios > 0 ? ventasPrevias / pedidosPrevios : 0

  const salientes = metrics.messagesSent.current
  const primera = responseTime?.first.thisPeriodAvg ?? null
  const primeraPrev = responseTime?.first.prevPeriodAvg ?? null

  return (
    <>
      {hayComercio && (
        <>
          <MetricCard
            title={t('dashboard.roiRevenue')}
            value={
              cargando
                ? '—'
                : fmt.currency(porRiverz?.revenue ?? 0, porRiverz?.currency ?? moneda)
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
          <MetricCard
            title={t('dashboard.roiStoreRevenue')}
            value={plata(ventasTienda)}
            icon={DollarSign}
            delta={
              cargando
                ? undefined
                : delta(ventasTienda, ventasPrevias, sufijo, t, (v) =>
                    fmt.currency(v, moneda),
                  )
            }
          />
          <MetricCard
            title={t('dashboard.roiAov')}
            value={plata(aov)}
            icon={Receipt}
            delta={
              cargando
                ? undefined
                : delta(aov, aovPrev, sufijo, t, (v) => fmt.currency(v, moneda))
            }
          />
        </>
      )}

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
        title={t('dashboard.roiFirstReply')}
        value={
          primera === null
            ? t('dashboard.roiNoData')
            : t('dashboard.roiMinutes', { n: fmt.number(Math.round(primera)) })
        }
        icon={Clock}
        // Acá menos es mejor: bajar de 40 a 12 minutos tiene que verse verde,
        // no rojo. Por eso el signo va invertido.
        delta={
          primera !== null && primeraPrev !== null
            ? invertir(
                delta(
                  Math.round(primera),
                  Math.round(primeraPrev),
                  sufijo,
                  t,
                  (v) => t('dashboard.roiMinutes', { n: fmt.number(v) }),
                ),
              )
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

function invertir(d: { sign: number; label: string }) {
  return { sign: -d.sign, label: d.label }
}
