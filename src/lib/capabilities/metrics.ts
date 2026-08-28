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
import { MINIMO_PARA_PORCENTAJE, leerCortes } from '@/lib/dashboard/cortes'
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

  // `actual` y `anterior` van juntos porque un número solo no dice nada: 40
  // conversaciones es bueno o malo según si la semana pasada fueron 10. Y van
  // en español como el resto de la respuesta — el modelo lee estas claves, y
  // media respuesta en cada idioma se presta a que invente el nombre que falta.
  const par = (d: { current: number; previous: number }) => ({
    actual: d.current,
    anterior: d.previous,
  })

  return {
    periodo: {
      dias,
      desde: range.start.toISOString(),
      hasta: range.end.toISOString(),
      zona_horaria: tz,
    },
    conversaciones: par(bundle.conversations),
    contactos_nuevos: par(bundle.newContacts),
    resueltas: par(bundle.resolved),
    mensajes_entrantes: par(bundle.messagesReceived),
    mensajes_salientes: par(bundle.messagesSent),
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

/**
 * QUIÉN ATENDIÓ.
 *
 * `metricas.resumen` cuenta el volumen: cuántas conversaciones, cuántos
 * mensajes, cuánto se facturó. No dice quién hizo ese trabajo, y esa es la
 * pregunta que sigue: cuánto resolvió la IA sola, dónde se abstiene y por qué,
 * y cuánto contestó a una hora en la que no había nadie.
 *
 * Es el mismo `leerCortes` que dibuja la pantalla de Inicio: dos números para
 * la misma pregunta es peor que ninguno.
 */
async function cortes(ctx: CapabilityContext, args: Record<string, unknown>) {
  const dias = windowDays(args.dias)
  const tz = await workspaceTimezone(ctx.db, ctx.workspaceId)
  const desde = daysAgoStart(tz, dias - 1)
  const hasta = new Date()

  const c = await leerCortes(ctx.db, ctx.workspaceId, { desde, hasta }, tz)

  return {
    periodo: { dias, desde: desde.toISOString(), hasta: hasta.toISOString(), zona_horaria: tz },
    por_canal: c.canales,
    por_agente: c.agentes,
    ia: {
      atendidas: c.ia.atendidas,
      // Resuelta = la atendió la IA y NUNCA necesitó a una persona.
      resueltas: c.ia.resueltas,
      tasa: c.ia.tasa,
      tasa_anterior: c.ia.tasaPrevia,
      calificaron: c.ia.calificaron,
      satisfaccion: c.ia.satisfaccion,
      // Bajo este piso un porcentaje engaña más de lo que informa.
      minimo_para_porcentaje: MINIMO_PARA_PORCENTAJE,
    },
    // Lo que una persona no habría contestado: a las tres de la mañana no
    // estaba nadie. Es el número que no admite el "lo hacíamos igual".
    fuera_de_horario: {
      atendidas: c.fueraDeHorario.atendidas,
      total: c.fueraDeHorario.total,
      falta_cargar_horario: c.fueraDeHorario.sinHorario,
    },
    primera_respuesta: c.respuesta,
    // Dónde se planta la IA, agrupado por motivo.
    escalaciones: c.escalaciones,
  }
}

export const METRICS_CAPABILITIES: Capability[] = [
  {
    key: 'metricas.cortes',
    description:
      'Quién atendió: cuánto resolvió la IA sola (y cómo venía antes), cuánto tarda la primera respuesta, qué hizo cada agente y dónde se abstiene, el corte por canal, y cuántas conversaciones atendió fuera del horario del comercio — ese es el trabajo que ninguna persona habría hecho. Es el paso siguiente a metricas.resumen, que sólo cuenta volumen.',
    descriptionEn:
      'Who did the work: how much the AI resolved on its own (and how that compares to before), how long the first reply takes, what each agent did and where it abstains, the per-channel breakdown, and how many conversations were handled outside business hours — that is work no person would have done. The step after metricas.resumen, which only counts volume.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: { dias: { type: 'number', description: 'Ventana en días. Por defecto 7.' } },
    },
    run: cortes,
  },
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
