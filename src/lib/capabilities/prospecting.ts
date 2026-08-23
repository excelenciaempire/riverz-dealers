/**
 * Prospección: salir a buscar clientes por Instagram.
 *
 * Es el único dominio donde el mensaje NO contesta a nadie. En todo el resto de
 * la capa, del otro lado hay alguien que escribió primero; acá se le escribe a
 * una persona que sólo comentó una foto, y el permiso para hacerlo lo da Meta
 * por unos días y se vence. Por eso las descripciones lo dicen con todas las
 * letras: si el modelo no entiende que esto es alcance en frío, va a proponerlo
 * con la misma ligereza con la que propone responder un DM.
 *
 * Las cuatro capacidades siguen el mismo camino que la pantalla, con las mismas
 * funciones: `listAudienceContacts` para saber a quién se alcanza,
 * `createCampaignDraft` para guardar el plan y `launchCampaign` para encolar y
 * activar. Una campaña creada desde el chat y una creada a mano son la misma
 * fila y las gobiernan las mismas puertas: el interruptor de prospección, el
 * freno de emergencia, el tope diario y el opt-out de cada contacto.
 */
import {
  audienceCap,
  listAudienceContacts,
} from '@/lib/instagram-agent/resolve-audience'
import { createCampaignDraft } from '@/lib/instagram-agent/create-campaign'
import { launchCampaign } from '@/lib/instagram-agent/launch-campaign'
import { featureEnabled, proactiveGate } from '@/lib/instagram-agent/controls'
import { coercePlan, type InstagramPlan } from '@/lib/instagram-agent/types'
import type { Capability, CapabilityContext } from './types'

/** Campañas por consulta. Alcanza para la vista de una cuenta real. */
const TOPE_CAMPANAS = 25

/**
 * Cuántas filas de destinatarios se leen para contar el embudo.
 *
 * Supabase no agrupa: para saber cuántos van enviados hay que traer las filas o
 * hacer una consulta de conteo por campaña y por estado, que son decenas de
 * viajes. Se trae una sola vez y se cuenta en memoria. Cada campaña encola como
 * mucho 2000 personas (`audienceCap`), así que este techo cubre las 25 campañas
 * salvo en cuentas enormes, donde el conteo se marca como parcial en vez de
 * mentir.
 */
const TOPE_DESTINATARIOS = 20000

const ESTADOS_CAMPANA = ['draft', 'active', 'paused', 'done'] as const

interface FilaCampana {
  id: string
  name: string
  goal: string | null
  status: string
  offer_code: string | null
  holdout_pct: number | null
  plan: unknown
  metrics: Record<string, unknown> | null
  launched_at: string | null
  created_at: string
  updated_at: string
}

interface Embudo {
  total: number
  en_cola: number
  esperando_aprobacion: number
  contactados: number
  respondieron: number
  compraron: number
  descartados: number
  fallaron: number
  /** Grupo de control: reservados a propósito, no reciben nada. */
  en_control: number
}

function embudoVacio(): Embudo {
  return {
    total: 0,
    en_cola: 0,
    esperando_aprobacion: 0,
    contactados: 0,
    respondieron: 0,
    compraron: 0,
    descartados: 0,
    fallaron: 0,
    en_control: 0,
  }
}

const CAMPO_POR_ESTADO: Record<string, keyof Embudo> = {
  queued: 'en_cola',
  pending_review: 'esperando_aprobacion',
  sent: 'contactados',
  replied: 'respondieron',
  converted: 'compraron',
  skipped: 'descartados',
  failed: 'fallaron',
}

/**
 * El embudo real de cada campaña, no el estimado del plan.
 *
 * El plan promete ("contactar 300, 40 respuestas"); esto es lo que pasó. Las
 * dos cifras conviven a propósito en la respuesta: la distancia entre una y
 * otra es la única forma de ver que una campaña activa no está enviando.
 */
async function contarDestinatarios(
  ctx: CapabilityContext,
  campaignIds: string[],
): Promise<{ porCampana: Map<string, Embudo>; parcial: boolean }> {
  const porCampana = new Map<string, Embudo>()
  if (campaignIds.length === 0) return { porCampana, parcial: false }

  const { data } = await ctx.db
    .from('instagram_campaign_recipients')
    .select('campaign_id, status, is_holdout')
    .in('campaign_id', campaignIds)
    .limit(TOPE_DESTINATARIOS)

  const filas = (data ?? []) as Array<{
    campaign_id: string
    status: string
    is_holdout: boolean | null
  }>
  for (const f of filas) {
    const e = porCampana.get(f.campaign_id) ?? embudoVacio()
    e.total += 1
    if (f.is_holdout) e.en_control += 1
    const campo = CAMPO_POR_ESTADO[f.status]
    if (campo) e[campo] += 1
    porCampana.set(f.campaign_id, e)
  }
  return { porCampana, parcial: filas.length >= TOPE_DESTINATARIOS }
}

async function campanas(ctx: CapabilityContext, args: Record<string, unknown>) {
  const estado =
    typeof args.estado === 'string' &&
    (ESTADOS_CAMPANA as readonly string[]).includes(args.estado)
      ? args.estado
      : null

  let consulta = ctx.db
    .from('instagram_campaigns')
    .select(
      'id, name, goal, status, offer_code, holdout_pct, plan, metrics, launched_at, created_at, updated_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('updated_at', { ascending: false })
    .limit(TOPE_CAMPANAS)
  if (estado) consulta = consulta.eq('status', estado)

  const { data, error } = await consulta
  if (error) throw new Error(error.message)
  const filas = (data ?? []) as unknown as FilaCampana[]

  const { porCampana, parcial } = await contarDestinatarios(
    ctx,
    filas.map((c) => c.id),
  )

  return {
    total: filas.length,
    conteo_parcial: parcial,
    campanas: filas.map((c) => {
      const plan = coercePlan(c.plan)
      return {
        id: c.id,
        nombre: c.name,
        objetivo: c.goal,
        estado: c.status,
        codigo_oferta: c.offer_code,
        control_pct: c.holdout_pct ?? 0,
        alcance_estimado: plan?.audience.estimated_reach ?? 0,
        a_quien: plan?.audience.description ?? null,
        mensaje: plan?.message.text ?? null,
        lanzada: c.launched_at,
        creada: c.created_at,
        destinatarios: porCampana.get(c.id) ?? embudoVacio(),
        metricas: c.metrics ?? {},
      }
    }),
  }
}

/**
 * A cuánta gente se le puede escribir HOY.
 *
 * El número honesto no es "todos los contactos de Instagram": una tienda con
 * meses de historial tiene cientos que hoy son inalcanzables porque su ventana
 * de Meta se venció. Acá se cuenta lo mismo que después se encola, con la misma
 * función, para que el plan no prometa un alcance imposible.
 */
async function audiencia(ctx: CapabilityContext, args: Record<string, unknown>) {
  const tope = audienceCap(Number(args.alcance_maximo) || undefined)
  const [b, prendida, puerta] = await Promise.all([
    listAudienceContacts(ctx.db, ctx.workspaceId, tope),
    featureEnabled(ctx.db, ctx.workspaceId, 'outreach'),
    proactiveGate(ctx.db, ctx.workspaceId),
  ])

  return {
    alcanzables_ahora: b.merged.length,
    tope,
    // Las tres fuentes se pisan (quien comentó y además escribió por DM está en
    // las dos), así que la suma de estos tres no da el total de arriba.
    suscriptores: b.subscribers,
    comentaristas_7d: b.commenters,
    dm_24h: b.dmers,
    // De nada sirve el alcance si el envío está frenado: es la causa más común
    // de una campaña activa que no manda nada.
    envio_habilitado: prendida && puerta.ok,
    freno:
      !prendida
        ? 'la prospección está apagada en los ajustes de Instagram'
        : puerta.reason === 'paused'
          ? 'el freno de emergencia está puesto'
          : puerta.reason === 'daily_cap'
            ? 'ya se llegó al tope diario de DMs'
            : null,
  }
}

/**
 * Un plan mínimo desde argumentos que un modelo puede escribir.
 *
 * La pantalla manda el plan entero que generó Claude (con embudo estimado,
 * próximos pasos y respuesta a comentarios). Pedirle todo eso al chat sería
 * pedirle que rellene campos que nadie va a leer: acá van sólo los que deciden
 * algo —a quién, cuántos, qué se dice y con qué oferta— y el resto queda
 * vacío. `coercePlan` es el mismo portero que usa la ruta HTTP, así que
 * una campaña creada desde el chat no puede tener una forma que la pantalla no
 * sepa dibujar.
 */
function planDesdeArgs(args: Record<string, unknown>): InstagramPlan {
  const oferta = (args.oferta ?? null) as Record<string, unknown> | null
  const nombre = String(args.nombre ?? '').trim()
  const audienciaTexto = String(args.audiencia ?? '').trim()
  const mensaje = String(args.mensaje ?? '').trim()
  // `coercePlan` sólo mira que sean textos, y el texto vacío lo es: sin este
  // control se guardaba una campaña con el DM en blanco, que al lanzarse le
  // manda a cada persona lo que el modelo improvise sobre la nada.
  if (!nombre || !audienciaTexto || !mensaje) {
    // Legible para que el modelo corrija en la misma vuelta en vez de quedarse
    // reintentando lo mismo.
    throw new Error(
      'faltan datos para armar la campaña: se necesita nombre, a quién se le escribe (audiencia) y el mensaje.',
    )
  }

  const plan = coercePlan({
    campaign_name: nombre,
    audience: {
      description: audienciaTexto,
      source: '',
      estimated_reach: Number(args.alcance) || 0,
    },
    message: { text: mensaje },
    offer: oferta?.codigo
      ? {
          code: oferta.codigo,
          discount: oferta.descuento ?? '',
          conditions: oferta.condiciones ?? '',
        }
      : null,
    follow_up: String(args.seguimiento ?? ''),
    recommended_products: Array.isArray(args.productos) ? args.productos : [],
  })
  if (!plan) throw new Error('no se pudo armar el plan de la campaña con esos datos.')
  return plan
}

async function crearCampana(ctx: CapabilityContext, args: Record<string, unknown>) {
  const plan = planDesdeArgs(args)
  const objetivo = String(args.objetivo ?? '').trim()
  if (!objetivo) throw new Error('falta el objetivo: para qué es esta campaña.')

  const campana = await createCampaignDraft(ctx.db, {
    workspaceId: ctx.workspaceId,
    createdBy:
      ctx.actor.type === 'ui' || ctx.actor.type === 'operator' ? ctx.actor.id : null,
    goal: objetivo,
    plan,
    holdoutPct: args.control_pct,
  })

  return {
    ...campana,
    nota: 'Queda en borrador. No le escribe a nadie hasta que se lance.',
  }
}

interface CampanaParaPreview {
  id: string
  name: string
  status: string
  plan: unknown
  holdout_pct: number | null
}

async function cargarCampana(
  ctx: CapabilityContext,
  id: string,
): Promise<CampanaParaPreview | null> {
  const { data } = await ctx.db
    .from('instagram_campaigns')
    .select('id, name, status, plan, holdout_pct')
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  return (data as CampanaParaPreview | null) ?? null
}

function recorte(texto: string, largo = 220): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  return limpio.length > largo ? `${limpio.slice(0, largo)}…` : limpio
}

/**
 * Lo que lee la persona que autoriza el alcance en frío.
 *
 * Tiene que contestar las dos preguntas que importan y ninguna otra: a cuánta
 * gente y qué se le dice. Un preview que dijera "lanzaría la campaña X" no
 * alcanza — nadie puede autorizar un mensaje que no vio.
 */
async function previewLanzar(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
): Promise<string> {
  const campana = await cargarCampana(ctx, String(args.campaign_id))
  if (!campana) throw new Error('Esa campaña no existe en esta cuenta.')
  if (campana.status === 'done') {
    throw new Error(`«${campana.name}» ya está terminada: no se puede volver a lanzar.`)
  }

  const plan = coercePlan(campana.plan)
  if (!plan) {
    throw new Error(
      `«${campana.name}» todavía no se puede lanzar: su plan está incompleto (falta el mensaje o a quién se le escribe).`,
    )
  }

  // Quien ya tiene gente en cola sabe exactamente a cuántos; el resto todavía
  // no resolvió audiencia, y ahí se estima con la misma cuenta que va a usar el
  // lanzamiento. Se aclara cuál de las dos cosas es: una estimación presentada
  // como número exacto es peor que no dar número.
  const { count } = await ctx.db
    .from('instagram_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campana.id)
    .eq('status', 'queued')
    .eq('is_holdout', false)
  let personas = count ?? 0
  const exacto = personas > 0
  if (personas === 0) {
    const b = await listAudienceContacts(
      ctx.db,
      ctx.workspaceId,
      audienceCap(plan.audience.estimated_reach),
    )
    personas = b.merged.length
  }
  if (personas === 0) {
    // Lanzar algo que no le llega a nadie es un click que no hace nada.
    throw new Error(
      `«${campana.name}» no alcanza hoy a nadie: no hay comentarios de los últimos 7 días, DMs de las últimas 24 h ni suscriptores con permiso.`,
    )
  }

  const controlPct = campana.holdout_pct ?? 0
  const control = exacto ? 0 : Math.round((personas * controlPct) / 100)
  const reciben = personas - control

  const partes = [
    `Le escribiría por Instagram a ${exacto ? '' : 'unas '}${reciben} persona(s) que no pidieron nada: comentaron en los últimos 7 días, escribieron por DM en las últimas 24 h o dieron permiso de marketing.`,
  ]
  if (control > 0) {
    partes.push(
      `Otras ${control} quedan como grupo de control y no reciben nada, para poder medir si la campaña vendió de más.`,
    )
  }
  partes.push(`El mensaje base es: «${recorte(plan.message.text)}»`)
  partes.push('Cada DM se reescribe para cada persona a partir de ese texto.')

  const [prendida, puerta] = await Promise.all([
    featureEnabled(ctx.db, ctx.workspaceId, 'outreach'),
    proactiveGate(ctx.db, ctx.workspaceId),
  ])
  if (!prendida) {
    partes.push(
      'Aviso: la prospección está apagada en los ajustes de Instagram, así que la campaña quedaría activa sin enviar nada.',
    )
  } else if (!puerta.ok) {
    partes.push(
      puerta.reason === 'paused'
        ? 'Aviso: el freno de emergencia está puesto, así que no saldría ningún DM hasta que se quite.'
        : 'Aviso: ya se llegó al tope diario de DMs; los envíos arrancarían recién cuando el tope se libere.',
    )
  }
  partes.push('Un DM enviado no se puede deshacer.')
  return partes.join(' ')
}

const MOTIVO_FALLO: Record<string, string> = {
  not_found: 'esa campaña no existe en esta cuenta',
  already_done: 'esa campaña ya está terminada',
  no_valid_plan: 'el plan de la campaña está incompleto: le falta el mensaje o la audiencia',
  no_audience:
    'hoy no alcanza a nadie: no hay comentarios de los últimos 7 días, DMs de las últimas 24 h ni suscriptores con permiso',
}

async function lanzar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const resultado = await launchCampaign(ctx.db, String(args.campaign_id), {
    // El recorte por cuenta va acá y no en el schema: con la llave de servicio
    // no hay RLS que frene lanzar la campaña de otro comercio.
    workspaceId: ctx.workspaceId,
  })
  if (!resultado.ok) {
    throw new Error(
      resultado.code === 'error'
        ? resultado.message || 'no se pudo lanzar la campaña'
        : MOTIVO_FALLO[resultado.code],
    )
  }
  return {
    estado: resultado.status,
    en_cola: resultado.queued,
    nota: 'Los DMs salen de a tandas; el envío respeta el tope diario y el opt-out de cada persona.',
  }
}

export const PROSPECTING_CAPABILITIES: Capability[] = [
  {
    key: 'prospeccion.campanas',
    description:
      'Las campañas de prospección por Instagram con su estado (borrador, activa, pausada, terminada), a quién apuntan, el mensaje base y el embudo real: cuántos están en cola, a cuántos se les escribió, cuántos respondieron y cuántos compraron.',
    descriptionEn:
      'The Instagram prospecting campaigns with their status (draft, active, paused, done), who they target, the base message and the real funnel: how many are queued, how many were contacted, how many replied and how many bought.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        estado: {
          type: 'string',
          enum: [...ESTADOS_CAMPANA],
          description: 'Filtra por estado. Sin esto, todas.',
        },
      },
    },
    run: campanas,
  },

  {
    key: 'prospeccion.audiencia',
    description:
      'A cuánta gente de Instagram se le puede escribir HOY sin que la persona haya pedido nada, y por qué título: comentaristas de los últimos 7 días, quien mandó un DM en las últimas 24 h y quien dio permiso de marketing. Fuera de esas ventanas Meta no deja escribir. Dice también si el envío está frenado (prospección apagada, freno de emergencia o tope diario).',
    descriptionEn:
      'How many Instagram people can be messaged TODAY without them having asked for anything, and under which title: commenters from the last 7 days, anyone who sent a DM in the last 24h and anyone who gave marketing permission. Outside those windows Meta does not allow messaging. It also reports whether sending is blocked (outreach off, emergency stop or daily cap).',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        alcance_maximo: {
          type: 'number',
          description: 'Cuántas personas contar como mucho. Por defecto 200, máximo 2000.',
        },
      },
    },
    run: audiencia,
  },

  {
    key: 'prospeccion.crear_campana',
    description:
      'Guarda una campaña de prospección de Instagram como BORRADOR: el mensaje que se le mandaría a gente que no pidió nada, a quién y con qué oferta. No le escribe a nadie ni resuelve audiencia — eso pasa recién al lanzarla.',
    descriptionEn:
      'Saves an Instagram prospecting campaign as a DRAFT: the message that would be sent to people who did not ask for anything, to whom and with which offer. It messages nobody and resolves no audience — that only happens on launch.',
    risk: 'reversible',
    // Borrador: ni siquiera resuelve la audiencia. Eso pasa al lanzarla.
    inerte: true,
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Cómo se llama la campaña adentro de Riverz.' },
        objetivo: { type: 'string', description: 'Para qué es, en una línea.' },
        mensaje: {
          type: 'string',
          description:
            'El DM base. Se reescribe para cada persona con su nombre, lo que comentó y su código.',
        },
        audiencia: {
          type: 'string',
          description: 'A quién se le escribe, en palabras (queda a la vista del comercio).',
        },
        alcance: {
          type: 'number',
          description: 'Tope de personas a contactar. Por defecto 200, máximo 2000.',
        },
        oferta: {
          type: 'object',
          properties: {
            codigo: { type: 'string' },
            descuento: { type: 'string', description: 'Por ejemplo "15%".' },
            condiciones: { type: 'string' },
          },
          description: 'Con un porcentaje y Shopify conectado, cada persona recibe un código único.',
        },
        seguimiento: {
          type: 'string',
          description: 'Qué decir si la persona no contesta.',
        },
        productos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Títulos de productos que la campaña destaca.',
        },
        control_pct: {
          type: 'number',
          description:
            'Qué porcentaje de la audiencia NO recibe el mensaje, para medir si vendió de más. 0 a 50, por defecto 10.',
        },
      },
      required: ['nombre', 'objetivo', 'mensaje', 'audiencia'],
    },
    async preview(ctx, args) {
      const plan = planDesdeArgs(args)
      const tope = audienceCap(plan.audience.estimated_reach)
      return `Guardaría la campaña «${plan.campaign_name}» en borrador, con tope de ${tope} persona(s) y este mensaje: «${recorte(plan.message.text)}». No le escribe a nadie hasta que se lance.`
    },
    run: crearCampana,
  },

  {
    key: 'prospeccion.lanzar',
    description:
      'Lanza una campaña: arma la lista y empieza a mandarle DM por Instagram a gente que NO pidió nada (comentaron un post, escribieron hace poco o dieron permiso de marketing). Los mensajes salen solos de a tandas y no se pueden deshacer. Antes de proponerlo conviene mirar prospeccion.audiencia.',
    descriptionEn:
      'Launches a campaign: builds the list and starts sending Instagram DMs to people who did NOT ask for anything (they commented on a post, wrote recently or gave marketing permission). The messages go out automatically in batches and cannot be undone. Checking prospeccion.audiencia first is advisable.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        campaign_id: { type: 'string', description: 'De prospeccion.campanas.' },
      },
      required: ['campaign_id'],
    },
    preview: previewLanzar,
    run: lanzar,
  },
]
