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
import {
  PENDING_SENDER,
  hoursWaiting,
  looksLikePhone,
  phoneTail,
  since,
  windowDays,
} from './predicates'
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

export const MESSAGING_CAPABILITIES: Capability[] = [
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
  },
]
