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
import { gapCapabilityActor } from '@/lib/ai/gap-knowledge-actions'
import { hoursWaiting } from './predicates'
import type { Artefacto } from '@/lib/operator/artifacts'
import { cambio, corto, fecha, lista, tabla, tablero, tt } from './vistas'
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
  const { data,error }=await ctx.db.rpc('list_visible_answer_gaps',{ p_workspace_id:ctx.workspaceId,p_actor_id:gapCapabilityActor(ctx),p_resolved:args.incluir_resueltos===true })
  if (error) throw new Error(error.message)

  const filas = (data ?? []).slice(0,limite) as unknown as Array<{
    id: string
    question_key: string
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
      hueco_clave:f.question_key,
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

/** Los estados por los que pasa una devolución. */
const ESTADOS_DEVOLUCION = ['abierta', 'aprobada', 'rechazada', 'recibida', 'resuelta'] as const

const QUE_SIGNIFICA: Record<string, string> = {
  abierta: 'la deja esperando una decisión',
  aprobada: 'ACEPTA la devolución: el cliente devuelve y se le reintegra',
  rechazada: 'RECHAZA la devolución: no hay reintegro',
  recibida: 'marca que el producto ya volvió',
  resuelta: 'la da por cerrada',
}

async function devolucionPorId(ctx: CapabilityContext, id: string) {
  const { data } = await ctx.db
    .from('returns')
    .select('id, order_number, kind, reason, status, contacts(name)')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .maybeSingle()
  if (!data) throw new Error('Esa devolución no existe en esta cuenta.')
  return data as unknown as {
    id: string
    order_number: string | null
    kind: string | null
    reason: string | null
    status: string
    contacts: { name: string | null } | null
  }
}

async function decidirDevolucion(ctx: CapabilityContext, args: Record<string, unknown>) {
  const dev = await devolucionPorId(ctx, String(args.devolucion_id ?? '').trim())
  const estado = String(args.estado ?? '')
  if (!(ESTADOS_DEVOLUCION as readonly string[]).includes(estado)) {
    throw new Error(`Estado desconocido: ${estado}`)
  }

  const { error } = await ctx.db
    .from('returns')
    .update({
      status: estado,
      resolution:
        typeof args.nota === 'string' ? args.nota.trim().slice(0, 500) || null : null,
      decided_by: ctx.actor.type === 'operator' ? (ctx.actor.id ?? null) : null,
      decided_at: new Date().toISOString(),
    })
    .eq('id', dev.id)
    // El recorte de cuenta: sin esto un id suelto movería la devolución de otro
    // comercio, porque esto corre con llave de servicio.
    .eq('workspace_id', ctx.workspaceId)
  if (error) throw new Error(error.message)

  return { devolucion_id: dev.id, pedido: dev.order_number, estado }
}


/**
 * Lo que la bandeja sabe, dibujado.
 *
 * Cinco listas distintas y una regla en común: la columna que decide qué hacer
 * va antes que el identificador. En los reclamos es el vencimiento —Mercado
 * Libre falla a favor del comprador si nadie contesta a tiempo—; en los huecos,
 * qué le faltó saber a la IA; en el reparto, si la regla está prendida.
 */
function vistaReclamos(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    pedido: string | null
    comprador: string
    etapa: string | null
    motivo: string | null
    abierto_hace_horas: number | null
    vence: string | null
  }>(r, 'reclamos')
  return tabla({
    titulo: tt(ctx, 'operation.vTitReclamos'),
    columnas: [
      { clave: 'comprador', titulo: tt(ctx, 'operation.vColCliente') },
      { clave: 'pedido', titulo: tt(ctx, 'operation.vColPedido') },
      { clave: 'motivo', titulo: tt(ctx, 'operation.vColMotivo') },
      { clave: 'etapa', titulo: tt(ctx, 'operation.vColEtapa') },
      { clave: 'vence', titulo: tt(ctx, 'operation.vColVence') },
    ],
    filas: filas.map((c) => ({
      comprador: corto(c.comprador, 22),
      pedido: corto(c.pedido, 16),
      motivo: corto(c.motivo, 34),
      etapa: corto(c.etapa, 16),
      // El plazo es lo único que urge: pasado el vencimiento la plataforma
      // decide sola y a favor del comprador.
      vence: c.vence ? fecha(ctx, c.vence) : '—',
    })),
    vacio: tt(ctx, 'operation.vSinReclamos'),
  })
}

function vistaDevoluciones(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    pedido: string | null
    cliente: string
    tipo: string | null
    motivo: string | null
    estado: string | null
    pedida_el: string
  }>(r, 'devoluciones')
  return tabla({
    titulo: tt(ctx, 'operation.vTitDevoluciones'),
    columnas: [
      { clave: 'cliente', titulo: tt(ctx, 'operation.vColCliente') },
      { clave: 'pedido', titulo: tt(ctx, 'operation.vColPedido') },
      { clave: 'motivo', titulo: tt(ctx, 'operation.vColMotivo') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
      { clave: 'cuando', titulo: tt(ctx, 'operation.vColCuando') },
    ],
    filas: filas.map((d) => ({
      cliente: corto(d.cliente, 22),
      pedido: corto(d.pedido, 16),
      motivo: corto(d.motivo, 34),
      estado: [d.tipo, d.estado].filter(Boolean).join(' · ') || '—',
      cuando: fecha(ctx, d.pedida_el),
    })),
    vacio: tt(ctx, 'operation.vSinDevoluciones'),
  })
}

/**
 * Lo que la IA no supo contestar.
 *
 * La columna que convierte esta lista de un reproche en una tarea es «qué
 * falta»: dice qué dato hay que cargar para que la próxima vez sí sepa.
 */
function vistaHuecos(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    pregunta: string
    que_falta: string | null
    canal: string | null
    cuando: string
    resuelto_el: string | null
  }>(r, 'huecos')
  return tabla({
    titulo: tt(ctx, 'operation.vTitHuecos'),
    columnas: [
      { clave: 'pregunta', titulo: tt(ctx, 'operation.vColPregunta') },
      { clave: 'falta', titulo: tt(ctx, 'operation.vColQueFalta') },
      { clave: 'cuando', titulo: tt(ctx, 'operation.vColCuando') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
    ],
    filas: filas.map((h) => ({
      pregunta: corto(h.pregunta, 44),
      falta: corto(h.que_falta, 34),
      cuando: fecha(ctx, h.cuando),
      estado: h.resuelto_el
        ? tt(ctx, 'operation.vResuelto')
        : tt(ctx, 'operation.vSinResolver'),
    })),
    vacio: tt(ctx, 'operation.vSinHuecos'),
  })
}

function vistaAtajos(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{ atajo: string; titulo: string | null; texto: string; oculto: boolean }>(
    r,
    'atajos',
  )
  return tabla({
    titulo: tt(ctx, 'operation.vTitAtajos'),
    columnas: [
      { clave: 'atajo', titulo: tt(ctx, 'operation.vColAtajo') },
      { clave: 'texto', titulo: tt(ctx, 'operation.vColTexto') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
    ],
    filas: filas.map((a) => ({
      atajo: corto(a.atajo, 18),
      texto: corto(a.titulo ?? a.texto, 56),
      estado: a.oculto ? tt(ctx, 'operation.vOculto') : '—',
    })),
    vacio: tt(ctx, 'operation.vSinAtajos'),
  })
}

function vistaFiltros(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{ nombre: string }>(r, 'filtros')
  return tabla({
    titulo: tt(ctx, 'operation.vTitFiltros'),
    columnas: [{ clave: 'nombre', titulo: tt(ctx, 'operation.vColNombre') }],
    filas: filas.map((f) => ({ nombre: corto(f.nombre, 40) })),
    vacio: tt(ctx, 'operation.vSinFiltros'),
  })
}

/**
 * A quién le toca cada conversación.
 *
 * Va en tablero: la pregunta es si la regla está prendida, y gana la de número
 * más bajo — por eso se lee en orden y con las apagadas a la vista.
 */
function vistaReparto(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    nombre: string
    activa: boolean
    prioridad: number | null
    reparte: string | null
    canal: string | null
  }>(r, 'reglas')
  return tablero({
    titulo: tt(ctx, 'operation.vTitReparto'),
    filas: filas.map((g) => ({
      que: g.nombre,
      estado: g.activa ? ('ok' as const) : ('apagado' as const),
      detalle: [g.reparte, g.canal].filter(Boolean).join(' · ') || undefined,
    })),
  })
}

/** Prender o apagar una regla de reparto. */
function vistaActivarReparto(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const prende = args.activa === true
  return cambio({
    titulo: tt(ctx, 'operation.vTitReparto'),
    que: tt(ctx, prende ? 'operation.vQuePrenderReparto' : 'operation.vQueApagarReparto'),
  })
}

/** Un atajo nuevo, con el texto entero: es lo que alguien va a mandar de verdad. */
function vistaCrearAtajo(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const t = (k: string) => tt(ctx, `operation.${k}`)
  return cambio({
    titulo: `/${String(args.atajo ?? '').replace(/^\//, '')}`,
    que: t('vQueCrearAtajo'),
    campos: [{ etiqueta: t('vColTexto'), despues: String(args.texto ?? '') }],
  })
}

/**
 * Decidir una devolución.
 *
 * Le llega al cliente: aceptar una devolución es plata que vuelve y rechazarla
 * es una conversación que se pone difícil. La tarjeta dice cuál de las dos es.
 */
function vistaDecidirDevolucion(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const estado = String(args.decision ?? args.estado ?? '')
  return cambio({
    titulo: tt(ctx, 'operation.vTitDecidirDevolucion'),
    que: estado,
    aviso: tt(ctx, 'operation.vDecidirDevolucionAviso'),
  })
}
export const BANDEJA_CAPABILITIES: Capability[] = [
  {
    key: 'bandeja.decidir_devolucion',
    description:
      'Decide una devolución o cambio: aprobarla, rechazarla, marcar que el producto volvió o darla por cerrada, con la nota de por qué. Aprobar significa que el cliente devuelve y se le reintegra la plata — es una decisión de negocio y no se deshace sola.',
    descriptionEn:
      'Decides a return or exchange: approve it, reject it, mark the product as received or close it, with a note explaining why. Approving means the customer returns the item and gets their money back — a business decision that does not undo itself.',
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        devolucion_id: { type: 'string', description: 'El id que devuelve bandeja.devoluciones.' },
        estado: { type: 'string', enum: [...ESTADOS_DEVOLUCION] },
        nota: { type: 'string', description: 'Por qué se decidió así. La lee el equipo.' },
      },
      required: ['devolucion_id', 'estado'],
    },
    async preview(ctx, args) {
      const dev = await devolucionPorId(ctx, String(args.devolucion_id ?? '').trim())
      const quien = dev.contacts?.name ?? 'un cliente'
      const pedido = dev.order_number ? ` del pedido ${dev.order_number}` : ''
      const que = QUE_SIGNIFICA[String(args.estado ?? '')] ?? 'la mueve de estado'
      return `Sobre la devolución de ${quien}${pedido} (hoy «${dev.status}»): ${que}.`
    },
    run: decidirDevolucion,
    artifact: (ctx, args) => vistaDecidirDevolucion(ctx, args),
  },
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
    vista: (ctx, _args, r) => vistaReclamos(ctx, r),
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
    vista: (ctx, _args, r) => vistaDevoluciones(ctx, r),
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
    vista: (ctx, _args, r) => vistaHuecos(ctx, r),
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
    vista: (ctx, _args, r) => vistaAtajos(ctx, r),
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
    artifact: (ctx, args) => vistaCrearAtajo(ctx, args),
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
    vista: (ctx, _args, r) => vistaFiltros(ctx, r),
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
    vista: (ctx, _args, r) => vistaReparto(ctx, r),
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
    artifact: (ctx, args) => vistaActivarReparto(ctx, args),
  },
]
