'use client'

import { useState } from 'react'
import { Bot, Inbox, MessageSquare, Send, Sparkles, UserPlus } from 'lucide-react'
import { useT } from '@/hooks/use-locale'
import { useFormat } from '@/hooks/use-format'
import { MetricCard } from '@/components/dashboard/metric-card'
import { DetalleAtribucion } from '@/components/dashboard/detalle-atribucion'
import type { Atribucion } from '@/lib/dashboard/use-attribution'
import type { Cortes } from '@/lib/dashboard/cortes'
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
  cortes,
  sufijo,
}: {
  metrics: MetricsBundle
  atribucion: Atribucion | null
  /** Mensajes que escribió la IA en el período. */
  respuestasIa: number | null
  /** En cuántas conversaciones los escribió. Es lo que le da escala al número. */
  cortes?: Cortes | null
  /** "vs 7 días previos", ya traducido. */
  sufijo: string
}) {
  const t = useT()
  const fmt = useFormat()
  const [detalle, setDetalle] = useState(false)

  // "Todavía no sé" incluye el caso en que la tienda no contestó: un cero con
  // la moneda por defecto se lee como un dato y es peor que un guion.
  const cargando = atribucion === null || Boolean(atribucion.error)
  const sinTienda = atribucion?.not_connected === true
  const ventasTienda = atribucion?.totals?.revenue.current ?? 0
  // Lo que Riverz cerró Y lo que ayudó a cerrar, en una sola cifra.
  //
  // El comercio instala Riverz para automatizar la atención: si le hablamos a
  // alguien y esa persona compró, eso es retorno aunque el pedido no traiga
  // marca nuestra. Separarlo en dos números dejaba la mitad del trabajo
  // invisible.
  //
  // Lo que NO entra —y es la línea que no se cruza— es la venta donde no pasó
  // nada: ni un mensaje, ni una conversación. Esa no la cerramos ni la
  // ayudamos, y contarla es lo que hace que la cifra se caiga el día que el
  // comercio la discute. El detalle sigue mostrando las dos mitades por
  // separado, con su explicación.
  const probadas = atribucion?.attributed
  const influidas = atribucion?.assisted
  const porRiverz =
    probadas || influidas
      ? {
          revenue: (probadas?.revenue ?? 0) + (influidas?.revenue ?? 0),
          orders: (probadas?.orders ?? 0) + (influidas?.orders ?? 0),
          currency: probadas?.currency || influidas?.currency,
        }
      : undefined

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
              : // Sin centavos: el "00" de una cifra grande no cambia
                // ninguna decisión y le roba peso al número que importa.
                fmt.money(
                  porRiverz?.revenue ?? 0,
                  porRiverz?.currency ?? atribucion?.totals?.currency,
                )
          }
          icon={Sparkles}
          // Se abre para ver pedido por pedido de dónde sale. Una cifra que no
          // se puede verificar no se termina de creer.
          onClick={(porRiverz?.orders ?? 0) > 0 ? () => setDetalle(true) : undefined}
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

      <DetalleAtribucion data={atribucion} abierto={detalle} onAbierto={setDetalle} />


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
      {/* Cuánto escribió la IA, y en cuántas charlas.
       *
       * Antes el subtítulo era «{share}% de lo que salió», con TODOS los
       * mensajes salientes de denominador: difusiones, automatizaciones y lo
       * que escribe una persona. Contra eso el asistente nunca puede dar un
       * número grande —marcaba 4% en una cuenta que funciona— y esa tarjeta
       * terminaba diciendo lo contrario de lo que pasa. La escala honesta de
       * "15 mensajes" no es el total saliente: es en cuántas conversaciones
       * los escribió. Y si eso no se sabe, va el número solo. */}
      <MetricCard
        title={t('dashboard.roiAiReplies')}
        value={respuestasIa === null ? '—' : fmt.number(respuestasIa)}
        icon={Bot}
        subtitle={
          respuestasIa !== null && cortes && cortes.ia.atendidas > 0
            ? t('dashboard.roiAiRepliesConvs', {
                n: fmt.number(cortes.ia.atendidas),
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
