/**
 * Comentarios de Instagram y Facebook.
 *
 * Lo que se escribe en un comentario lo lee cualquiera: el que preguntó, los
 * otros mil que pasan por esa publicación y —si es un anuncio— todo el público
 * que la campaña siga alcanzando mañana. Por eso este dominio separa dos cosas
 * que parecen la misma: la respuesta PÚBLICA bajo el comentario y el DM PRIVADO
 * que le llega sólo a esa persona. Las descripciones lo dicen en cada capacidad
 * porque es la diferencia que quien aprueba tiene que tener presente.
 *
 * Las reglas comentario→DM se guardan con las mismas funciones que usa el
 * formulario de Ajustes (`comment-to-dm/rules.ts`) y el `preview` arma el
 * mensaje con el mismo `composeDmText` que usa el motor al enviar: lo que se
 * aprueba es, literalmente, lo que sale.
 */
import {
  composeDmText,
  getRule,
  listRulesWithCounts,
  ruleFields,
  setRuleActive,
  type CommentRule,
  type CommentRuleChannel,
} from '@/lib/comment-to-dm/rules'
import {
  autoReplyCommentsEnabled,
  loadCommentSettings,
} from '@/lib/instagram-agent/controls'
import { PENDING_SENDER, hoursWaiting } from './predicates'
import type { Capability, CapabilityContext } from './types'

/** Cuántos comentarios sin responder devuelve como mucho una llamada. */
const TOPE_PENDIENTES = 50

const CANAL_DE: Record<string, CommentRuleChannel> = {
  instagram: 'ig_comment',
  facebook: 'fb_comment',
  ambas: 'both',
}
/** Las redes de verdad: donde vive una conversación. 'both' no es una de ellas. */
type CommentChannel = 'ig_comment' | 'fb_comment'

const RED: Record<CommentRuleChannel, string> = {
  ig_comment: 'Instagram',
  fb_comment: 'Facebook',
  both: 'Instagram y Facebook',
}

/**
 * El canal pedido, o los dos. Hacia afuera se habla de redes, no de tablas.
 *
 * 'both' no entra nunca: es un valor de REGLA —una regla que escucha las dos
 * redes— y ninguna conversación se guarda con ese canal. Pedir "ambas" es
 * pedir las dos redes de verdad.
 */
function canalesPedidos(args: Record<string, unknown>): CommentChannel[] {
  const pedido =
    typeof args.canal === 'string' ? CANAL_DE[args.canal.trim().toLowerCase()] : undefined
  return pedido === 'ig_comment' || pedido === 'fb_comment'
    ? [pedido]
    : ['ig_comment', 'fb_comment']
}

const ESQUEMA_CANAL = {
  type: 'string',
  enum: ['instagram', 'facebook', 'ambas'],
} as const

/**
 * Con qué criterio contesta hoy la IA los comentarios.
 *
 * Va junto a los pendientes porque es la respuesta a la pregunta que sigue.
 * "Tengo veinte comentarios sin responder" se explica casi siempre por acá: el
 * piso autónomo apagado, o encendido pero hablándole sólo a quien muestra
 * intención de compra, o sin Facebook.
 */
async function comoContestaLaIa(ctx: CapabilityContext) {
  const [contesta, cfg] = await Promise.all([
    autoReplyCommentsEnabled(ctx.db, ctx.workspaceId),
    loadCommentSettings(ctx.db, ctx.workspaceId),
  ])
  return {
    contesta,
    a_quien:
      cfg.audience === 'all'
        ? 'a todo el que pregunte'
        : 'solo a quien muestra intención de compra',
    responde_en_publico: cfg.publicReply,
    redes: [cfg.instagram && 'Instagram', cfg.facebook && 'Facebook'].filter(
      Boolean,
    ),
  }
}

interface HiloPendiente {
  id: string
  channel: CommentRuleChannel
  last_message_at: string | null
  last_message_text: string | null
  unread_count: number | null
  is_ad: boolean | null
  contacts: { name: string | null } | null
}

interface UltimoComentario {
  conversation_id: string
  message_id: string | null
  content_text: string | null
  is_hidden: boolean | null
  comments_meta:
    | { permalink: string | null; post_id: string | null }
    | { permalink: string | null; post_id: string | null }[]
    | null
}

async function pendientes(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 20, TOPE_PENDIENTES)
  const canales = canalesPedidos(args)

  // "Sin responder" es la misma definición que en toda la app: el último que
  // habló fue la persona de afuera. Un hilo cerrado ya se atendió aunque el
  // último mensaje sea suyo.
  const { data } = await ctx.db
    .from('conversations')
    .select(
      'id, channel, last_message_at, last_message_text, unread_count, is_ad, contacts(name)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .in('channel', canales)
    .is('deleted_at', null)
    .neq('status', 'closed')
    .eq('last_sender_type', PENDING_SENDER)
    .order('last_message_at', { ascending: true })
    .limit(limite)

  const hilos = (data ?? []) as unknown as HiloPendiente[]

  // El total por red se cuenta aparte, no sobre la lista: con veinte traídos y
  // ciento veinte esperando, contar lo devuelto diría que hay veinte.
  const conteos = await Promise.all(
    canales.map(async (canal) => {
      const { count } = await ctx.db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', ctx.workspaceId)
        .eq('channel', canal)
        .is('deleted_at', null)
        .neq('status', 'closed')
        .eq('last_sender_type', PENDING_SENDER)
      return [RED[canal], count ?? 0] as const
    }),
  )
  const por_canal = Object.fromEntries(conteos)

  const ia = await comoContestaLaIa(ctx)
  if (hilos.length === 0) return { ia, por_canal, comentarios: [] }

  // El comentario concreto que quedó sin responder es el ÚLTIMO del hilo, y su
  // `created_at` es exactamente el `last_message_at` de la conversación (los
  // escribe el mismo evento). Pedirlos por ese instante trae uno por hilo en
  // una sola consulta; traer "los últimos N mensajes de estos hilos" habría
  // dejado sin comentario justo a los más viejos, que son los que más importan.
  const instantes = hilos
    .map((h) => h.last_message_at)
    .filter((t): t is string => Boolean(t))
  const { data: msgs } = instantes.length
    ? await ctx.db
        .from('messages')
        .select(
          'conversation_id, message_id, content_text, is_hidden, comments_meta(permalink, post_id)',
        )
        .in(
          'conversation_id',
          hilos.map((h) => h.id),
        )
        .eq('sender_type', 'customer')
        .in('created_at', instantes)
    : { data: [] }

  const ultimoDe = new Map<string, UltimoComentario>()
  for (const m of (msgs ?? []) as unknown as UltimoComentario[]) {
    if (!ultimoDe.has(m.conversation_id)) ultimoDe.set(m.conversation_id, m)
  }

  // ¿Alguna regla ya le mandó el DM privado? Cambia por completo qué hacer con
  // el pendiente: la persona ya recibió respuesta, lo que falta es la parte
  // pública. Sin esto, un comentario atendido parece abandonado.
  const externos = [...ultimoDe.values()]
    .map((m) => m.message_id)
    .filter((id): id is string => Boolean(id))
  const conDm = new Set<string>()
  if (externos.length > 0) {
    const { data: log } = await ctx.db
      .from('comment_to_dm_log')
      .select('comment_external_id, dm_status')
      .eq('workspace_id', ctx.workspaceId)
      .eq('dm_status', 'sent')
      .in('comment_external_id', externos)
    for (const row of (log ?? []) as { comment_external_id: string }[]) {
      conDm.add(row.comment_external_id)
    }
  }

  return {
    ia,
    por_canal,
    comentarios: hilos.map((h) => {
      const m = ultimoDe.get(h.id)
      const meta = Array.isArray(m?.comments_meta) ? m?.comments_meta[0] : m?.comments_meta
      return {
        conversation_id: h.id,
        canal: RED[h.channel],
        persona: h.contacts?.name ?? 'sin nombre',
        comentario: m?.content_text ?? h.last_message_text,
        horas_esperando: hoursWaiting(h.last_message_at),
        sin_leer: h.unread_count ?? 0,
        es_anuncio: h.is_ad === true,
        publicacion: meta?.post_id ?? null,
        enlace: meta?.permalink ?? null,
        // Ocultarlo también es atenderlo: se muestra para que no se conteste
        // dos veces un comentario que el comercio ya sacó de la vista.
        oculto: m?.is_hidden === true,
        dm_de_regla: m?.message_id ? conDm.has(m.message_id) : false,
      }
    }),
  }
}

async function reglas(ctx: CapabilityContext) {
  const { rules, error } = await listRulesWithCounts(ctx.db, ctx.workspaceId)
  if (error) throw new Error(error.message)
  return {
    reglas: rules.map((r) => ({
      id: r.id,
      nombre: r.name,
      canal: RED[r.channel],
      activa: r.is_active,
      // Sin palabras clave la regla atiende TODOS los comentarios. Es la
      // configuración más fácil de dejar puesta sin querer, así que se dice.
      palabras_clave: r.keywords ?? [],
      atiende: (r.keywords ?? []).length === 0 ? 'cualquier comentario' : 'las palabras clave',
      coincidencia: r.match_type === 'exact' ? 'exacta' : 'contiene',
      publicacion: r.post_id,
      prioridad: r.priority,
      dm: composeDmText(r),
      recurso: r.dm_attachment_url,
      respuesta_publica: r.public_reply_enabled ? (r.public_reply_templates ?? []) : [],
      dm_enviados: r.dm_sent_count,
    })),
  }
}

async function crearRegla(ctx: CapabilityContext, args: Record<string, unknown>) {
  const canal = CANAL_DE[String(args.canal ?? '').trim().toLowerCase()]
  if (!canal) throw new Error('El canal tiene que ser instagram o facebook.')
  const nombre = String(args.nombre ?? '').trim()
  if (!nombre) throw new Error('Falta el nombre de la regla.')
  const dm = String(args.dm ?? '').trim()
  if (!dm) throw new Error('Falta el texto del mensaje privado.')

  const fields = ruleFields({
    name: nombre,
    channel: canal,
    post_id: typeof args.publicacion === 'string' ? args.publicacion : null,
    keywords: args.palabras_clave,
    match_type: args.coincidencia === 'exacta' ? 'exact' : 'contains',
    public_reply_templates: args.respuesta_publica,
    public_reply_enabled: Array.isArray(args.respuesta_publica)
      ? args.respuesta_publica.length > 0
      : false,
    dm_message: dm,
    dm_button_label: typeof args.boton_texto === 'string' ? args.boton_texto : null,
    dm_button_url: typeof args.boton_enlace === 'string' ? args.boton_enlace : null,
    dm_attachment_url: typeof args.recurso === 'string' ? args.recurso : null,
    // Nace apagada SIEMPRE, venga lo que venga en los argumentos: mientras no
    // se prenda no le escribe a nadie y se puede leer entera antes.
    is_active: false,
    priority: typeof args.prioridad === 'number' ? args.prioridad : undefined,
  })

  const { data, error } = await ctx.db
    .from('comment_to_dm_rules')
    .insert({
      workspace_id: ctx.workspaceId,
      created_by:
        ctx.actor.type === 'ui' || ctx.actor.type === 'operator' ? (ctx.actor.id ?? null) : null,
      ...fields,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'no se pudo crear la regla')

  return {
    id: (data as { id: string }).id,
    nombre,
    canal: RED[canal],
    activa: false,
    nota: 'Queda apagada. Revisa el texto y préndela cuando quieras.',
  }
}

/** Cuenta conectada de esa red, o la regla no se dispara nunca. */
async function hayConexion(ctx: CapabilityContext, canal: CommentRuleChannel) {
  const { count } = await ctx.db
    .from('channel_connections')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', ctx.workspaceId)
    .eq('channel', canal)
    .eq('status', 'connected')
  return (count ?? 0) > 0
}

async function previewActivar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const regla = await getRule(ctx.db, {
    id: String(args.regla_id),
    workspaceId: ctx.workspaceId,
  })
  if (!regla) throw new Error('Esa regla no existe en esta cuenta.')
  const red = RED[regla.channel]

  if (args.activa === false) {
    return `Apagaría «${regla.name}». Los comentarios nuevos de ${red} dejan de recibir el mensaje automático; lo ya enviado queda como está.`
  }

  const partes: string[] = []
  const disparo =
    (regla.keywords ?? []).length === 0
      ? 'CUALQUIER comentario nuevo (la regla no tiene palabras clave)'
      : `todo comentario nuevo que ${
          regla.match_type === 'exact' ? 'sea exactamente' : 'contenga'
        } ${regla.keywords.map((k) => `«${k}»`).join(' o ')}`
  const donde = regla.post_id
    ? `la publicación ${regla.post_id}`
    : `cualquier publicación de ${red}`

  partes.push(
    `Prendería «${regla.name}»: ${disparo} en ${donde} recibe un mensaje privado real.`,
  )
  partes.push(`El mensaje privado dice: "${composeDmText(regla)}"`)
  if (regla.dm_attachment_url) {
    partes.push(`Con un archivo adjunto: ${regla.dm_attachment_url}`)
  }

  const publicas = (regla.public_reply_templates ?? []).filter((t) => t.trim())
  if (regla.public_reply_enabled && publicas.length > 0) {
    partes.push(
      `Y además publica una respuesta A LA VISTA DE TODOS bajo el comentario, elegida al azar entre: ${publicas
        .map((t) => `"${t}"`)
        .join(' / ')}`,
    )
  }
  if (!(await hayConexion(ctx, regla.channel))) {
    partes.push(
      `Ojo: no hay ninguna cuenta de ${red} conectada, así que no se va a disparar hasta que la conectes.`,
    )
  }
  partes.push('Sólo alcanza a los comentarios que lleguen a partir de ahora.')
  return partes.join(' ')
}

async function activarRegla(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
): Promise<Pick<CommentRule, 'id' | 'name' | 'is_active'>> {
  const regla = await setRuleActive(ctx.db, {
    id: String(args.regla_id),
    workspaceId: ctx.workspaceId,
    active: args.activa !== false,
  })
  return { id: regla.id, name: regla.name, is_active: regla.is_active }
}

export const COMMENT_CAPABILITIES: Capability[] = [
  {
    key: 'comentarios.pendientes',
    description:
      'Los comentarios de Instagram y Facebook que nadie respondió, del más viejo al más nuevo, con el enlace para abrirlos y si son de un anuncio. Dice también si una regla ya le mandó el mensaje privado a esa persona (falta la respuesta pública, que la ve cualquiera) y con qué criterio está contestando la IA hoy, que es lo que suele explicar por qué se acumulan.',
    descriptionEn:
      'The Instagram and Facebook comments nobody answered, oldest first, with the link to open them and whether they are on an ad. It also says whether a rule already sent that person the private DM (so what is missing is the public reply everyone can see) and how the AI is currently answering comments, which usually explains why they pile up.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        canal: { ...ESQUEMA_CANAL, description: 'Una sola red. Sin esto, las dos.' },
        limite: {
          type: 'number',
          description: `Cuántos traer. Por defecto 20, máximo ${TOPE_PENDIENTES}.`,
        },
      },
    },
    run: pendientes,
  },

  {
    key: 'comentarios.reglas',
    description:
      'Las reglas de comentario a mensaje privado: con qué palabras clave se dispara cada una, en qué red y publicación, con qué prioridad (gana la de número más bajo), si está prendida, el mensaje privado que manda, la respuesta pública que publica bajo el comentario y cuántos privados lleva enviados.',
    descriptionEn:
      'The comment-to-DM rules: which keywords trigger each one, on which network and post, with what priority (lowest number wins), whether it is on, the private message it sends, the public reply it posts under the comment, and how many DMs it has sent.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: reglas,
  },

  {
    key: 'comentarios.crear_regla',
    description:
      'Crea una regla de comentario a mensaje privado, APAGADA. Cuando se prenda, a quien comente con una de las palabras clave se le manda un mensaje privado, y opcionalmente se le publica una respuesta bajo su comentario que lee cualquiera. Sin palabras clave atiende TODOS los comentarios. Se deshace borrándola o dejándola apagada.',
    descriptionEn:
      'Creates a comment-to-DM rule, switched OFF. Once turned on, whoever comments using one of the keywords gets a private message, and optionally a public reply under their comment that anyone can read. With no keywords it matches EVERY comment. Undone by deleting it or leaving it off.',
    risk: 'reversible',
    // Nace apagada. Mientras lo esté, ningún comentario dispara un mensaje.
    inerte: true,
    schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Para distinguirla en la lista.' },
        canal: ESQUEMA_CANAL,
        dm: {
          type: 'string',
          description: 'El mensaje PRIVADO. Lo lee sólo quien comentó.',
        },
        palabras_clave: {
          type: 'array',
          items: { type: 'string' },
          description: 'Vacío = atiende cualquier comentario.',
        },
        coincidencia: {
          type: 'string',
          enum: ['contiene', 'exacta'],
          description: 'Por defecto contiene.',
        },
        respuesta_publica: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Textos para responder BAJO el comentario, a la vista de todos. Se elige uno al azar en cada disparo para que no se repita siempre el mismo. Vacío = no se responde en público.',
        },
        boton_texto: { type: 'string', description: 'Etiqueta del enlace del privado.' },
        boton_enlace: { type: 'string', description: 'Se pega al final del privado.' },
        recurso: {
          type: 'string',
          description:
            'Enlace a una imagen, video o PDF que va ADJUNTO en el mismo privado (catálogo, cupón). Si la red lo rechaza, se manda como enlace.',
        },
        publicacion: {
          type: 'string',
          description: 'Id de una publicación. Sin esto, vale para todas.',
        },
        prioridad: {
          type: 'number',
          description: 'Gana el número más bajo cuando varias reglas encajan. Por defecto 100.',
        },
      },
      required: ['nombre', 'canal', 'dm'],
    },
    async preview(_ctx, args) {
      const palabras = Array.isArray(args.palabras_clave)
        ? (args.palabras_clave as unknown[]).filter((k) => typeof k === 'string')
        : []
      const disparo =
        palabras.length === 0
          ? 'cualquier comentario'
          : palabras.map((k) => `«${k}»`).join(' o ')
      const canalPedido = CANAL_DE[String(args.canal ?? '').toLowerCase()]
      return `Crearía la regla «${args.nombre}» en ${
        canalPedido ? RED[canalPedido] : 'Instagram'
      } para ${disparo}. Queda apagada: no le escribe a nadie hasta que la prendas.`
    },
    /**
     * El mensaje entero, antes de aprobarlo.
     *
     * Es la única pieza del catálogo que le escribe a una persona y encima
     * puede publicar bajo su comentario, donde lo lee cualquiera. La vista
     * previa la contaba en una línea: se aprobaba un texto que no se había
     * leído.
     */
    artifact(_ctx, args) {
      const dm = String(args.dm ?? '').trim()
      const nombre = String(args.nombre ?? '').trim()
      if (!dm || !nombre) return null
      const canal = CANAL_DE[String(args.canal ?? '').toLowerCase()]
      const palabras = Array.isArray(args.palabras_clave)
        ? (args.palabras_clave as unknown[]).filter((k): k is string => typeof k === 'string')
        : []
      const boton =
        typeof args.boton_texto === 'string' && typeof args.boton_enlace === 'string'
          ? { texto: args.boton_texto, enlace: args.boton_enlace }
          : undefined
      return {
        kind: 'regla',
        nombre,
        red: canal ? RED[canal] : 'Instagram',
        cuando:
          palabras.length === 0
            ? 'Cualquier comentario'
            : `Comentarios con ${palabras.map((k) => `«${k}»`).join(' o ')}`,
        privado: dm,
        publico: (Array.isArray(args.respuesta_publica) ? args.respuesta_publica : []).filter(
          (r): r is string => typeof r === 'string',
        ),
        ...(boton ? { boton } : {}),
      }
    },
    run: crearRegla,
  },

  {
    key: 'comentarios.activar_regla',
    description:
      'Prende o apaga una regla de comentario a mensaje privado. Prenderla hace que a gente real le empiece a llegar un mensaje privado, y si la regla tiene respuesta pública, que se publique bajo su comentario donde la lee cualquiera. Sólo alcanza a los comentarios nuevos.',
    descriptionEn:
      'Turns a comment-to-DM rule on or off. Turning it on starts sending real people a private message, and if the rule has a public reply, posting it under their comment where anyone can read it. It only affects new comments.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        regla_id: { type: 'string', description: 'De comentarios.reglas.' },
        activa: { type: 'boolean', description: 'true prende, false apaga.' },
      },
      required: ['regla_id', 'activa'],
    },
    preview: previewActivar,
    run: activarRegla,
  },
]
