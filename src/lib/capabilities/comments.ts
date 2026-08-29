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
  cleanStrings,
  composeDmText,
  getRule,
  listRulesWithCounts,
  reglaSinPrivado,
  ruleFields,
  setRuleActive,
  type CommentRule,
  type CommentRuleChannel,
} from '@/lib/comment-to-dm/rules'
import {
  COMMENT_REPLY_MODES,
  autoReplyCommentsEnabled,
  guardarAjustesDeComentarios,
  loadCommentSettings,
} from '@/lib/instagram-agent/controls'
import {
  ACCIONES_COMENTARIO,
  moderarComentario,
  type AccionComentario,
} from '@/lib/channels/comment-actions'
import { PENDING_SENDER, hoursWaiting } from './predicates'
import type { Artefacto } from '@/lib/operator/artifacts'
import {
  cambio,
  corto,
  fecha,
  lista,
  numero,
  tabla,
  tablero,
  tieneCampos,
  tt,
} from './vistas'
import type { Capability, CapabilityContext } from './types'

/** Cuántos comentarios sin responder devuelve como mucho una llamada. */
const TOPE_PENDIENTES = 50

const CANAL_DE: Record<string, CommentRuleChannel> = {
  instagram: 'ig_comment',
  facebook: 'fb_comment',
  ambas: 'both',
  tiktok: 'tiktok_comment',
}
/** Las redes de verdad: donde vive una conversación. 'both' no es una de ellas. */
type CommentChannel = 'ig_comment' | 'fb_comment' | 'tiktok_comment'

const RED: Record<CommentRuleChannel, string> = {
  ig_comment: 'Instagram',
  fb_comment: 'Facebook',
  both: 'Instagram y Facebook',
  tiktok_comment: 'TikTok',
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
  return pedido && pedido !== 'both'
    ? [pedido]
    : ['ig_comment', 'fb_comment', 'tiktok_comment']
}

const ESQUEMA_CANAL = {
  type: 'string',
  enum: ['instagram', 'facebook', 'ambas', 'tiktok'],
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
    redes: [
      cfg.instagram && 'Instagram',
      cfg.facebook && 'Facebook',
      cfg.tiktok && 'TikTok',
    ].filter(Boolean),
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
  if (!canal) {
    throw new Error('El canal tiene que ser instagram, facebook, tiktok o ambas.')
  }
  const nombre = String(args.nombre ?? '').trim()
  if (!nombre) throw new Error('Falta el nombre de la regla.')
  const publicas = cleanStrings(args.respuesta_publica)
  const dm = String(args.dm ?? '').trim()
  // En TikTok no hay privado: lo obligatorio es lo que se publica bajo el
  // video. Sin eso, la regla no haría nada y quedaría ahí ocupando lugar.
  if (reglaSinPrivado(canal)) {
    if (publicas.length === 0) {
      throw new Error('En TikTok no hay privado: falta la respuesta que se publica.')
    }
  } else if (!dm) {
    throw new Error('Falta el texto del mensaje privado.')
  }

  const fields = ruleFields({
    name: nombre,
    channel: canal,
    post_id: typeof args.publicacion === 'string' ? args.publicacion : null,
    keywords: args.palabras_clave,
    match_type: args.coincidencia === 'exacta' ? 'exact' : 'contains',
    public_reply_templates: publicas,
    public_reply_enabled: publicas.length > 0,
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

// ---------------------------------------------------------------------------
// VER TODOS, Y PODER TOCARLOS.
//
// `comentarios.pendientes` sólo trae los que nadie respondió, que es la lista
// de trabajo. Pero "¿por qué este comentario está oculto?" y "sacá ese de la
// vista" no tenían por dónde: el chat veía la cola y no podía mover nada.
// ---------------------------------------------------------------------------

/** Cuántos comentarios devuelve como mucho un listado. */
const TOPE_LISTADO = 50

async function listar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 20, TOPE_LISTADO)
  const canales: CommentChannel[] =
    typeof args.red === 'string' && CANAL_DE[args.red] && CANAL_DE[args.red] !== 'both'
      ? [CANAL_DE[args.red] as CommentChannel]
      : ['ig_comment', 'fb_comment', 'tiktok_comment']

  let q = ctx.db
    .from('messages')
    .select(
      'id, created_at, content_text, sender_type, is_hidden, hidden_by, hidden_reason, hidden_at, is_liked, message_id, status, conversation_id, comments_meta(permalink, post_id, is_ad), conversations!inner(channel, workspace_id, contacts(name))',
    )
    .eq('conversations.workspace_id', ctx.workspaceId)
    .in('conversations.channel', canales)
    .order('created_at', { ascending: false })
    .limit(limite)

  if (args.solo_ocultos === true) q = q.eq('is_hidden', true)
  if (typeof args.texto === 'string' && args.texto.trim()) {
    q = q.ilike('content_text', `%${args.texto.trim().replace(/[%,]/g, ' ')}%`)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as unknown as Array<{
    id: string
    created_at: string
    content_text: string | null
    sender_type: string
    is_hidden: boolean | null
    hidden_by: string | null
    hidden_reason: string | null
    hidden_at: string | null
    is_liked: boolean | null
    message_id: string | null
    conversation_id: string
    comments_meta: { permalink: string | null; post_id: string | null; is_ad: boolean | null } | null
    conversations: { channel: string; contacts: { name: string | null } | null } | null
  }>

  return {
    comentarios: filas.map((m) => {
      const meta = Array.isArray(m.comments_meta) ? m.comments_meta[0] : m.comments_meta
      return {
        // El id que pide `comentarios.moderar` es ESTE, el del mensaje.
        message_id: m.id,
        conversation_id: m.conversation_id,
        canal: RED[(m.conversations?.channel ?? 'ig_comment') as CommentRuleChannel],
        // 'customer' es quien comentó; lo demás es lo que respondió la cuenta.
        quien: m.sender_type,
        persona: m.conversations?.contacts?.name ?? 'sin nombre',
        comentario: m.content_text,
        cuando: m.created_at,
        oculto: m.is_hidden === true,
        // Quién lo ocultó (migración 212): la IA por spam, una persona desde la
        // bandeja, o alguien desde la app de la red. Son tres conversaciones
        // distintas con el comercio.
        lo_oculto: m.hidden_by,
        oculto_porque: m.hidden_reason,
        oculto_el: m.hidden_at,
        me_gusta: m.is_liked === true,
        es_anuncio: meta?.is_ad === true,
        publicacion: meta?.post_id ?? null,
        enlace: meta?.permalink ?? null,
      }
    }),
  }
}

const QUE_HACE: Record<AccionComentario, string> = {
  hide: 'Lo sacaría de la vista del público',
  unhide: 'Lo volvería a mostrar en público',
  delete: 'Lo BORRARÍA de la publicación, y eso no se deshace',
  like: 'Le pondría me gusta desde la cuenta',
  unlike: 'Le sacaría el me gusta',
}

async function comentarioParaModerar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = String(args.message_id ?? '').trim()
  if (!id) throw new Error('Falta el message_id del comentario.')
  const { data } = await ctx.db
    .from('messages')
    .select('id, content_text, is_hidden, conversations!inner(workspace_id, contacts(name))')
    .eq('id', id)
    .eq('conversations.workspace_id', ctx.workspaceId)
    .maybeSingle()
  if (!data) throw new Error('Ese comentario no existe en esta cuenta.')
  return data as unknown as {
    id: string
    content_text: string | null
    is_hidden: boolean | null
    conversations: { contacts: { name: string | null } | null } | null
  }
}

async function moderar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const comentario = await comentarioParaModerar(ctx, args)
  const accion = String(args.accion ?? '') as AccionComentario
  if (!ACCIONES_COMENTARIO.includes(accion)) {
    throw new Error(`Acción desconocida: ${accion}`)
  }

  const r = await moderarComentario(ctx.db, {
    workspaceId: ctx.workspaceId,
    messageId: comentario.id,
    accion,
    // Detrás de esto hay una persona que lo aprobó, no el filtro de spam.
    actorUserId: ctx.actor.type === 'operator' ? (ctx.actor.id ?? null) : null,
  })
  if (!r.ok) {
    throw new Error(
      r.motivo === 'sin_conexion'
        ? 'La cuenta de esa red no está conectada.'
        : r.motivo === 'no_es_comentario'
          ? 'Eso no es un comentario.'
          : (r.detail ?? 'La red rechazó la acción.'),
    )
  }
  return { message_id: comentario.id, accion, hecho: true }
}

// ---------------------------------------------------------------------------
// EL INTERRUPTOR.
//
// `comentarios.pendientes` ya decía CÓMO contesta la IA, y con eso se explicaba
// por qué se acumulan los pendientes. Pero no había forma de cambiarlo: la
// respuesta terminaba siempre en "andá a la pantalla de Comentarios". El
// 2026-08-28 la IA ocultó como spam la crítica de una clienta y el criterio que
// decide eso se toca justo acá.
// ---------------------------------------------------------------------------

/** Qué publica la IA cuando contesta, dicho en castellano. */
const QUE_PUBLICA: Record<string, string> = {
  dm: 'solo por privado',
  public_dm: 'en el comentario y por privado',
  public_smart: 'en el comentario siempre, y por privado sólo si hace falta',
  public: 'solo en el comentario',
}

async function ajustes(ctx: CapabilityContext) {
  const [contesta, cfg] = await Promise.all([
    autoReplyCommentsEnabled(ctx.db, ctx.workspaceId),
    loadCommentSettings(ctx.db, ctx.workspaceId),
  ])
  const { data } = await ctx.db
    .from('ig_proactive_settings')
    .select('paused, daily_cap, marketing_optin_enabled')
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle()
  const s = data as {
    paused?: boolean | null
    daily_cap?: number | null
    marketing_optin_enabled?: boolean | null
  } | null

  return {
    contesta_con_ia: contesta,
    a_quien:
      cfg.audience === 'all'
        ? 'a todo el que escriba'
        : 'solo a quien muestra intención de compra',
    audiencia: cfg.audience,
    que_publica: QUE_PUBLICA[cfg.replyMode] ?? cfg.replyMode,
    modo: cfg.replyMode,
    redes: {
      instagram: cfg.instagram,
      facebook: cfg.facebook,
      tiktok: cfg.tiktok,
    },
    // Cuántas veces insiste en el MISMO hilo antes de dejarlo para una persona.
    tope_por_hilo: cfg.maxThreadReplies,
    // El freno de emergencia: manda sobre todo lo demás.
    pausado: s?.paused === true,
    tope_diario_de_privados: s?.daily_cap ?? 500,
    pide_permiso_de_marketing: s?.marketing_optin_enabled === true,
  }
}

/** Traduce los argumentos del modelo al cuerpo que entiende `controls`. */
function parcheDesdeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (typeof args.contestar === 'boolean') body.auto_reply_comments = args.contestar
  if (args.audiencia === 'intent' || args.audiencia === 'all') {
    body.comment_audience = args.audiencia
  }
  if (COMMENT_REPLY_MODES.includes(args.modo as never)) body.comment_reply_mode = args.modo
  // Las redes viajan juntas: mandar una sola apagaría las otras dos, porque
  // `construirParche` las guarda como un conjunto. Se leen las tres del estado
  // actual y se pisa la que pidieron.
  if (
    typeof args.instagram === 'boolean' ||
    typeof args.facebook === 'boolean' ||
    typeof args.tiktok === 'boolean'
  ) {
    body.__redes = true
  }
  if (args.tope_por_hilo != null) body.comment_max_thread_replies = args.tope_por_hilo
  if (args.tope_diario != null) body.daily_cap = args.tope_diario
  if (typeof args.pausar === 'boolean') body.paused = args.pausar
  return body
}

async function configurar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const body = parcheDesdeArgs(args)
  if (body.__redes) {
    delete body.__redes
    const cfg = await loadCommentSettings(ctx.db, ctx.workspaceId)
    body.comment_instagram =
      typeof args.instagram === 'boolean' ? args.instagram : cfg.instagram
    body.comment_facebook =
      typeof args.facebook === 'boolean' ? args.facebook : cfg.facebook
    body.comment_tiktok = typeof args.tiktok === 'boolean' ? args.tiktok : cfg.tiktok
  }
  if (Object.keys(body).length === 0) {
    throw new Error('No pediste ningún cambio.')
  }
  await guardarAjustesDeComentarios(ctx.db, ctx.workspaceId, body)
  return ajustes(ctx)
}

/** Qué cambiaría, en una línea por cosa. */
async function previewConfigurar(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
): Promise<string> {
  const antes = await ajustes(ctx)
  const cambios: string[] = []
  if (typeof args.contestar === 'boolean' && args.contestar !== antes.contesta_con_ia) {
    cambios.push(
      args.contestar
        ? 'La IA vuelve a contestar los comentarios.'
        : 'La IA deja de contestar comentarios: pasan todos a la bandeja.',
    )
  }
  if (args.audiencia && args.audiencia !== antes.audiencia) {
    cambios.push(
      args.audiencia === 'all'
        ? 'Pasa a contestarle a TODO el que escriba, no sólo a quien quiere comprar.'
        : 'Pasa a contestarle sólo a quien muestra intención de compra.',
    )
  }
  if (args.modo && args.modo !== antes.modo) {
    cambios.push(`Lo que contesta pasa a salir ${QUE_PUBLICA[String(args.modo)]}.`)
  }
  for (const red of ['instagram', 'facebook', 'tiktok'] as const) {
    if (typeof args[red] === 'boolean' && args[red] !== antes.redes[red]) {
      const nombre = red === 'instagram' ? 'Instagram' : red === 'facebook' ? 'Facebook' : 'TikTok'
      cambios.push(args[red] ? `Empieza a trabajar en ${nombre}.` : `Deja de trabajar en ${nombre}.`)
    }
  }
  if (args.tope_por_hilo != null && Number(args.tope_por_hilo) !== antes.tope_por_hilo) {
    cambios.push(
      `Insiste hasta ${Number(args.tope_por_hilo)} veces en el mismo hilo (antes ${antes.tope_por_hilo}).`,
    )
  }
  if (args.tope_diario != null && Number(args.tope_diario) !== antes.tope_diario_de_privados) {
    cambios.push(
      `El tope diario de privados pasa a ${Number(args.tope_diario)} (antes ${antes.tope_diario_de_privados}).`,
    )
  }
  if (typeof args.pausar === 'boolean' && args.pausar !== antes.pausado) {
    cambios.push(
      args.pausar
        ? 'FRENO DE EMERGENCIA: se para todo lo proactivo, comentarios y privados.'
        : 'Se saca el freno de emergencia: vuelve a salir todo lo proactivo.',
    )
  }
  // Sin cambios se dice qué QUEDA, no que no pasa nada: quien aprueba tiene que
  // leer el estado, no un aviso de que su pedido era redundante.
  if (cambios.length === 0) {
    return `Quedaría como está: contesta ${antes.a_quien}, ${antes.que_publica}.`
  }
  return cambios.join(' ')
}

/**
 * DE QUÉ HABLA CADA PUBLICACIÓN.
 *
 * Un comentario sin el post es media conversación: "¿y el precio?" debajo de un
 * reel no se contesta igual que debajo de una foto de otro producto. Riverz ya
 * lee la publicación —entiende la foto, transcribe el video— y eso lo usaba
 * sólo el agente por dentro. Acá se ve: qué mostró la marca, qué dice el video,
 * y si la publicación es un anuncio pago.
 */
async function publicaciones(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 20, 50)

  const [meta, videos, anuncios] = await Promise.all([
    ctx.db
      .from('publicacion_contexto')
      .select('channel, external_id, titulo, cuerpo, medio_tipo, medio_entendido, estado, created_at')
      .eq('workspace_id', ctx.workspaceId)
      .order('created_at', { ascending: false })
      .limit(limite),
    ctx.db
      .from('tiktok_videos')
      .select('video_id, caption, share_url, posted_at, transcript, transcript_status')
      .eq('workspace_id', ctx.workspaceId)
      .order('posted_at', { ascending: false })
      .limit(limite),
    ctx.db
      .from('ad_posts')
      .select('post_id, ad_name, campaign_name, is_dark_post, last_seen_at')
      .eq('workspace_id', ctx.workspaceId)
      .order('last_seen_at', { ascending: false })
      .limit(limite),
  ])

  const esAnuncio = new Map<string, { ad_name: string | null; campaign_name: string | null; is_dark_post: boolean | null }>()
  for (const a of (anuncios.data ?? []) as Array<{
    post_id: string
    ad_name: string | null
    campaign_name: string | null
    is_dark_post: boolean | null
  }>) {
    esAnuncio.set(a.post_id, a)
  }

  return {
    publicaciones: ((meta.data ?? []) as Array<{
      channel: string
      external_id: string
      titulo: string | null
      cuerpo: string | null
      medio_tipo: string | null
      medio_entendido: string | null
      estado: string | null
      created_at: string
    }>).map((p) => {
      const ad = esAnuncio.get(p.external_id)
      return {
        publicacion: p.external_id,
        canal: p.channel,
        titulo: p.titulo,
        texto: p.cuerpo,
        tipo_de_medio: p.medio_tipo,
        // Qué entendió Riverz de la foto o del video: es lo que el agente usa
        // para contestar "¿y esto qué es?".
        que_muestra: p.medio_entendido,
        estado: p.estado,
        // Si además es un anuncio pago, con qué campaña.
        anuncio: ad
          ? { nombre: ad.ad_name, campana: ad.campaign_name, oculto: ad.is_dark_post === true }
          : null,
      }
    }),
    videos_de_tiktok: ((videos.data ?? []) as Array<{
      video_id: string
      caption: string | null
      share_url: string | null
      posted_at: string | null
      transcript: string | null
      transcript_status: string | null
    }>).map((v) => ({
      video: v.video_id,
      texto: v.caption,
      enlace: v.share_url,
      publicado: v.posted_at,
      // Lo que se dice hablando en el video, que es donde está la promesa.
      lo_que_dice: v.transcript,
      transcripcion: v.transcript_status,
    })),
  }
}


/**
 * Los comentarios, dibujados.
 *
 * Un comentario pendiente no es una fila más de una tabla: es alguien esperando
 * en público, debajo de una publicación, donde lo lee cualquiera. Lo que hace
 * falta ver es QUÉ escribió y cuánto hace, y si alguna regla ya le contestó por
 * privado — porque eso cambia por completo qué hay que hacer con él.
 */
function vistaPendientes(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    persona: string
    canal: string
    comentario: string | null
    horas_esperando: number | null
    oculto: boolean
    dm_de_regla: boolean
  }>(r, 'comentarios')
  return tabla({
    titulo: tt(ctx, 'operation.vTitPendientes'),
    columnas: [
      { clave: 'persona', titulo: tt(ctx, 'operation.vColPersona') },
      { clave: 'canal', titulo: tt(ctx, 'operation.vColCanal') },
      { clave: 'comentario', titulo: tt(ctx, 'operation.vColComentario') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
      { clave: 'espera', titulo: tt(ctx, 'operation.vColEsperando'), alineado: 'der' },
    ],
    filas: filas.map((c) => ({
      persona: corto(c.persona, 20),
      canal: c.canal,
      comentario: corto(c.comentario, 46),
      // Un comentario ya atendido por privado parece abandonado si no se dice.
      estado: c.oculto
        ? tt(ctx, 'operation.vOculto')
        : c.dm_de_regla
          ? tt(ctx, 'operation.vYaLeEscribio')
          : '—',
      espera: c.horas_esperando != null ? `${numero(ctx, Math.round(c.horas_esperando))} h` : '—',
    })),
    vacio: tt(ctx, 'operation.vSinPendientes'),
  })
}

function vistaComentarios(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    persona: string
    quien: string
    canal: string
    comentario: string | null
    cuando: string
    oculto: boolean
    lo_oculto: string | null
  }>(r, 'comentarios')
  return tabla({
    titulo: tt(ctx, 'operation.subComentarios'),
    columnas: [
      { clave: 'persona', titulo: tt(ctx, 'operation.vColPersona') },
      { clave: 'comentario', titulo: tt(ctx, 'operation.vColComentario') },
      { clave: 'cuando', titulo: tt(ctx, 'operation.vColCuando') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
    ],
    filas: filas.map((c) => ({
      persona: corto(c.quien === 'customer' ? c.persona : tt(ctx, 'operation.vLaCuenta'), 20),
      comentario: corto(c.comentario, 50),
      cuando: fecha(ctx, c.cuando),
      estado: c.oculto ? `${tt(ctx, 'operation.vOculto')}${c.lo_oculto ? ` · ${c.lo_oculto}` : ''}` : '—',
    })),
    vacio: tt(ctx, 'operation.vSinComentarios'),
  })
}

/**
 * Cómo está configurada la respuesta automática.
 *
 * Es un tablero y no una ficha porque lo que se pregunta acá es binario y por
 * red: ¿está contestando? ¿en cuál? ¿está pausado? Un punto de color contesta
 * eso de un vistazo; una lista de «instagram: true» no.
 */
function vistaAjustesComentarios(
  ctx: CapabilityContext,
  r: Awaited<ReturnType<typeof ajustes>>,
): Artefacto | null {
  if (!tieneCampos(r, 'redes')) return null
  const t = (k: string) => tt(ctx, `operation.${k}`)
  const sino = (v: boolean): 'ok' | 'apagado' => (v ? 'ok' : 'apagado')
  return tablero({
    titulo: t('vTitAjustesComentarios'),
    filas: [
      // El freno de emergencia primero: manda sobre todo lo demás, y leerlo al
      // final después de cinco renglones en verde es leerlo tarde.
      ...(r.pausado ? [{ que: t('vPausado'), estado: 'roto' as const }] : []),
      { que: t('vContestaConIa'), estado: sino(r.contesta_con_ia), detalle: String(r.a_quien) },
      { que: 'Instagram', estado: sino(r.redes.instagram) },
      { que: 'Facebook', estado: sino(r.redes.facebook) },
      { que: 'TikTok', estado: sino(r.redes.tiktok) },
      { que: t('vQuePublica'), estado: 'ok', detalle: String(r.que_publica) },
      {
        que: t('vTopePorHilo'),
        estado: 'ok',
        detalle: numero(ctx, r.tope_por_hilo),
      },
    ],
  })
}

function vistaReglasComentarios(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    nombre: string
    canal: string
    activa: boolean
    atiende: string
    dm: string | null
    dm_enviados: number | null
  }>(r, 'reglas')
  return tabla({
    titulo: tt(ctx, 'operation.vTitReglasComentarios'),
    columnas: [
      { clave: 'nombre', titulo: tt(ctx, 'operation.vColRegla') },
      { clave: 'canal', titulo: tt(ctx, 'operation.vColCanal') },
      { clave: 'atiende', titulo: tt(ctx, 'operation.vColAtiende') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
      { clave: 'enviados', titulo: tt(ctx, 'operation.vColEnviados'), alineado: 'der' },
    ],
    filas: filas.map((g) => ({
      nombre: corto(g.nombre, 28),
      canal: g.canal,
      atiende: g.atiende,
      estado: g.activa ? tt(ctx, 'operation.vEncendida') : tt(ctx, 'operation.vApagada'),
      enviados: numero(ctx, g.dm_enviados ?? 0),
    })),
    vacio: tt(ctx, 'operation.vSinReglas'),
  })
}

/**
 * Las publicaciones donde la gente comenta.
 *
 * La columna que no está en ningún otro lado es «qué muestra»: lo que Riverz
 * entendió de la foto o del video. Sin eso, «¿y el precio?» debajo de un reel
 * es media conversación.
 */
function vistaPublicaciones(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    canal: string
    titulo: string | null
    texto: string | null
    que_muestra: string | null
    anuncio: { campana: string | null } | null
  }>(r, 'publicaciones')
  return tabla({
    titulo: tt(ctx, 'operation.vTitPublicaciones'),
    columnas: [
      { clave: 'canal', titulo: tt(ctx, 'operation.vColCanal') },
      { clave: 'texto', titulo: tt(ctx, 'operation.vColPublicacion') },
      { clave: 'muestra', titulo: tt(ctx, 'operation.vColQueMuestra') },
      { clave: 'anuncio', titulo: tt(ctx, 'operation.vColAnuncio') },
    ],
    filas: filas.map((p) => ({
      canal: p.canal,
      texto: corto(p.titulo ?? p.texto, 44),
      muestra: corto(p.que_muestra, 44),
      anuncio: corto(p.anuncio?.campana, 24),
    })),
    vacio: tt(ctx, 'operation.vSinPublicaciones'),
  })
}

/**
 * Lo que se le va a hacer a un comentario.
 *
 * Moderar toca algo que está en público bajo el nombre del comercio, y borrar
 * no se deshace. El aviso lo dice con todas las letras: es lo que separa
 * «ocultarlo» de «borrarlo» para quien aprueba de un vistazo.
 */
function vistaModerar(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const accion = String(args.accion ?? '')
  return cambio({
    titulo: tt(ctx, 'operation.vTitModerar'),
    que: QUE_HACE[accion as AccionComentario] ?? accion,
    aviso: accion === 'delete' ? tt(ctx, 'operation.vBorrarNoVuelve') : undefined,
  })
}

/** Lo que se cambia de la respuesta automática, campo por campo. */
function vistaConfigurar(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const t = (k: string) => tt(ctx, `operation.${k}`)
  const campos: { etiqueta: string; despues: string }[] = []
  const si = t('vSi')
  const no = t('vNo')
  if (typeof args.contestar === 'boolean') {
    campos.push({ etiqueta: t('vContestaConIa'), despues: args.contestar ? si : no })
  }
  for (const [clave, etiqueta] of [
    ['instagram', 'Instagram'],
    ['facebook', 'Facebook'],
    ['tiktok', 'TikTok'],
  ] as const) {
    if (typeof args[clave] === 'boolean') {
      campos.push({ etiqueta, despues: args[clave] ? si : no })
    }
  }
  if (typeof args.modo === 'string') campos.push({ etiqueta: t('vQuePublica'), despues: args.modo })
  if (typeof args.audiencia === 'string') {
    campos.push({ etiqueta: t('vColAtiende'), despues: args.audiencia })
  }
  if (args.tope_por_hilo != null) {
    campos.push({ etiqueta: t('vTopePorHilo'), despues: String(args.tope_por_hilo) })
  }
  if (typeof args.pausar === 'boolean') {
    campos.push({ etiqueta: t('vPausado'), despues: args.pausar ? si : no })
  }
  return cambio({ titulo: t('vTitAjustesComentarios'), que: t('vQueConfigurar'), campos })
}
export const COMMENT_CAPABILITIES: Capability[] = [
  {
    key: 'comentarios.publicaciones',
    description:
      'De qué habla cada publicación donde la gente comenta: el texto, qué muestra la foto o el video según lo entendió Riverz, si además es un anuncio pago y con qué campaña, y la transcripción de los videos de TikTok. Un comentario sin la publicación es media conversación: "¿y el precio?" debajo de un reel no se contesta igual que debajo de otra cosa.',
    descriptionEn:
      'What each post people comment on is about: the text, what the photo or video shows as Riverz understood it, whether it is also a paid ad and from which campaign, and the transcript of TikTok videos. A comment without its post is half a conversation: "how much?" under a reel is not answered the same as under something else.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: { limite: { type: 'number', description: 'Por defecto 20, máximo 50.' } },
    },
    run: publicaciones,
    vista: (ctx, _args, r) => vistaPublicaciones(ctx, r),
  },
  {
    key: 'comentarios.ajustes',
    description:
      'Cómo contesta hoy la IA en los comentarios: si está encendida, a quién le contesta (sólo a quien quiere comprar, o a todos), qué publica (sólo privado, sólo el comentario, o los dos), en qué redes trabaja, cuántas veces insiste en el mismo hilo, el tope diario de privados y si el freno de emergencia está puesto. Es lo que explica por qué la IA contestó —o no contestó— un comentario.',
    descriptionEn:
      'How the AI currently answers comments: whether it is on, who it answers (only buyers, or everyone), what it posts (DM only, the comment only, or both), which networks it works on, how many times it insists on the same thread, the daily DM cap, and whether the emergency brake is on. This is what explains why the AI answered — or did not answer — a comment.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: ajustes,
    vista: (ctx, _args, r) =>
      vistaAjustesComentarios(ctx, r as Awaited<ReturnType<typeof ajustes>>),
  },

  {
    key: 'comentarios.configurar',
    description:
      'Cambia cómo contesta la IA en los comentarios: prenderla o apagarla, a quién le contesta, qué publica, en qué redes trabaja, cuánto insiste en un hilo, el tope diario de privados y el freno de emergencia. Alcanza a los comentarios NUEVOS, no reescribe lo ya contestado. Se deshace llamando de nuevo.',
    descriptionEn:
      'Changes how the AI answers comments: turn it on or off, who it answers, what it posts, which networks it works on, how much it insists on a thread, the daily DM cap and the emergency brake. It affects NEW comments; it does not rewrite what was already answered. Undone by calling it again.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        contestar: { type: 'boolean', description: 'Prende o apaga la respuesta con IA.' },
        audiencia: {
          type: 'string',
          enum: ['intent', 'all'],
          description: 'intent = sólo a quien quiere comprar; all = a todo el que escriba.',
        },
        modo: {
          type: 'string',
          enum: [...COMMENT_REPLY_MODES],
          description:
            'dm = sólo privado; public_dm = comentario y privado; public_smart = comentario siempre y privado si hace falta; public = sólo el comentario.',
        },
        instagram: { type: 'boolean' },
        facebook: { type: 'boolean' },
        tiktok: { type: 'boolean' },
        tope_por_hilo: {
          type: 'number',
          description: 'Cuántas veces insiste en el mismo hilo. 0 = sin tope. Máximo 10.',
        },
        tope_diario: {
          type: 'number',
          description: 'Tope de mensajes privados proactivos en 24 h. 0 = sin tope.',
        },
        pausar: {
          type: 'boolean',
          description: 'Freno de emergencia: para TODO lo proactivo, no sólo comentarios.',
        },
      },
    },
    preview: previewConfigurar,
    run: configurar,
    artifact: (ctx, args) => vistaConfigurar(ctx, args),
  },
  {
    key: 'comentarios.listar',
    description:
      'Los comentarios de Instagram, Facebook y TikTok, del más nuevo al más viejo, respondidos o no. De cada uno dice de qué publicación es, si es de un anuncio, si está oculto y QUIÉN lo ocultó: la IA por spam, alguien del equipo desde la bandeja, o alguien desde la app de la red. Con solo_ocultos=true trae únicamente los que no ve el público. De acá sale el message_id que pide comentarios.moderar.',
    descriptionEn:
      'The Instagram, Facebook and TikTok comments, newest first, answered or not. Each says which post it belongs to, whether it is on an ad, whether it is hidden and WHO hid it: the AI as spam, someone on the team from the inbox, or someone from the network app. With solo_ocultos=true it returns only the ones the public cannot see. The message_id that comentarios.moderar needs comes from here.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        red: { type: 'string', enum: ['instagram', 'facebook', 'tiktok'] },
        solo_ocultos: { type: 'boolean', description: 'Sólo los ocultos del público.' },
        texto: { type: 'string', description: 'Busca dentro del comentario.' },
        limite: { type: 'number', description: `Por defecto 20, máximo ${TOPE_LISTADO}.` },
      },
    },
    run: listar,
    vista: (ctx, _args, r) => vistaComentarios(ctx, r),
  },

  {
    key: 'comentarios.moderar',
    description:
      'Oculta, vuelve a mostrar, borra o le pone me gusta a un comentario, sobre la red donde está. Ocultar y mostrar se deshacen; borrar NO: el comentario desaparece de la publicación y no vuelve. El message_id sale de comentarios.listar o comentarios.pendientes.',
    descriptionEn:
      'Hides, unhides, deletes or likes a comment on the network where it lives. Hiding and unhiding can be undone; deleting CANNOT: the comment disappears from the post and does not come back. The message_id comes from comentarios.listar or comentarios.pendientes.',
    // Borrar no vuelve; el resto sí. Se declara por lo peor que puede pasar y
    // el preview dice cuál de las dos es.
    risk: 'irreversible',
    // NUNCA inerte, ni siquiera ocultar. Un comentario oculto lo sigue viendo
    // quien lo escribió, y ahí se lee como censura: el 2026-08-28 el filtro de
    // spam ocultó solo la crítica de una clienta y ese fue exactamente el
    // problema. Sacar algo de la vista del público es una decisión de una
    // persona, no un paso de construcción.
    schema: {
      type: 'object',
      properties: {
        message_id: {
          type: 'string',
          description: 'El message_id que devuelve comentarios.listar.',
        },
        accion: { type: 'string', enum: [...ACCIONES_COMENTARIO] },
      },
      required: ['message_id', 'accion'],
    },
    async preview(ctx, args) {
      const c = await comentarioParaModerar(ctx, args)
      const accion = String(args.accion ?? '') as AccionComentario
      const quien = c.conversations?.contacts?.name ?? 'alguien'
      const texto = (c.content_text ?? '').slice(0, 120)
      return `${QUE_HACE[accion] ?? 'Actuaría sobre'} el comentario de ${quien}: "${texto}"`
    },
    async deshacer(ctx, args) {
      const accion = String(args.accion ?? '') as AccionComentario
      const vuelta: Partial<Record<AccionComentario, AccionComentario>> = {
        hide: 'unhide',
        unhide: 'hide',
        like: 'unlike',
        unlike: 'like',
      }
      const contraria = vuelta[accion]
      // Borrar no está en el mapa: no hay vuelta y prometerla sería mentir.
      if (!contraria) throw new Error('Un comentario borrado no vuelve.')
      await moderarComentario(ctx.db, {
        workspaceId: ctx.workspaceId,
        messageId: String(args.message_id),
        accion: contraria,
        actorUserId: ctx.actor.type === 'operator' ? (ctx.actor.id ?? null) : null,
      })
      return contraria === 'unhide'
        ? 'El comentario volvió a estar visible.'
        : contraria === 'hide'
          ? 'El comentario volvió a estar oculto.'
          : 'Se deshizo el me gusta.'
    },
    run: moderar,
    artifact: (ctx, args) => vistaModerar(ctx, args),
  },
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
    vista: (ctx, _args, r) => vistaPendientes(ctx, r),
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
    vista: (ctx, _args, r) => vistaReglasComentarios(ctx, r),
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
      required: ['nombre', 'canal'],
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
    artifact: (ctx, args) =>
      cambio({
        titulo: tt(ctx, 'operation.vTitReglasComentarios'),
        que: tt(
          ctx,
          args.activa === true
            ? 'operation.vQuePrenderReglaComentario'
            : 'operation.vQueApagarReglaComentario',
        ),
      }),
  },
]
