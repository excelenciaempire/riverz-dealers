/**
 * Lo que vive DENTRO de la bandeja y no es una conversación.
 *
 * La bandeja no es sólo una lista de hilos: al costado tiene un panel de
 * reclamos de Mercado Libre, un registro de devoluciones, los atajos que el
 * equipo escribe con "/", los filtros que cada uno se guardó y las reglas que
 * reparten los hilos solos. Todo eso existía y ninguna capacidad lo miraba, así
 * que el chat no podía contestar "¿tengo reclamos abiertos?" ni "¿por qué le
 * cae todo a la misma persona?".
 *
 * Y los huecos: cada vez que la IA no supo contestar algo, queda anotado. Es la
 * lista de lo que le falta saber al negocio, ordenada por lo que más preguntan.
 * Se tapa cargando el dato una vez.
 */
import { hoursWaiting } from './predicates'
import type { Capability, CapabilityContext } from './types'

const TOPE = 50

// ---------------------------------------------------------------------------

async function reclamos(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 20, TOPE)
  let q = ctx.db
    .from('ml_claims')
    .select(
      'id, claim_id, order_id, stage, status, type, reason, last_message, opened_at, due_at, contacts(name)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('opened_at', { ascending: true })
    .limit(limite)
  // Por defecto sólo los que siguen abiertos: un reclamo cerrado no es trabajo.
  if (args.incluir_cerrados !== true) q = q.neq('status', 'closed')

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as unknown as Array<{
    id: string
    claim_id: string
    order_id: string | null
    stage: string | null
    status: string | null
    type: string | null
    reason: string | null
    last_message: string | null
    opened_at: string | null
    due_at: string | null
    contacts: { name: string | null } | null
  }>

  return {
    reclamos: filas.map((r) => ({
      reclamo_id: r.claim_id,
      pedido: r.order_id,
      comprador: r.contacts?.name ?? 'sin nombre',
      etapa: r.stage,
      estado: r.status,
      tipo: r.type,
      motivo: r.reason,
      ultimo_mensaje: r.last_message,
      abierto_hace_horas: hoursWaiting(r.opened_at),
      // Mercado Libre pone un plazo: pasado el vencimiento decide a favor del
      // comprador sin escuchar a nadie.
      vence: r.due_at,
    })),
  }
}

async function devoluciones(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 20, TOPE)
  let q = ctx.db
    .from('returns')
    .select(
      'id, order_number, kind, reason, customer_note, status, resolution, created_at, decided_at, conversation_id, contacts(name)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limite)
  if (typeof args.estado === 'string') q = q.eq('status', args.estado)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  return {
    devoluciones: ((data ?? []) as unknown as Array<{
      id: string
      order_number: string | null
      kind: string | null
      reason: string | null
      customer_note: string | null
      status: string | null
      resolution: string | null
      created_at: string
      decided_at: string | null
      conversation_id: string | null
      contacts: { name: string | null } | null
    }>).map((d) => ({
      devolucion_id: d.id,
      pedido: d.order_number,
      cliente: d.contacts?.name ?? 'sin nombre',
      tipo: d.kind,
      motivo: d.reason,
      lo_que_dijo: d.customer_note,
      estado: d.status,
      resolucion: d.resolution,
      pedida_el: d.created_at,
      decidida_el: d.decided_at,
      conversation_id: d.conversation_id,
    })),
  }
}

async function huecos(ctx: CapabilityContext, args: Record<string, unknown>) {
  const limite = Math.min(Number(args.limite) || 30, 100)
  let q = ctx.db
    .from('answer_gaps')
    .select('id, question, missing, channel, created_at, resolved_at, conversation_id')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(limite)
  // Por defecto sólo lo que sigue sin respuesta: lo ya cargado no es trabajo.
  if (args.incluir_resueltos !== true) q = q.is('resolved_at', null)

  const { data, error } = await q
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as unknown as Array<{
    id: string
    question: string | null
    missing: string | null
    channel: string | null
    created_at: string
    resolved_at: string | null
    conversation_id: string | null
  }>

  // Lo mismo preguntado diez veces es un solo hueco, y es el que hay que tapar
  // primero. Sin agrupar, la lista repite la misma pregunta y esconde el resto.
  const porFalta = new Map<string, number>()
  for (const f of filas) {
    const clave = (f.missing ?? f.question ?? '').trim().toLowerCase()
    if (clave) porFalta.set(clave, (porFalta.get(clave) ?? 0) + 1)
  }
  const masPedido = [...porFalta.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([que, veces]) => ({ que_falta: que, veces }))

  return {
    mas_pedido: masPedido,
    huecos: filas.map((f) => ({
      hueco_id: f.id,
      pregunta: f.question,
      que_falta: f.missing,
      canal: f.channel,
      cuando: f.created_at,
      resuelto_el: f.resolved_at,
      conversation_id: f.conversation_id,
    })),
  }
}

async function atajos(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('message_snippets')
    .select('id, shortcut, title, body, hidden')
    .eq('workspace_id', ctx.workspaceId)
    .order('shortcut', { ascending: true })
    .limit(100)

  return {
    atajos: ((data ?? []) as Array<{
      id: string
      shortcut: string
      title: string | null
      body: string
      hidden: boolean | null
    }>).map((a) => ({
      atajo_id: a.id,
      atajo: `/${a.shortcut}`,
      titulo: a.title,
      texto: a.body,
      oculto: a.hidden === true,
    })),
  }
}

async function crearAtajo(ctx: CapabilityContext, args: Record<string, unknown>) {
  const shortcut = String(args.atajo ?? '')
    .trim()
    .replace(/^\//, '')
  const body = String(args.texto ?? '').trim()
  if (!shortcut) throw new Error('Falta el atajo (lo que se escribe después de la barra).')
  if (!body) throw new Error('Falta el texto que escribe el atajo.')

  const { data, error } = await ctx.db
    .from('message_snippets')
    .insert({
      workspace_id: ctx.workspaceId,
      shortcut,
      title: typeof args.titulo === 'string' ? args.titulo.trim() || null : null,
      body,
      created_by: ctx.actor.type === 'operator' ? (ctx.actor.id ?? null) : null,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  return { atajo_id: (data as { id: string }).id, atajo: `/${shortcut}`, texto: body }
}

async function filtros(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('inbox_saved_filters')
    .select('id, name, config, sort_order')
    .eq('workspace_id', ctx.workspaceId)
    .order('sort_order', { ascending: true })
    .limit(50)

  return {
    filtros: ((data ?? []) as Array<{
      id: string
      name: string
      config: Record<string, unknown> | null
    }>).map((f) => ({ filtro_id: f.id, nombre: f.name, criterio: f.config })),
  }
}

async function reparto(ctx: CapabilityContext) {
  const { data } = await ctx.db
    .from('conversation_assignment_rules')
    .select('id, name, is_active, priority, kind, config, channel')
    .eq('workspace_id', ctx.workspaceId)
    .order('priority', { ascending: true })
    .limit(50)

  return {
    reglas: ((data ?? []) as Array<{
      id: string
      name: string
      is_active: boolean | null
      priority: number | null
      kind: string | null
      config: Record<string, unknown> | null
      channel: string | null
    }>).map((r) => ({
      regla_id: r.id,
      nombre: r.name,
      activa: r.is_active === true,
      // Gana la de número más bajo, igual que en las reglas de comentarios.
      prioridad: r.priority,
      reparte: r.kind,
      canal: r.channel,
      criterio: r.config,
    })),
  }
}

async function activarReparto(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = String(args.regla_id ?? '').trim()
  if (!id) throw new Error('Falta el id de la regla.')
  const activa = args.activa === true

  const { data, error } = await ctx.db
    .from('conversation_assignment_rules')
    .update({ is_active: activa })
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .select('id, name')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Esa regla de reparto no existe en esta cuenta.')

  return { regla_id: id, nombre: (data as { name: string }).name, activa }
}

// ---------------------------------------------------------------------------

export const BANDEJA_CAPABILITIES: Capability[] = [
  {
    key: 'bandeja.reclamos',
    description:
      'Los reclamos abiertos de Mercado Libre, del más viejo al más nuevo: de qué pedido, por qué, en qué etapa está y cuándo vence. El plazo importa — pasado el vencimiento Mercado Libre decide a favor del comprador sin escuchar a nadie. Con incluir_cerrados=true trae también los resueltos.',
    descriptionEn:
      'The open Mercado Libre claims, oldest first: which order, why, what stage it is in and when it is due. The deadline matters — past it Mercado Libre rules for the buyer without hearing anyone. With incluir_cerrados=true it also returns the resolved ones.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        incluir_cerrados: { type: 'boolean' },
        limite: { type: 'number', description: `Por defecto 20, máximo ${TOPE}.` },
      },
    },
    run: reclamos,
  },

  {
    key: 'bandeja.devoluciones',
    description:
      'Las devoluciones y cambios pedidos por clientes: de qué pedido, por qué, qué dijo la persona, en qué estado quedó y cómo se resolvió. Se puede filtrar por estado.',
    descriptionEn:
      'The returns and exchanges customers asked for: which order, why, what the person said, what state it is in and how it was resolved. Filterable by status.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        estado: { type: 'string' },
        limite: { type: 'number', description: `Por defecto 20, máximo ${TOPE}.` },
      },
    },
    run: devoluciones,
  },

  {
    key: 'bandeja.huecos',
    description:
      'Lo que la IA NO supo contestar, con la pregunta del cliente y qué dato le faltaba. Viene agrupado por lo que más se repite: eso es lo que hay que cargar primero en el producto o en las reglas del negocio. Cada hueco tapado son respuestas que la IA deja de esquivar.',
    descriptionEn:
      'What the AI could NOT answer, with the customer question and which fact was missing. It comes grouped by what repeats most: that is what to load first into the product or the business rules. Every gap closed is answers the AI stops dodging.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        incluir_resueltos: { type: 'boolean' },
        limite: { type: 'number', description: 'Por defecto 30, máximo 100.' },
      },
    },
    run: huecos,
  },

  {
    key: 'bandeja.atajos',
    description:
      'Los atajos de texto del equipo: lo que se escribe con "/" en la bandeja y se convierte en una respuesta ya redactada.',
    descriptionEn:
      'The team text snippets: what you type with "/" in the inbox and turns into a ready-made reply.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: atajos,
  },

  {
    key: 'bandeja.crear_atajo',
    description:
      'Crea un atajo de texto para la bandeja: quien escriba "/nombre" al contestar inserta ese texto. No le llega a nadie hasta que alguien lo use.',
    descriptionEn:
      'Creates a text snippet for the inbox: whoever types "/name" while replying inserts that text. It reaches nobody until someone uses it.',
    risk: 'reversible',
    // Es una plantilla guardada: no sale de la cuenta.
    inerte: true,
    schema: {
      type: 'object',
      properties: {
        atajo: { type: 'string', description: 'Lo que va después de la barra, sin la barra.' },
        texto: { type: 'string' },
        titulo: { type: 'string' },
      },
      required: ['atajo', 'texto'],
    },
    async preview(_ctx, args) {
      const atajo = String(args.atajo ?? '').replace(/^\//, '')
      return `Guardaría el atajo /${atajo}: "${String(args.texto ?? '')}"`
    },
    run: crearAtajo,
  },

  {
    key: 'bandeja.filtros',
    description:
      'Las vistas guardadas de la bandeja: qué recorte de conversaciones se guardó cada uno y con qué criterio.',
    descriptionEn:
      'The saved inbox views: which slice of conversations each one saved and with what criteria.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: filtros,
  },

  {
    key: 'bandeja.reparto',
    description:
      'Las reglas que reparten las conversaciones solas: a quién le cae cada hilo, con qué criterio, en qué canal y con qué prioridad (gana la de número más bajo). Es lo que explica por qué le llega todo a la misma persona.',
    descriptionEn:
      'The rules that assign conversations automatically: who gets each thread, with what criteria, on which channel and with what priority (lowest number wins). This is what explains why everything lands on the same person.',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: reparto,
  },

  {
    key: 'bandeja.activar_reparto',
    description:
      'Prende o apaga una regla de reparto. Prenderla hace que las conversaciones nuevas empiecen a caerle a quien diga la regla; apagarla las deja sin dueño. Sólo alcanza a lo que entre a partir de ahora.',
    descriptionEn:
      'Turns an assignment rule on or off. Turning it on starts routing new conversations to whoever the rule says; turning it off leaves them unassigned. It only affects what comes in from now on.',
    risk: 'reversible',
    schema: {
      type: 'object',
      properties: {
        regla_id: { type: 'string', description: 'El id que devuelve bandeja.reparto.' },
        activa: { type: 'boolean' },
      },
      required: ['regla_id', 'activa'],
    },
    async preview(ctx, args) {
      const { data } = await ctx.db
        .from('conversation_assignment_rules')
        .select('name')
        .eq('workspace_id', ctx.workspaceId)
        .eq('id', String(args.regla_id ?? ''))
        .maybeSingle()
      const nombre = (data as { name?: string } | null)?.name ?? 'esa regla'
      return args.activa === true
        ? `Prendería la regla de reparto «${nombre}». Las conversaciones nuevas empiezan a caerle a quien diga.`
        : `Apagaría la regla de reparto «${nombre}». Lo que entre queda sin dueño.`
    },
    run: activarReparto,
  },
]
