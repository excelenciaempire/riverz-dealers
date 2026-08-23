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
