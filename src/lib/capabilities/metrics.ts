/**
 * Cómo viene la cuenta.
 *
 * Esta es la capacidad que motivó toda la capa. Existían dos versiones de
 * "cuántos mensajes salieron": la del panel (`loadMetrics`, paginada, contando
 * todo lo que no es del cliente, en la zona horaria del comercio) y la del MCP
 * (sin paginar, contando sólo `agent|bot`, en ventanas UTC). Un comercio podía
 * mirar la pantalla y preguntarle al agente el mismo día y recibir dos números
 * distintos. Ahora hay uno.
 *
 * Lo que el panel no calcula —desempeño de la IA, pedidos, facturación— se
 * suma acá, porque son las preguntas que alguien le hace a un agente y no a un
 * gráfico.
 */
import { loadMetrics } from '@/lib/dashboard/queries'
import { daysAgoStart, previousRange } from '@/lib/dashboard/date-utils'
import { workspaceTimezone } from '@/lib/workspaces/timezone'
import { windowDays } from './predicates'
import type { Capability, CapabilityContext } from './types'

async function resumen(ctx: CapabilityContext, args: Record<string, unknown>) {
  const dias = windowDays(args.dias)
  const tz = await workspaceTimezone(ctx.db, ctx.workspaceId)

  // Días CALENDARIO en la zona del comercio, no una ventana rodante de N×24 h:
  // es lo que hace el filtro del panel, y es lo que una persona quiere decir
  // cuando pide "los últimos 7 días".
  const range = { start: daysAgoStart(tz, dias - 1), end: new Date() }
  const prev = previousRange(range)

  const [bundle, ia, pedidos] = await Promise.all([
    loadMetrics(ctx.db, tz, range, prev, { workspaceId: ctx.workspaceId }),
    ctx.db
      .from('ai_replies')
      .select('status')
      .eq('workspace_id', ctx.workspaceId)
      .gte('created_at', range.start.toISOString()),
    ctx.db
      .from('orders')
      .select('total_price, currency')
      .eq('workspace_id', ctx.workspaceId)
      .gte('created_at', range.start.toISOString()),
  ])

  const replies = (ia.data ?? []) as { status: string }[]
  const ords = (pedidos.data ?? []) as {
    total_price: number | string | null
    currency: string | null
  }[]

  return {
    periodo: {
      dias,
      desde: range.start.toISOString(),
      hasta: range.end.toISOString(),
      zona_horaria: tz,
    },
    // `actual` y `anterior` van juntos porque un número solo no dice nada:
    // 40 conversaciones es bueno o malo según si la semana pasada fueron 10.
    conversaciones: bundle.conversations,
    contactos_nuevos: bundle.newContacts,
    resueltas: bundle.resolved,
    mensajes_entrantes: bundle.messagesReceived,
    mensajes_salientes: bundle.messagesSent,
    por_canal: bundle.channelMix,
    ia: {
      respondio: replies.filter((r) => r.status === 'sent').length,
      se_abstuvo: replies.filter((r) => r.status === 'skipped').length,
      fallo: replies.filter((r) => r.status === 'failed').length,
    },
    pedidos: {
      cantidad: ords.length,
      facturado: Number(
        ords.reduce((a, o) => a + (Number(o.total_price) || 0), 0).toFixed(2),
      ),
      moneda: ords[0]?.currency ?? null,
    },
  }
}

export const METRICS_CAPABILITIES: Capability[] = [
  {
    key: 'metricas.resumen',
    description:
      'Cómo viene la cuenta en un período: conversaciones, contactos nuevos, mensajes que entraron y salieron, mezcla por canal, cuántas contestó la IA, pedidos y facturación. Cada cifra viene con la del período anterior para poder comparar. Es el "¿cómo vamos?".',
    descriptionEn:
      'How the account is doing over a period: conversations, new contacts, messages in and out, channel mix, how many the AI answered, orders and revenue. Every figure comes with the previous period to compare against. The "how are we doing?".',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Ventana hacia atrás. Por defecto 7, máximo 90.' },
      },
    },
    run: resumen,
  },
]
