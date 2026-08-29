/**
 * Conversaciones, contactos y por qué un mensaje no salió.
 *
 * El envío NO se implementa acá: delega en `engineSendText`, el mismo que usa
 * el motor de automatizaciones. Eso no es prolijidad — es lo que hace que un
 * mensaje mandado desde un agente pase por las mismas barreras que uno mandado
 * por un flujo: la baja del contacto, el enfriamiento, la ventana de 24 horas
 * de Meta, el cupo del WABA y el bloqueo de marketing a Estados Unidos. Una
 * segunda implementación del envío sería una segunda forma de saltárselas.
 */
import { engineSendText } from '@/lib/automations/meta-send'
import { cargarConversacion } from '@/lib/inbox/conversaciones'
import { enviarTextoEnConversacion } from '@/lib/inbox/enviar-texto'
import {
  PENDING_SENDER,
  hoursWaiting,
  looksLikePhone,
  phoneTail,
  since,
  windowDays,
} from './predicates'
import type { Artefacto } from '@/lib/operator/artifacts'
import {
  cambio,
  conversacion,
  corto,
  fecha,
  filasDe,
  lista,
  numero,
  tabla,
  tablero,
  tieneCampos,
  tt,
} from './vistas'
import type { Capability, CapabilityContext } from './types'

async function pendientes(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 20, 100)

  const { data } = await ctx.db
    .from('conversations')
    .select(
      'id, channel, status, last_message_at, last_sender_type, unread_count, needs_human_reason, needs_human_at, contacts(name, phone)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .is('deleted_at', null)
    .neq('status', 'closed')
    .eq('last_sender_type', PENDING_SENDER)
    .order('last_message_at', { ascending: true })
    .limit(limite)

  const filas = (data ?? []) as unknown as Array<{
    id: string
    channel: string
    last_message_at: string | null
    unread_count: number | null
    needs_human_reason: string | null
    contacts: { name: string | null; phone: string | null } | null
  }>

  return filas.map((c) => ({
    conversation_id: c.id,
    canal: c.channel,
    contacto: c.contacts?.name ?? c.contacts?.phone ?? 'sin nombre',
    telefono: c.contacts?.phone ?? null,
    horas_esperando: hoursWaiting(c.last_message_at),
    sin_leer: c.unread_count ?? 0,
    pidio_humano: c.needs_human_reason,
  }))
}

async function buscarContacto(ctx: CapabilityContext, args: Record<string, unknown>) {
  const q = String(args.busqueda ?? '').trim()
  if (!q) throw new Error('falta qué buscar')

  const filtro = looksLikePhone(q)
    ? `phone.like.%${phoneTail(q)},name.ilike.%${q}%`
    : `name.ilike.%${q}%,email.ilike.%${q}%`

  const { data } = await ctx.db
    .from('contacts')
    .select(
      'id, name, phone, email, opted_out, opted_out_reason, last_inbound_at, ai_segment, last_product, last_offer_chosen, created_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .or(filtro)
    .limit(10)

  const contactos = (data ?? []) as Array<{ id: string; name: string | null }>
  if (contactos.length === 0) return { encontrados: 0, contactos: [] }

  const ids = contactos.map((c) => c.id)
  const [etiquetas, pedidos] = await Promise.all([
    ctx.db.from('contact_tags').select('contact_id, tags(name)').in('contact_id', ids),
    ctx.db
      .from('orders')
      .select('contact_id, order_number, total_price, currency, financial_status, created_at')
      .eq('workspace_id', ctx.workspaceId)
      .in('contact_id', ids)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const porContacto = new Map<string, string[]>()
  for (const t of (etiquetas.data ?? []) as unknown as Array<{
    contact_id: string
    tags: { name: string } | { name: string }[] | null
  }>) {
    const tag = Array.isArray(t.tags) ? t.tags[0] : t.tags
    if (!tag) continue
    porContacto.set(t.contact_id, [...(porContacto.get(t.contact_id) ?? []), tag.name])
  }

  const pedidosDe = new Map<string, unknown[]>()
  for (const p of (pedidos.data ?? []) as Array<{ contact_id: string }>) {
    pedidosDe.set(p.contact_id, [...(pedidosDe.get(p.contact_id) ?? []), p])
  }

  return {
    encontrados: contactos.length,
    contactos: contactos.map((c) => ({
      ...c,
      etiquetas: porContacto.get(c.id) ?? [],
      pedidos: pedidosDe.get(c.id) ?? [],
    })),
  }
}

async function diagnostico(ctx: CapabilityContext, args: Record<string, unknown>) {
  const tail = phoneTail(args.telefono)
  const desde = since(windowDays(args.dias))

  const { data: contactos } = await ctx.db
    .from('contacts')
    .select('id, name, phone, opted_out, opted_out_at, opted_out_reason, last_inbound_at')
    .eq('workspace_id', ctx.workspaceId)
    .like('phone', `%${tail}`)

  const encontrados = (contactos ?? []) as Array<{ id: string; opted_out: boolean }>
  if (encontrados.length === 0) {
    return {
      encontrado: false,
      nota: 'No hay ningún contacto con ese teléfono en esta cuenta.',
    }
  }

  const ids = encontrados.map((c) => c.id)
  const { data: convs } = await ctx.db
    .from('conversations')
    .select('id')
    .eq('workspace_id', ctx.workspaceId)
    .in('contact_id', ids)
  const convIds = ((convs ?? []) as { id: string }[]).map((c) => c.id)

  const [corridas, mensajes] = await Promise.all([
    ctx.db
      .from('automation_logs')
      .select('created_at, status, trigger_event, steps_executed, error_message')
      .eq('workspace_id', ctx.workspaceId)
      .in('contact_id', ids)
      .gte('created_at', desde)
      .order('created_at', { ascending: false }),
    convIds.length
      ? ctx.db
          .from('messages')
          .select('created_at, template_name, status, error_code, error_reason, origin_name')
          .in('conversation_id', convIds)
          .neq('sender_type', 'customer')
          .gte('created_at', desde)
          .order('created_at', { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [] }),
  ])

  return {
    encontrado: true,
    contactos: encontrados,
    // Lo primero que hay que mirar: una baja explica todo lo demás.
    dado_de_baja: encontrados.some((c) => c.opted_out),
    corridas: corridas.data ?? [],
    mensajes: (mensajes as { data?: unknown[] }).data ?? [],
  }
}

async function conversacionDe(ctx: CapabilityContext, contactId: string) {
  const { data } = await ctx.db
    .from('conversations')
    .select('id')
    .eq('contact_id', contactId)
    .eq('workspace_id', ctx.workspaceId)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/**
 * Aprobar la respuesta que la IA dejó lista.
 *
 * Vive acá y no en `inbox.ts` por una razón de fondo: la bandeja gestiona hilos
 * y NO le escribe a nadie —hay un test que lo cuida—, y esto sí le escribe. Es
 * la misma frontera que deja `mensajes.enviar` de este lado.
 */
async function conversacionDelBorrador(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
) {
  const id = String(args.conversacion_id ?? '').trim()
  if (!id) throw new Error('Falta el id de la conversación.')
  const conv = await cargarConversacion(ctx.db, ctx.workspaceId, id)
  if (!conv) throw new Error('Esa conversación no existe en esta cuenta.')
  return conv
}

/** El borrador de esa conversación, o un error legible. */
async function exigirBorrador(ctx: CapabilityContext, conversationId: string) {
  const { data } = await ctx.db
    .from('ai_pending_replies')
    .select('id, content_text, agent_name')
    .eq('workspace_id', ctx.workspaceId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (!data) throw new Error('Esa conversación no tiene ninguna respuesta esperando.')
  return data as { id: string; content_text: string; agent_name: string | null }
}

async function decidirBorrador(ctx: CapabilityContext, args: Record<string, unknown>) {
  const conv = await conversacionDelBorrador(ctx, args)
  const borrador = await exigirBorrador(ctx, conv.id)

  if (args.descartar === true) {
    await ctx.db.from('ai_pending_replies').delete().eq('id', borrador.id)
    return { conversation_id: conv.id, contacto: conv.contacto, enviado: false }
  }

  // El texto se puede corregir al aprobarlo: cambiar dos palabras no debería
  // obligar a descartar y escribir de cero.
  const texto =
    typeof args.texto === 'string' && args.texto.trim()
      ? args.texto.trim()
      : borrador.content_text

  const enviado = await enviarTextoEnConversacion(ctx.db, {
    workspaceId: ctx.workspaceId,
    conversationId: conv.id,
    texto,
    actorUserId: ctx.actor.type === 'operator' ? (ctx.actor.id ?? null) : null,
    origen: 'ai_agent',
    origenNombre: borrador.agent_name,
  })
  // Recién ahora: si el envío falla, el borrador sigue ahí para reintentar.
  await ctx.db.from('ai_pending_replies').delete().eq('id', borrador.id)

  return { conversation_id: conv.id, enviado: true, ...enviado }
}


/**
 * Por qué no le llegó, en un tablero.
 *
 * La respuesta a "no le llega nada" son tres cosas, en este orden: si pidió la
 * baja —eso explica todo lo demás y va primero—, qué automatizaciones corrieron
 * y qué pasó con cada mensaje que salió. Un párrafo con eso adentro se lee dos
 * veces; una línea por intento, con su punto, ninguna.
 */
function vistaDiagnostico(ctx: CapabilityContext, r: unknown): Artefacto | null {
  if (!tieneCampos(r, 'encontrado')) return null
  const o = r as { encontrado: boolean; dado_de_baja?: boolean }
  if (!o.encontrado) return null
  const t = (k: string) => tt(ctx, `operation.${k}`)

  const filas: { que: string; estado: 'ok' | 'atencion' | 'roto' | 'apagado'; detalle?: string }[] =
    []

  // La baja primero: si pidió no recibir nada, el resto de la lista es ruido.
  if (o.dado_de_baja) {
    filas.push({ que: t('vDadoDeBaja'), estado: 'roto', detalle: t('vDadoDeBajaNota') })
  }

  for (const m of lista<{
    created_at: string
    template_name: string | null
    status: string | null
    error_reason: string | null
    origin_name: string | null
  }>(r, 'mensajes')) {
    const fallo = m.status === 'failed' || Boolean(m.error_reason)
    filas.push({
      que: `${fecha(ctx, m.created_at)} · ${m.template_name ?? m.origin_name ?? t('vMensaje')}`,
      estado: fallo ? 'roto' : m.status === 'sent' || m.status === 'delivered' ? 'ok' : 'atencion',
      detalle: m.error_reason ?? m.status ?? undefined,
    })
  }

  for (const c of lista<{ created_at: string; trigger_event: string | null; status: string; error_message: string | null }>(
    r,
    'corridas',
  )) {
    filas.push({
      que: `${fecha(ctx, c.created_at)} · ${c.trigger_event ?? t('vCorrida')}`,
      estado: c.status === 'success' ? 'ok' : c.status === 'failed' ? 'roto' : 'atencion',
      detalle: c.error_message ?? c.status,
    })
  }

  return tablero({ titulo: t('vTitDiagnostico'), filas })
}

/** Las conversaciones que esperan respuesta, con quién espera hace más. */
function vistaPendientesBandeja(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    contacto: string
    canal: string
    horas_esperando: number | null
    pidio_humano: string | null
  }>(r)
  return tabla({
    titulo: tt(ctx, 'operation.vTitEsperandoRespuesta'),
    columnas: [
      { clave: 'contacto', titulo: tt(ctx, 'operation.vColCliente') },
      { clave: 'canal', titulo: tt(ctx, 'operation.vColCanal') },
      { clave: 'motivo', titulo: tt(ctx, 'operation.vColMotivo') },
      { clave: 'espera', titulo: tt(ctx, 'operation.vColEsperando'), alineado: 'der' },
    ],
    filas: filas.map((c) => ({
      contacto: corto(c.contacto, 24),
      canal: c.canal,
      motivo: corto(c.pidio_humano, 34),
      espera: c.horas_esperando != null ? `${numero(ctx, Math.round(c.horas_esperando))} h` : '—',
    })),
    vacio: tt(ctx, 'operation.vSinPendientesBandeja'),
  })
}

/** Los contactos que coinciden con una búsqueda. */
function vistaBuscarContacto(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = filasDe(r, 'contactos') as {
    nombre?: string | null
    name?: string | null
    telefono?: string | null
    phone?: string | null
    canal?: string | null
  }[]
  return tabla({
    titulo: tt(ctx, 'operation.subContactos'),
    columnas: [
      { clave: 'nombre', titulo: tt(ctx, 'operation.vColCliente') },
      { clave: 'telefono', titulo: tt(ctx, 'operation.vColTelefono') },
      { clave: 'canal', titulo: tt(ctx, 'operation.vColCanal') },
    ],
    filas: filas.map((c) => ({
      nombre: corto(c.nombre ?? c.name, 28),
      telefono: c.telefono ?? c.phone ?? '—',
      canal: c.canal ?? '—',
    })),
    vacio: tt(ctx, 'operation.vSinContactos'),
  })
}

/**
 * El mensaje que se le va a mandar a alguien, como lo va a leer.
 *
 * Es lo más irreversible que hace Riverz: un mensaje enviado no vuelve. Lo que
 * se aprueba tiene que ser el TEXTO, entero, y no una frase que lo resuma.
 */
function vistaEnviar(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const texto = typeof args.texto === 'string' ? args.texto : String(args.mensaje ?? '')
  return conversacion({
    titulo: tt(ctx, 'operation.vTitEnviar'),
    canal: typeof args.canal === 'string' ? args.canal : undefined,
    mensajes: [
      { de: 'negocio', texto },
      { de: 'nota', texto: tt(ctx, 'operation.vEnviarAviso') },
    ],
  })
}

/** Aprobar o descartar el borrador que escribió la IA: se muestra el texto. */
function vistaDecidirBorrador(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const manda = args.aprobar !== false && args.descartar !== true
  const texto = typeof args.texto === 'string' && args.texto ? args.texto : null
  if (!manda || !texto) {
    return cambio({
      titulo: tt(ctx, 'operation.vTitBorradores'),
      que: tt(ctx, manda ? 'operation.vQueAprobarBorrador' : 'operation.vQueDescartarBorrador'),
    })
  }
  return conversacion({
    titulo: tt(ctx, 'operation.vTitBorradores'),
    mensajes: [
      { de: 'negocio', texto },
      { de: 'nota', texto: tt(ctx, 'operation.vEnviarAviso') },
    ],
  })
}
export const MESSAGING_CAPABILITIES: Capability[] = [
  {
    key: 'conversaciones.aprobar_borrador',
    description:
      'Manda la respuesta que la IA dejó esperando en una conversación, o la descarta con descartar=true. Se puede corregir el texto al aprobarlo. Le llega a una persona real y no se puede deshacer.',
    descriptionEn:
      'Sends the reply the AI left waiting on a conversation, or discards it with descartar=true. The text can be edited on approval. It reaches a real person and cannot be undone.',
    risk: 'irreversible',
    // Descartar no le llega a nadie: borra un borrador que nunca salió.
    inerte: (args) => args.descartar === true,
    schema: {
      type: 'object',
      properties: {
        conversacion_id: {
          type: 'string',
          description: 'El conversation_id que devuelve conversaciones.buscar.',
        },
        texto: {
          type: 'string',
          description: 'Reemplaza el texto del borrador. Vacío = se manda tal cual.',
        },
        descartar: { type: 'boolean', description: 'true lo borra sin mandarlo.' },
      },
      required: ['conversacion_id'],
    },
    async preview(ctx, args) {
      const conv = await conversacionDelBorrador(ctx, args)
      const borrador = await exigirBorrador(ctx, conv.id)
      if (args.descartar === true) {
        return `Descartaría la respuesta que la IA dejó para ${`${conv.contacto ?? 'sin nombre'} (${conv.channel})`}. No sale nada.`
      }
      const texto =
        typeof args.texto === 'string' && args.texto.trim()
          ? args.texto.trim()
          : borrador.content_text
      return `Le mandaría a ${`${conv.contacto ?? 'sin nombre'} (${conv.channel})`}: "${texto}"`
    },
    run: decidirBorrador,
    artifact: (ctx, args) => vistaDecidirBorrador(ctx, args),
  },

  {
    key: 'conversaciones.pendientes',
    description:
      'Las conversaciones que están esperando una respuesta: alguien escribió y nadie contestó, o la IA pidió que intervenga una persona. Es la primera pregunta de la mañana.',
    descriptionEn:
      'The conversations waiting for a reply: someone wrote and nobody answered, or the AI asked for a human. It is the first question of the morning.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        limite: { type: 'number', description: 'Cuántas traer. Por defecto 20.' },
      },
    },
    run: pendientes,
    vista: (ctx, _args, r) => vistaPendientesBandeja(ctx, r),
  },

  {
    key: 'contactos.buscar',
    description:
      'Busca un cliente por teléfono, nombre o correo y devuelve su ficha: etiquetas, si pidió la baja, cuándo escribió por última vez, sus pedidos y qué le interesó. Sirve para contestar "¿quién es este?" antes de escribirle.',
    descriptionEn:
      'Finds a customer by phone, name or email and returns their record: tags, whether they opted out, when they last wrote, their orders and what caught their interest. Answers "who is this?" before writing to them.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        busqueda: { type: 'string', description: 'Teléfono, nombre o correo.' },
      },
      required: ['busqueda'],
    },
    run: buscarContacto,
    vista: (ctx, _args, r) => vistaBuscarContacto(ctx, r),
  },

  {
    key: 'mensajes.diagnostico',
    description:
      'Explica por qué una persona no recibió un mensaje. Recibe un teléfono y devuelve: si está dada de baja, qué automatizaciones corrieron para ese contacto y con qué resultado, qué barrera lo frenó, y los mensajes que sí salieron. Es la herramienta de diagnóstico.',
    descriptionEn:
      'Explains why a person did not receive a message. Takes a phone number and returns whether they opted out, which automations ran for that contact and with what result, which guard stopped it, and the messages that did go out. This is the diagnostic tool.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        telefono: {
          type: 'string',
          description: 'Con o sin +, se compara por los últimos 8 dígitos.',
        },
        dias: { type: 'number', description: 'Cuántos días hacia atrás mirar. Por defecto 7.' },
      },
      required: ['telefono'],
    },
    run: diagnostico,
    vista: (ctx, _args, r) => vistaDiagnostico(ctx, r),
  },

  {
    key: 'mensajes.enviar',
    description:
      'Manda un mensaje de WhatsApp a un contacto de la cuenta. Le llega a una persona real, así que primero devuelve qué haría y espera confirmación.',
    descriptionEn:
      'Sends a WhatsApp message to a contact of the account. It reaches a real person, so it first returns what it would do and waits for confirmation.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        contact_id: { type: 'string' },
        texto: { type: 'string' },
      },
      required: ['contact_id', 'texto'],
    },
    async preview(ctx, args) {
      const { data } = await ctx.db
        .from('contacts')
        .select('name, phone, opted_out')
        .eq('id', String(args.contact_id))
        .eq('workspace_id', ctx.workspaceId)
        .maybeSingle()
      const c = data as { name?: string; phone?: string; opted_out?: boolean } | null
      if (!c) throw new Error('Ese contacto no existe en esta cuenta.')
      const baja = c.opted_out ? ' — OJO: pidió la baja, el envío se va a frenar' : ''
      return `Le mandaría a ${c.name ?? 'sin nombre'} (${c.phone}): "${args.texto}"${baja}`
    },
    async run(ctx, args) {
      const contactId = String(args.contact_id)
      const conversationId = await conversacionDe(ctx, contactId)
      if (!conversationId) throw new Error('ese contacto no tiene conversación abierta')
      return engineSendText({
        workspaceId: ctx.workspaceId,
        conversationId,
        contactId,
        text: String(args.texto),
        automationName: ctx.actor.type === 'operator' ? 'Operator' : 'MCP',
        reason: 'asistente',
      })
    },
    artifact: (ctx, args) => vistaEnviar(ctx, args),
  },
]
