/**
 * La bandeja: encontrar una conversación y decidir qué se hace con ella.
 *
 * Acá NO se le escribe a nadie, y no es un olvido. Mandar un mensaje ya existe
 * (`mensajes.enviar`) y está deliberadamente fuera del alcance del chat: esa
 * conversación la abre una persona. Lo que faltaba era lo otro, que es la mitad
 * del trabajo de una bandeja y no tenía dónde pedirse — repartir los hilos,
 * darlos por resueltos y sacar a la IA del medio cuando alguien toma el caso.
 * Esas tres escrituras vivían sueltas dentro del componente del navegador, así
 * que nada fuera de esa pantalla podía hacerlas.
 *
 * Todo lo que escribe pasa por `lib/inbox/conversaciones`, el mismo cuerpo que
 * usa el PATCH de `/api/conversations/[id]`. No es prolijidad: el estado de una
 * conversación son tres columnas que se mueven juntas (`status`, `closed_at` y
 * la marca de escalamiento) y una segunda implementación es una segunda forma
 * de dejar el panel contando mal.
 */
import { CHANNELS } from '@/types'
import {
  asignarConversacion,
  cambiarEstadoConversacion,
  cargarConversacion,
  miembrosDelEquipo,
  resolverMiembro,
  setIaConversacion,
  type MiembroDelEquipo,
} from '@/lib/inbox/conversaciones'
import { hoursWaiting, looksLikePhone, phoneTail } from './predicates'
import type { Capability, CapabilityContext } from './types'

/** Cuántas conversaciones como mucho devuelve una búsqueda. */
const TOPE_BUSQUEDA = 50

const ESTADOS = ['open', 'pending', 'closed'] as const

// ---------------------------------------------------------------------------

/** La conversación o un error legible: lo que sigue no tiene sentido sin ella. */
async function exigirConversacion(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = String(args.conversacion_id ?? '').trim()
  if (!id) throw new Error('Falta el id de la conversación.')
  const conv = await cargarConversacion(ctx.db, ctx.workspaceId, id)
  if (!conv) throw new Error('Esa conversación no existe en esta cuenta.')
  return conv
}

function comoSeLlama(conv: { contacto: string | null; channel: string }): string {
  return `${conv.contacto ?? 'sin nombre'} (${conv.channel})`
}

// ---------------------------------------------------------------------------

/**
 * Los contactos que matchean un texto, para filtrar conversaciones por ellos.
 *
 * En dos pasos y no con un `or` sobre la tabla embebida: filtrar dentro de un
 * embed exige `!inner` más `referencedTable`, y si eso queda mal escrito
 * PostgREST no falla — ignora el filtro y devuelve la bandeja entera. Una
 * búsqueda que en vez de nada devuelve todo es peor que un error.
 */
async function contactosQueMatchean(
  ctx: CapabilityContext,
  texto: string,
): Promise<string[]> {
  // Las comillas y las comas se cambian por espacios: un nombre con coma
  // partiría el `or` de PostgREST en filtros inexistentes y la consulta falla.
  const t = texto.replace(/[",]/g, ' ')
  const filtro = looksLikePhone(t)
    ? `phone.like.%${phoneTail(t)},name.ilike."%${t}%"`
    : `name.ilike."%${t}%",email.ilike."%${t}%"`

  const { data } = await ctx.db
    .from('contacts')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .or(filtro)
    .limit(200)

  return ((data ?? []) as { id: string }[]).map((c) => c.id)
}

async function buscar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 20, TOPE_BUSQUEDA)
  const texto = typeof args.texto === 'string' ? args.texto.trim() : ''

  let contactIds: string[] | null = null
  if (texto) {
    contactIds = await contactosQueMatchean(ctx, texto)
    if (contactIds.length === 0) return { conversaciones: [] }
  }

  let q = ctx.db
    .from('conversations')
    .select(
      'id, channel, status, last_message_at, last_message_text, unread_count, ai_enabled, assigned_agent_id, needs_human_reason, contacts(name, phone)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .order('last_message_at', { ascending: false })
    .limit(limite)

  if (typeof args.estado === 'string') q = q.eq('status', args.estado)
  if (typeof args.canal === 'string') q = q.eq('channel', args.canal)
  if (contactIds) q = q.in('contact_id', contactIds)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as unknown as Array<{
    id: string
    channel: string
    status: string
    last_message_at: string | null
    last_message_text: string | null
    unread_count: number | null
    ai_enabled: boolean | null
    assigned_agent_id: string | null
    needs_human_reason: string | null
    contacts: { name: string | null; phone: string | null } | null
  }>

  // El nombre del compañero y no su uuid: quien lee esto después pregunta "¿y
  // quién es 8f3a…?" y hace falta otra vuelta para averiguarlo. Sólo se consulta
  // si alguna está asignada.
  const nombrePorUsuario = new Map<string, string>()
  if (filas.some((c) => c.assigned_agent_id)) {
    for (const m of await miembrosDelEquipo(ctx.db, ctx.workspaceId)) {
      nombrePorUsuario.set(m.user_id, m.nombre)
    }
  }

  return {
    conversaciones: filas.map((c) => ({
      conversation_id: c.id,
      canal: c.channel,
      estado: c.status,
      contacto: c.contacts?.name ?? c.contacts?.phone ?? 'sin nombre',
      ultimo_mensaje: c.last_message_text,
      horas_esperando: hoursWaiting(c.last_message_at),
      sin_leer: c.unread_count ?? 0,
      ia: c.ai_enabled !== false,
      asignada_a: c.assigned_agent_id
        ? (nombrePorUsuario.get(c.assigned_agent_id) ?? c.assigned_agent_id)
        : null,
      pidio_humano: c.needs_human_reason,
    })),
  }
}

// ---------------------------------------------------------------------------

/** El miembro pedido, o `null` si lo que se pide es desasignar. */
async function destinatario(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
): Promise<MiembroDelEquipo | null> {
  const buscado = typeof args.miembro === 'string' ? args.miembro.trim() : ''
  if (!buscado) return null
  return resolverMiembro(await miembrosDelEquipo(ctx.db, ctx.workspaceId), buscado)
}

async function asignar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const conv = await exigirConversacion(ctx, args)
  const miembro = await destinatario(ctx, args)

  const { error } = await asignarConversacion(ctx.db, {
    workspaceId: ctx.workspaceId,
    conversationId: conv.id,
    userId: miembro?.user_id ?? null,
  })
  if (error) throw new Error(error.message)

  return {
    conversation_id: conv.id,
    contacto: conv.contacto,
    asignada_a: miembro?.nombre ?? null,
  }
}

async function cerrar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const conv = await exigirConversacion(ctx, args)
  const reabrir = args.reabrir === true

  const { error } = await cambiarEstadoConversacion(ctx.db, {
    workspaceId: ctx.workspaceId,
    conversationId: conv.id,
    estado: reabrir ? 'open' : 'closed',
  })
  if (error) throw new Error(error.message)

  return {
    conversation_id: conv.id,
    contacto: conv.contacto,
    estado: reabrir ? 'open' : 'closed',
  }
}

async function ia(ctx: CapabilityContext, args: Record<string, unknown>) {
  const conv = await exigirConversacion(ctx, args)
  const activa = args.activa === true

  const { error } = await setIaConversacion(ctx.db, {
    workspaceId: ctx.workspaceId,
    conversationId: conv.id,
    activa,
  })
  if (error) throw new Error(error.message)

  return { conversation_id: conv.id, contacto: conv.contacto, ia: activa }
}


// ---------------------------------------------------------------------------
// LEER: la conversación entera y lo que se dijeron.
//
// Faltaba lo más básico. El chat podía repartir hilos y cerrarlos, pero no
// podía LEER ninguno: `conversaciones.buscar` devolvía el último renglón del
// preview y nada más. "¿Qué le dijo el cliente?", "¿qué contestó la IA?" y
// "¿por qué escaló?" no tenían respuesta posible.
// ---------------------------------------------------------------------------

/** Cuántos mensajes como mucho devuelve un hilo. */
const TOPE_MENSAJES = 100

/** Por qué la IA no contestó, dicho en castellano. */
const MOTIVOS: Record<string, string> = {
  ai_disabled_for_conversation: 'la IA está apagada en ese hilo',
  conversation_closed: 'la conversación estaba cerrada',
  no_agent: 'no hay agente para ese canal',
  paused: 'el agente está pausado',
  outside_hours: 'fuera del horario del agente',
  opted_out: 'la persona pidió la baja',
  assigned_to_human: 'la tiene asignada una persona',
}

function porQueNoContesto(skip: string | null): string | null {
  if (!skip) return null
  return MOTIVOS[skip] ?? skip
}

async function detalle(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = String(args.conversacion_id ?? '').trim()
  if (!id) throw new Error('Falta el id de la conversación.')

  const { data } = await ctx.db
    .from('conversations')
    .select(
      'id, channel, status, created_at, closed_at, last_message_at, last_message_text, last_message_status, last_sender_type, unread_count, ai_enabled, assigned_agent_id, needs_human_reason, needs_human_at, needs_human_summary, ai_summary, ai_summary_updated_at, csat, csat_comment, csat_at, is_ad, ad_referral, engagement_kind, marketing, page_url, page_title, pending_checkout_at, pending_checkout_url, followup_count, followup_last_at, thread_external_id, contacts(id, name, phone, email, opted_out)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!data) throw new Error('Esa conversación no existe en esta cuenta.')

  const c = data as unknown as {
    id: string
    channel: string
    status: string
    created_at: string
    closed_at: string | null
    last_message_at: string | null
    last_message_text: string | null
    last_message_status: string | null
    last_sender_type: string | null
    unread_count: number | null
    ai_enabled: boolean | null
    assigned_agent_id: string | null
    needs_human_reason: string | null
    needs_human_at: string | null
    needs_human_summary: string | null
    ai_summary: string | null
    ai_summary_updated_at: string | null
    csat: number | null
    csat_comment: string | null
    csat_at: string | null
    is_ad: boolean | null
    ad_referral: Record<string, unknown> | null
    engagement_kind: string | null
    marketing: boolean | null
    page_url: string | null
    page_title: string | null
    pending_checkout_at: string | null
    pending_checkout_url: string | null
    followup_count: number | null
    followup_last_at: string | null
    thread_external_id: string | null
    contacts: {
      id: string
      name: string | null
      phone: string | null
      email: string | null
      opted_out: boolean | null
    } | null
  }

  let asignada: string | null = null
  if (c.assigned_agent_id) {
    const equipo = await miembrosDelEquipo(ctx.db, ctx.workspaceId)
    asignada =
      equipo.find((m) => m.user_id === c.assigned_agent_id)?.nombre ?? c.assigned_agent_id
  }

  // Lo último que hizo la IA acá, si dejó un borrador esperando, y lo que no
  // supo contestar. Las tres cosas explican por qué el hilo está como está.
  const [ultimaIa, borrador, huecos] = await Promise.all([
    ctx.db
      .from('ai_replies')
      .select('created_at, status, skip_reason, error, model, tools_used')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(1),
    ctx.db
      .from('ai_pending_replies')
      .select('id, content_text, agent_name, created_at')
      .eq('conversation_id', c.id)
      .maybeSingle(),
    ctx.db
      .from('answer_gaps')
      .select('question, missing, created_at, resolved_at')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])
  const ia = ((ultimaIa.data ?? []) as Array<{
    created_at: string
    status: string | null
    skip_reason: string | null
    error: string | null
    model: string | null
    tools_used: unknown
  }>)[0]
  const draft = borrador.data as {
    id: string
    content_text: string
    agent_name: string | null
    created_at: string
  } | null

  return {
    conversation_id: c.id,
    canal: c.channel,
    estado: c.status,
    contacto: {
      contact_id: c.contacts?.id ?? null,
      nombre: c.contacts?.name ?? null,
      telefono: c.contacts?.phone ?? null,
      correo: c.contacts?.email ?? null,
      dado_de_baja: c.contacts?.opted_out === true,
    },
    abierta_desde: c.created_at,
    cerrada_el: c.closed_at,
    ultimo_mensaje: c.last_message_text,
    ultimo_lo_escribio: c.last_sender_type,
    ultimo_estado: c.last_message_status,
    horas_esperando: hoursWaiting(c.last_message_at),
    sin_leer: c.unread_count ?? 0,
    ia: c.ai_enabled !== false,
    asignada_a: asignada,
    pidio_humano: c.needs_human_reason,
    pidio_humano_el: c.needs_human_at,
    pidio_humano_resumen: c.needs_human_summary,
    // El resumen que la IA mantiene del hilo: la respuesta corta a "¿de qué va
    // esto?" sin leer cincuenta mensajes.
    resumen: c.ai_summary,
    resumen_al: c.ai_summary_updated_at,
    // La nota que dejó la persona: la única opinión que da sobre la atención.
    satisfaccion: c.csat,
    satisfaccion_comentario: c.csat_comment,
    satisfaccion_el: c.csat_at,
    vino_de_anuncio: c.is_ad === true,
    anuncio: c.ad_referral,
    tipo_de_interaccion: c.engagement_kind,
    es_marketing: c.marketing === true,
    // Chat web: en qué página estaba parada cuando escribió.
    pagina: c.page_url ? { url: c.page_url, titulo: c.page_title } : null,
    // Dejó un pago a medias: es la conversación que más urge.
    checkout_pendiente: c.pending_checkout_url
      ? { url: c.pending_checkout_url, desde: c.pending_checkout_at }
      : null,
    seguimientos: c.followup_count ?? 0,
    ultimo_seguimiento: c.followup_last_at,
    hilo_externo: c.thread_external_id,
    ultima_pasada_de_la_ia: ia
      ? {
          cuando: ia.created_at,
          estado: ia.status,
          no_contesto_porque: porQueNoContesto(ia.skip_reason),
          error: ia.error,
          modelo: ia.model,
          herramientas: ia.tools_used,
        }
      : null,
    borrador_esperando: draft
      ? {
          borrador_id: draft.id,
          texto: draft.content_text,
          agente: draft.agent_name,
          desde: draft.created_at,
        }
      : null,
    // Cada hueco es un agujero del conocimiento del producto, y se tapa
    // cargándolo una vez.
    no_supo_contestar: (huecos.data ?? []) as unknown[],
  }
}

async function mensajes(ctx: CapabilityContext, args: Record<string, unknown>) {
  const conv = await exigirConversacion(ctx, args)
  const limite = Math.min(Number(args.limite) || 30, TOPE_MENSAJES)

  const { data } = await ctx.db
    .from('messages')
    .select(
      'id, created_at, sender_type, content_type, content_text, media_url, media_type, media_transcription, subject, status, error_code, error_reason, template_name, origin, origin_name, is_hidden, hidden_by, hidden_reason, is_liked, edited_at, message_id',
    )
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: false })
    .limit(limite)

  const filas = ((data ?? []) as unknown as Array<{
    id: string
    created_at: string
    sender_type: string
    content_type: string | null
    content_text: string | null
    media_url: string | null
    media_type: string | null
    media_transcription: string | null
    subject: string | null
    status: string | null
    error_code: string | number | null
    error_reason: string | null
    template_name: string | null
    origin: string | null
    origin_name: string | null
    is_hidden: boolean | null
    hidden_by: string | null
    hidden_reason: string | null
    is_liked: boolean | null
    edited_at: string | null
    message_id: string | null
  }>).reverse()

  // Las reacciones viven aparte, y sin ellas un pulgar arriba no existe.
  const ids = filas.map((m) => m.id)
  const reaccionesPorMensaje = new Map<string, string[]>()
  if (ids.length > 0) {
    const { data: rx } = await ctx.db
      .from('message_reactions')
      .select('message_id, emoji')
      .in('message_id', ids)
    for (const r of (rx ?? []) as { message_id: string; emoji: string }[]) {
      const lista = reaccionesPorMensaje.get(r.message_id) ?? []
      lista.push(r.emoji)
      reaccionesPorMensaje.set(r.message_id, lista)
    }
  }

  return {
    conversation_id: conv.id,
    contacto: conv.contacto,
    canal: conv.channel,
    mensajes: filas.map((m) => ({
      message_id: m.id,
      cuando: m.created_at,
      // 'customer' es el cliente, 'agent' una persona del equipo, 'bot' la IA.
      quien: m.sender_type,
      texto: m.content_text,
      asunto: m.subject,
      // Un audio se contesta leyendo lo que dijo, no escuchándolo.
      transcripcion: m.media_transcription,
      adjunto: m.media_url ? { url: m.media_url, tipo: m.media_type } : null,
      tipo: m.content_type,
      estado: m.status,
      error: m.error_reason ?? (m.error_code ? String(m.error_code) : null),
      plantilla: m.template_name,
      // Qué lo mandó: la IA, una automatización, una difusión o una persona.
      lo_mando: m.origin_name ?? m.origin,
      oculto: m.is_hidden === true,
      lo_oculto: m.hidden_by,
      oculto_porque: m.hidden_reason,
      me_gusta: m.is_liked === true,
      editado_el: m.edited_at,
      reacciones: reaccionesPorMensaje.get(m.id) ?? [],
      id_externo: m.message_id,
    })),
  }
}

async function borradores(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 20, 50)
  const { data } = await ctx.db
    .from('ai_pending_replies')
    .select(
      'id, conversation_id, content_text, agent_name, created_at, conversations(channel, contacts(name, phone))',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: true })
    .limit(limite)

  const filas = (data ?? []) as unknown as Array<{
    id: string
    conversation_id: string
    content_text: string
    agent_name: string | null
    created_at: string
    conversations: {
      channel: string
      contacts: { name: string | null; phone: string | null } | null
    } | null
  }>

  return {
    borradores: filas.map((b) => ({
      borrador_id: b.id,
      conversation_id: b.conversation_id,
      canal: b.conversations?.channel ?? null,
      contacto:
        b.conversations?.contacts?.name ?? b.conversations?.contacts?.phone ?? 'sin nombre',
      texto: b.content_text,
      agente: b.agent_name,
      horas_esperando: hoursWaiting(b.created_at),
    })),
  }
}

// ---------------------------------------------------------------------------

const ID_CONVERSACION = {
  type: 'string',
  description: 'El conversation_id que devuelve conversaciones.buscar.',
} as const

export const INBOX_CAPABILITIES: Capability[] = [
  {
    key: 'conversaciones.buscar',
    description:
      'Las conversaciones de la bandeja, filtrables por estado (open, pending, closed), por canal o por el nombre, teléfono o correo del contacto. De cada una dice quién la tiene asignada, si la IA está contestando y cuántas horas lleva esperando. Es el paso previo a asignar, cerrar o apagar la IA: de acá sale el conversation_id.',
    descriptionEn:
      'The inbox conversations, filterable by status (open, pending, closed), by channel, or by the contact name, phone or email. Each one reports who it is assigned to, whether the AI is replying and how many hours it has been waiting. This is the step before assigning, closing or muting the AI: the conversation_id comes from here.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: [...ESTADOS] },
        canal: { type: 'string', enum: [...CHANNELS] },
        texto: { type: 'string', description: 'Nombre, teléfono o correo del contacto.' },
        limite: { type: 'number', description: `Por defecto 20, máximo ${TOPE_BUSQUEDA}.` },
      },
    },
    run: buscar,
  },

  {
    key: 'conversaciones.detalle',
    description:
      'Todo lo que se sabe de UNA conversación sin leer los mensajes: el resumen que mantiene la IA, por qué pidió una persona, la nota de satisfacción que dejó el cliente, si vino de un anuncio, en qué página del sitio estaba, si dejó un pago a medias, la última pasada de la IA con el motivo por el que no contestó, si hay una respuesta esperando aprobación y qué no supo contestar. Es el paso previo a leer el hilo.',
    descriptionEn:
      'Everything known about ONE conversation without reading the messages: the summary the AI keeps, why it asked for a human, the satisfaction score the customer left, whether it came from an ad, which page of the site they were on, whether they left a payment half done, the last AI pass with the reason it did not reply, whether a reply is waiting for approval, and what it could not answer. The step before reading the thread.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: { conversacion_id: ID_CONVERSACION },
      required: ['conversacion_id'],
    },
    run: detalle,
  },

  {
    key: 'conversaciones.mensajes',
    description:
      'Lee los mensajes de una conversación, del más viejo al más nuevo. De cada uno dice quién lo escribió (el cliente, una persona del equipo o la IA), qué mandó qué —agente, automatización, difusión—, si salió o falló y por qué, la transcripción de los audios, las reacciones, si está oculto y quién lo ocultó. Es lo que hay que leer antes de opinar sobre un caso.',
    descriptionEn:
      'Reads the messages of a conversation, oldest first. Each one says who wrote it (the customer, a team member or the AI), what sent it — agent, automation, broadcast —, whether it went out or failed and why, the transcript of voice notes, the reactions, and whether it is hidden and who hid it. This is what to read before having an opinion on a case.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        conversacion_id: ID_CONVERSACION,
        limite: { type: 'number', description: `Por defecto 30, máximo ${TOPE_MENSAJES}.` },
      },
      required: ['conversacion_id'],
    },
    run: mensajes,
  },

  {
    key: 'conversaciones.borradores',
    description:
      'Las respuestas que la IA dejó escritas y todavía no salieron, de la más vieja a la más nueva. Aparecen cuando el agente está en modo "aprobar cada mensaje": el cliente está esperando y nadie lo sabe hasta que alguien abre ese hilo.',
    descriptionEn:
      'The replies the AI wrote that have not gone out yet, oldest first. They appear when the agent is in "approve every message" mode: the customer is waiting and nobody knows until someone opens that thread.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: { limite: { type: 'number', description: 'Por defecto 20, máximo 50.' } },
    },
    run: borradores,
  },

  {
    key: 'conversaciones.asignar',
    description:
      'Le pone dueño a una conversación: un miembro del equipo, por nombre, correo o id. Sin miembro, la desasigna. Mientras esté asignada la IA deja de contestar ese hilo, salvo que el agente esté configurado para responder igual. Se deshace llamando de nuevo.',
    descriptionEn:
      'Gives a conversation an owner: a team member, by name, email or id. With no member, it unassigns. While assigned the AI stops replying to that thread, unless the agent is configured to reply anyway. Undone by calling it again.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        conversacion_id: ID_CONVERSACION,
        miembro: {
          type: 'string',
          description: 'Nombre, correo o id del compañero. Vacío = desasignar.',
        },
      },
      required: ['conversacion_id'],
    },
    async preview(ctx, args) {
      try {
        const conv = await exigirConversacion(ctx, args)
        const miembro = await destinatario(ctx, args)
        if (!miembro) {
          return `Dejaría sin dueño la conversación con ${comoSeLlama(conv)}. La IA vuelve a poder contestarla.`
        }
        return `Le pasaría a ${miembro.nombre} la conversación con ${comoSeLlama(conv)}. Mientras la tenga asignada, la IA no contesta ese hilo.`
      } catch (e) {
        throw e
      }
    },
    run: asignar,
  },

  {
    key: 'conversaciones.cerrar',
    description:
      'Marca una conversación como resuelta. Sale de la bandeja abierta, cuenta en "Resueltas hoy" y se cierra el pedido de intervención humana si lo había. Con reabrir=true vuelve a abrirla.',
    descriptionEn:
      'Marks a conversation as resolved. It leaves the open inbox, counts towards "Resolved today" and clears the request for a human if there was one. With reabrir=true it opens it again.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        conversacion_id: ID_CONVERSACION,
        reabrir: { type: 'boolean', description: 'true para volver a abrirla.' },
      },
      required: ['conversacion_id'],
    },
    async preview(ctx, args) {
      try {
        const conv = await exigirConversacion(ctx, args)
        if (args.reabrir === true) {
          return `Reabriría la conversación con ${comoSeLlama(conv)}. Deja de contar como resuelta.`
        }
        return `Daría por resuelta la conversación con ${comoSeLlama(conv)}. Sale de la bandeja abierta y cuenta en «Resueltas hoy».`
      } catch (e) {
        throw e
      }
    },
    run: cerrar,
  },

  {
    key: 'conversaciones.ia',
    description:
      'Prende o apaga la IA en UNA conversación, sin tocar al agente ni al resto de la bandeja. Apagarla es lo que se hace cuando una persona toma el caso; prenderla de nuevo devuelve el hilo a la IA y cierra el pedido de intervención humana.',
    descriptionEn:
      'Turns the AI on or off in ONE conversation, without touching the agent or the rest of the inbox. Turning it off is what happens when a person takes the case; turning it back on hands the thread back to the AI and clears the request for a human.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        conversacion_id: ID_CONVERSACION,
        activa: { type: 'boolean', description: 'true prende la IA, false la apaga.' },
      },
      required: ['conversacion_id', 'activa'],
    },
    async preview(ctx, args) {
      try {
        const conv = await exigirConversacion(ctx, args)
        // Prender y apagar no son la misma cosa aunque sean la misma llamada:
        // prender pone a la IA a contestarle a un cliente real en el próximo
        // mensaje, y eso es lo que tiene que leer quien aprueba.
        if (args.activa === true) {
          return `Prendería la IA en la conversación con ${comoSeLlama(conv)}. Vuelve a contestarle en cuanto escriba.`
        }
        return `Apagaría la IA en la conversación con ${comoSeLlama(conv)}. A partir de ahí contesta una persona o no contesta nadie.`
      } catch (e) {
        throw e
      }
    },
    run: ia,
  },
]
