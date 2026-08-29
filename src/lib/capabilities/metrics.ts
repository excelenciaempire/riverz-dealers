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
import { leerAtribucion } from '@/lib/attribution/informe'
import { MINIMO_PARA_PORCENTAJE, leerCortes } from '@/lib/dashboard/cortes'
import { loadMetrics } from '@/lib/dashboard/queries'
import { daysAgoStart, previousRange } from '@/lib/dashboard/date-utils'
import { workspaceTimezone } from '@/lib/workspaces/timezone'
import type { Artefacto } from '@/lib/operator/artifacts'
import { translate } from '@/lib/i18n/translate'
import { windowDays } from './predicates'
import { cifras, lista, loc, numero, plata, tieneCampos, tile, tt } from './vistas'
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

/**
 * CUÁNTO VENDIÓ RIVERZ, Y CUÁNTO SÓLO PASÓ CERCA.
 *
 * La distinción es el producto entero: "le hablamos y después compró" no prueba
 * nada —esa persona también vio un anuncio y le llegó un correo—, así que hay
 * dos cifras y NO se suman. Probada es el pedido que trae una marca que puso
 * Riverz: el link de pago lo armó el asistente, el pedido lo creó él, el carrito
 * salía del chat, entró con un cupón emitido para esa persona. Influida es la
 * correlación temporal, que es lo que reporta cualquier panel de anuncios.
 *
 * Usa el MISMO `leerAtribucion` que dibuja la pantalla. Es lento a propósito —
 * le pide los pedidos a la tienda en vivo— porque la marca viaja en el pedido
 * de Shopify y no en nuestra base.
 */
async function atribucion(ctx: CapabilityContext, args: Record<string, unknown>) {
  const dias = windowDays(args.dias)
  const hasta = new Date()
  const desde = new Date(hasta.getTime() - dias * 86_400_000)
  // La ventana de last-touch para la parte influida: cuánto antes del pedido
  // cuenta un mensaje como el que lo causó. 24 h es el default de la pantalla.
  const horas = Math.max(1, Math.min(720, Number(args.horas_de_ventana) || 24))

  const informe = (await leerAtribucion(ctx.db, {
    workspaceId: ctx.workspaceId,
    sinceIso: desde.toISOString(),
    untilIso: hasta.toISOString(),
    days: dias,
    lookbackMs: horas * 3_600_000,
    locale: ctx.locale ?? 'es',
  })) as {
    not_connected?: boolean
    error?: string
    totals?: { revenue?: { current: number; previous: number }; orders?: { current: number; previous: number }; currency?: string | null }
    attributed?: { revenue: number; orders: number; currency: string | null }
    assisted?: { revenue: number; orders: number; currency: string | null }
    by_handler?: Record<string, { orders: number; revenue: number }>
    by_broadcast?: unknown[]
    by_flow?: unknown[]
    by_automation?: unknown[]
    by_agent?: unknown[]
    by_instagram_agent?: unknown[]
  }

  if (informe.not_connected) {
    return { conectado: false, nota: 'Esta cuenta no tiene la tienda conectada, así que no hay pedidos que atribuir.' }
  }
  if (informe.error) {
    return { conectado: true, error: informe.error, nota: 'La tienda no contestó: la cifra de este rango no se puede calcular ahora.' }
  }

  return {
    periodo: { dias, desde: desde.toISOString(), hasta: hasta.toISOString() },
    moneda: informe.totals?.currency ?? null,
    // Todo lo que vendió el comercio en el rango, para poder poner la cifra de
    // Riverz en escala.
    venta_total: informe.totals?.revenue?.current ?? 0,
    venta_total_periodo_anterior: informe.totals?.revenue?.previous ?? 0,
    pedidos_totales: informe.totals?.orders?.current ?? 0,
    // PROBADA: el pedido trae una marca que puso Riverz. Es la cifra que se
    // defiende sola.
    probada: informe.attributed ?? null,
    // INFLUIDA: habló con Riverz antes y compró, sin marca. Se muestra, se
    // explica y NO se suma a la anterior.
    influida: informe.assisted ?? null,
    // De lo probado, cuánto lo cerró la IA y cuánto una persona.
    quien_lo_cerro: informe.by_handler ?? null,
    por_campana: informe.by_broadcast ?? [],
    por_flujo: informe.by_flow ?? [],
    por_automatizacion: informe.by_automation ?? [],
    por_agente: informe.by_agent ?? [],
    horas_de_ventana: horas,
  }
}


/**
 * Las tres métricas, dibujadas.
 *
 * Se calculan desde el RESULTADO y no desde los argumentos: son lecturas, ya
 * corrieron y no hay nada que aprobar. Viven acá abajo y no dentro de cada
 * capacidad para que las tres compartan el formato de plata y de porcentaje,
 * que es la misma razón por la que existe toda esta capa.
 */

function vistaResumen(
  ctx: CapabilityContext,
  r: Awaited<ReturnType<typeof resumen>>,
): Artefacto | null {
  if (!tieneCampos(r, 'periodo', 'conversaciones')) return null
  const t = (k: string) => tt(ctx, `operation.${k}`)
  return cifras({
    titulo: t('vTitMetricas'),
    bajada: translate(loc(ctx), 'operation.vUltimosDias', { dias: r.periodo.dias }),
    tiles: [
      tile(ctx, t('vConversaciones'), r.conversaciones.actual, r.conversaciones.anterior),
      tile(ctx, t('vContactosNuevos'), r.contactos_nuevos.actual, r.contactos_nuevos.anterior),
      tile(ctx, t('vResueltas'), r.resueltas.actual, r.resueltas.anterior),
      tile(ctx, t('vEntrantes'), r.mensajes_entrantes.actual, r.mensajes_entrantes.anterior),
      tile(ctx, t('vSalientes'), r.mensajes_salientes.actual, r.mensajes_salientes.anterior),
      tile(ctx, t('vRespondioIa'), r.ia.respondio),
      tile(ctx, t('vPedidos'), r.pedidos.cantidad),
      { etiqueta: t('vFacturado'), valor: plata(ctx, r.pedidos.facturado, r.pedidos.moneda) },
    ],
    // La mezcla por canal es la única serie que se explica sin ejes: de dónde
    // viene la gente. Los demás cortes son listas y no barras.
    serie: lista<{ channel: string; inbound: number; outbound: number }>(r, 'por_canal').map((c) => ({
      etiqueta: c.channel,
      valor: c.inbound + c.outbound,
    })),
  })
}

/**
 * Lo vendido, con la línea que sostiene el producto entero: probada e influida
 * NO se suman. Dibujarlas una al lado de la otra sin totalizarlas es la forma
 * de que eso se lea, en vez de explicarse en un párrafo que nadie lee.
 *
 * Sin tienda conectada no se dibuja nada: un tablero de ceros parece un mal
 * resultado y lo que pasa es que no hay de dónde sacar el dato.
 */
function vistaAtribucion(
  ctx: CapabilityContext,
  r: Awaited<ReturnType<typeof atribucion>>,
): Artefacto | null {
  // Sin tienda conectada el resultado ni siquiera trae estos campos: no hay
  // nada que dibujar, y un tablero de ceros se lee como un mal resultado.
  if (!tieneCampos(r, 'probada', 'periodo')) return null
  if (!('probada' in r) || !r.probada || !('periodo' in r)) return null
  const t = (k: string) => tt(ctx, `operation.${k}`)
  const pedidos = t('vPedidos').toLowerCase()
  const tiles: {
    etiqueta: string
    valor: string
    delta?: string
    tono?: 'bueno' | 'malo' | 'neutro'
  }[] = [
    {
      etiqueta: t('vProbada'),
      valor: plata(ctx, r.probada.revenue, r.probada.currency ?? r.moneda),
      delta: `${numero(ctx, r.probada.orders)} ${pedidos}`,
      tono: 'neutro',
    },
    {
      etiqueta: t('vInfluida'),
      valor: plata(ctx, r.influida?.revenue ?? 0, r.influida?.currency ?? r.moneda),
      delta: `${numero(ctx, r.influida?.orders ?? 0)} ${pedidos}`,
      tono: 'neutro',
    },
    {
      etiqueta: t('vVentaTotal'),
      valor: plata(ctx, r.venta_total, r.moneda),
      delta: `${numero(ctx, r.pedidos_totales)} ${pedidos}`,
      tono: 'neutro',
    },
  ]

  const cerro = (r.quien_lo_cerro ?? {}) as Record<string, { orders: number; revenue: number }>
  for (const [quien, clave] of [
    ['ai', 'vCerroIa'],
    ['human', 'vCerroPersona'],
  ] as const) {
    const d = cerro[quien]
    if (!d) continue
    tiles.push({
      etiqueta: t(clave),
      valor: plata(ctx, d.revenue, r.probada.currency ?? r.moneda),
      delta: `${numero(ctx, d.orders)} ${pedidos}`,
      tono: 'neutro',
    })
  }

  return cifras({
    titulo: t('vTitAtribucion'),
    bajada: translate(loc(ctx), 'operation.vUltimosDias', { dias: r.periodo.dias }),
    tiles,
  })
}

/**
 * Quién atendió.
 *
 * El tiempo de respuesta lleva `mejorEsMas` al revés: es la única cifra del
 * panel donde crecer es una mala noticia, y pintarla de verde por subir era
 * decir lo contrario de lo que pasó.
 */
function vistaCortes(
  ctx: CapabilityContext,
  r: Awaited<ReturnType<typeof cortes>>,
): Artefacto | null {
  if (!tieneCampos(r, 'periodo', 'ia', 'primera_respuesta', 'fuera_de_horario', 'escalaciones')) {
    return null
  }
  const t = (k: string) => tt(ctx, `operation.${k}`)
  const tiles: {
    etiqueta: string
    valor: string
    delta?: string
    tono?: 'bueno' | 'malo' | 'neutro'
  }[] = []

  if (r.ia.tasa !== null) {
    tiles.push({
      ...tile(ctx, t('vResolvioIa'), Math.round(r.ia.tasa), r.ia.tasa_anterior ?? undefined),
      valor: `${Math.round(r.ia.tasa)} %`,
    })
  }
  if (r.primera_respuesta.ia !== null) {
    tiles.push({
      etiqueta: t('vPrimeraRespuesta'),
      valor: duracion(r.primera_respuesta.ia),
      tono: 'neutro',
    })
  }
  tiles.push(tile(ctx, t('vFueraDeHorario'), r.fuera_de_horario.atendidas))
  tiles.push(tile(ctx, t('vSeAbstuvo'), r.escalaciones.total, undefined, false))

  return cifras({
    titulo: t('vTitCortes'),
    bajada: translate(loc(ctx), 'operation.vUltimosDias', { dias: r.periodo.dias }),
    tiles,
    serie: lista<{ canal: string; conversaciones: number }>(r, 'por_canal').map((c) => ({
      etiqueta: c.canal,
      valor: c.conversaciones,
    })),
  })
}

/** Segundos, en la unidad que se lee sin dividir mentalmente. */
function duracion(segundos: number): string {
  if (segundos < 60) return `${Math.round(segundos)} s`
  if (segundos < 3600) return `${Math.round(segundos / 60)} min`
  return `${(segundos / 3600).toFixed(1)} h`
}
export const METRICS_CAPABILITIES: Capability[] = [
  {
    key: 'metricas.atribucion',
    description:
      'Cuánto vendió Riverz, separado en dos cifras que NO se suman. PROBADA: el pedido trae una marca que puso Riverz (el link de pago lo armó el asistente, el pedido lo creó él, el carrito salía del chat, entró con un cupón emitido para esa persona) — es la que se defiende sola. INFLUIDA: habló con Riverz antes y compró, sin marca; es la misma correlación que reporta cualquier panel de anuncios. Trae además cuánto cerró la IA y cuánto una persona, y el corte por campaña, flujo y automatización. Tarda: le pide los pedidos a la tienda en vivo.',
    descriptionEn:
      'How much Riverz sold, split into two figures that are NOT added together. PROVEN: the order carries a mark Riverz put on it (the checkout link was built by the assistant, the order was created by it, the cart came from the chat, it came in with a coupon issued to that person) — the figure that holds up on its own. ASSISTED: they talked to Riverz before and bought, with no mark; the same correlation any ads dashboard reports. It also brings how much the AI closed versus a person, and the breakdown by campaign, flow and automation. It is slow: it asks the store for the orders live.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Ventana en días. Por defecto 7.' },
        horas_de_ventana: {
          type: 'number',
          description:
            'Cuántas horas antes del pedido cuenta un mensaje como el que lo causó, para la parte INFLUIDA. Por defecto 24.',
        },
      },
    },
    run: atribucion,
    vista: (ctx, _args, r) => vistaAtribucion(ctx, r as Awaited<ReturnType<typeof atribucion>>),
  },
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
    vista: (ctx, _args, r) => vistaCortes(ctx, r as Awaited<ReturnType<typeof cortes>>),
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
    vista: (ctx, _args, r) => vistaResumen(ctx, r as Awaited<ReturnType<typeof resumen>>),
  },
]
