/**
 * Voz: cómo salieron las llamadas y cómo se pide una nueva.
 *
 * Es el único dominio donde el resultado de una capacidad suena en el bolsillo
 * de una persona. Por eso llamar no escribe en `voice_calls` directo: envuelve
 * a `enqueueCall`, que es la ÚNICA puerta por la que se crea una llamada
 * (manual, automatización, seguimiento o reintento). Detrás de esa puerta
 * están todas las barreras — freno de emergencia, tope de minutos del mes,
 * baja del contacto, agente pausado, teléfono inválido — y un INSERT propio se
 * las saltearía las cinco sin que nadie se enterara.
 *
 * Tampoco marca al instante: deja la llamada encolada y la despacha el cron de
 * voz. Eso es lo que permite respetar la franja horaria del agente, que es la
 * diferencia entre confirmar un pedido y despertar a un cliente a las tres de
 * la mañana.
 */
import { DEFAULT_CALLING_HOURS, OUTBOUND_CALL_TYPES } from '@/lib/voice/constants'
import { enqueueCall, nextAllowedTime } from '@/lib/voice/queue'
import { pickVoiceAgent } from '@/lib/voice/inbound'
import { summarizeVoiceCalls, VOICE_STATS_COLUMNS } from '@/lib/voice/analytics'
import { blockerCodeFromReason, VOICE_BLOCKED_KEY } from '@/lib/voice/labels'
import { translate } from '@/lib/i18n/translate'
import { workspaceTimezone } from '@/lib/workspaces/timezone'
import type { VoiceCall, VoiceCallType, VoiceCallingHours } from '@/types'
import { since, windowDays } from './predicates'
import type { Artefacto } from '@/lib/operator/artifacts'
import { cambio, corto, fecha, ficha, lista, numero, tabla, tieneCampos, tt } from './vistas'
import type { Capability, CapabilityContext } from './types'

/** Cuántas llamadas como mucho devuelve un listado. */
const TOPE_LISTADO = 200

/**
 * Por qué no se encoló, en castellano.
 *
 * `enqueueCall` devuelve códigos pensados para un log (`opt_out`,
 * `kill_switch`). Quien lee esto es un modelo que después se lo explica al
 * comercio, y "kill_switch" no le dice a nadie que hay un interruptor prendido
 * en la configuración de voz esperando que lo apaguen.
 *
 * Las frases salen del MISMO catálogo que ve el comercio en el lienzo y en la
 * pantalla de Voz: antes había una copia acá, sólo en castellano, y el motivo
 * que leía el modelo podía no coincidir con el cartel de la pantalla.
 */
function motivo(reason: string): string {
  return translate('es', VOICE_BLOCKED_KEY[blockerCodeFromReason(reason)])
}

// ---------------------------------------------------------------------------

interface AgenteVoz {
  id: string
  nombre: string
  horas: VoiceCallingHours
}

/**
 * Con qué agente se llama.
 *
 * Sin `agente_id` se elige igual que en las llamadas entrantes y que en el
 * botón "llamar" del panel (`pickVoiceAgent`: el de mayor prioridad con voz
 * activada). Que sea la misma función importa: si acá eligiéramos por otro
 * criterio, la misma cuenta atendería con una voz y llamaría con otra.
 */
async function resolverAgente(
  ctx: CapabilityContext,
  args: Record<string, unknown>,
): Promise<AgenteVoz> {
  const pedido = typeof args.agente_id === 'string' ? args.agente_id.trim() : ''
  if (pedido) {
    const { data } = await ctx.db
      .from('ai_agents')
      .select('id, name, voice_enabled, voice_calling_hours')
      .eq('id', pedido)
      .eq('workspace_id', ctx.workspaceId)
      .is('deleted_at', null)
      .maybeSingle()
    const fila = data as {
      id: string
      name: string
      voice_enabled: boolean
      voice_calling_hours: VoiceCallingHours | null
    } | null
    if (!fila) throw new Error('Ese agente no existe en esta cuenta.')
    if (!fila.voice_enabled) throw new Error(`«${fila.name}» no tiene la voz activada.`)
    return {
      id: fila.id,
      nombre: fila.name,
      horas: fila.voice_calling_hours || DEFAULT_CALLING_HOURS,
    }
  }

  const elegido = await pickVoiceAgent(ctx.db, ctx.workspaceId)
  if (!elegido) {
    throw new Error(
      'No hay ningún agente con voz activada en esta cuenta: no se puede llamar.',
    )
  }
  return {
    id: elegido.id,
    nombre: elegido.name,
    horas: elegido.voice_calling_hours || DEFAULT_CALLING_HOURS,
  }
}

/** El tipo de llamada decide con qué objetivo habla el agente. */
function tipoDe(args: Record<string, unknown>): VoiceCallType {
  const t = String(args.tipo ?? '')
  return (OUTBOUND_CALL_TYPES as string[]).includes(t) ? (t as VoiceCallType) : 'manual'
}

/** Fecha y hora en el reloj del comercio, para un texto que lee una persona. */
function enHorario(instante: Date, tz: string): string {
  return new Intl.DateTimeFormat('es', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: tz,
  }).format(instante)
}

// ---------------------------------------------------------------------------

interface FilaLlamada extends Partial<VoiceCall> {
  // Alias propios y no `contact`/`agent`: esos nombres ya existen en `VoiceCall`
  // con la fila entera, y acá sólo se trae el nombre.
  contacto?: { name: string | null } | null
  agente?: { name: string | null } | null
}

async function listar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const dias = windowDays(args.dias, 7)
  const limite = Math.min(Number(args.limite) || 50, TOPE_LISTADO)

  const { data, error } = await ctx.db
    .from('voice_calls')
    .select(
      `id, direction, call_type, phone, scheduled_at, summary, attempt, max_attempts, error, ${VOICE_STATS_COLUMNS}, contacto:contacts(name), agente:ai_agents(name)`,
    )
    .eq('workspace_id', ctx.workspaceId)
    .gte('created_at', since(dias))
    .order('created_at', { ascending: false })
    .limit(limite)
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as unknown as FilaLlamada[]
  // El resumen se calcula sólo sobre las SALIENTES, que es lo que mide el panel
  // de voz. Mezclar las entrantes cambiaría la tasa de contestadas — a una
  // llamada entrante siempre le atendió alguien — y la misma cuenta vería dos
  // tasas distintas según a quién le preguntó.
  const salientes = filas.filter((c) => c.direction === 'outbound')
  const s = summarizeVoiceCalls(salientes, await workspaceTimezone(ctx.db, ctx.workspaceId))

  return {
    periodo_dias: dias,
    total: filas.length,
    salientes: {
      llamadas: s.total,
      contestadas: s.answered,
      contestadas_pct: s.answered_pct,
      // Confirmadas o recuperadas, sobre las que contestaron.
      confirmadas: s.confirmed,
      confirmadas_pct: s.confirmed_pct,
      minutos: s.minutes,
      costo_usd: s.cost,
      upsell_usd: s.upsell_revenue,
      por_resultado: s.by_outcome,
    },
    llamadas: filas.map((c) => ({
      id: c.id,
      cuando: c.created_at,
      direccion: c.direction,
      tipo: c.call_type,
      telefono: c.phone,
      contacto: c.contacto?.name ?? null,
      agente: c.agente?.name ?? null,
      estado: c.status,
      resultado: c.outcome,
      contestada: Boolean(c.answered_at),
      duracion_seg: c.duration_seconds,
      resumen: c.summary,
      intento: `${c.attempt ?? 1}/${c.max_attempts ?? 1}`,
      // Sólo dice algo mientras está en cola: después es la fecha en que se
      // pensaba llamar, no la que importa.
      suena: c.status === 'queued' ? c.scheduled_at : null,
      error: c.error,
    })),
  }
}

interface FilaCampana {
  id: string
  name: string
  status: string
  call_type: string
  objective: string | null
  agent_id: string
  segment_id: string | null
  stats: { total?: number; enqueued?: number; done?: boolean } | null
  created_at: string
  updated_at: string
}

async function campanas(ctx: CapabilityContext) {
  const { data, error } = await ctx.db
    .from('voice_campaigns')
    .select(
      'id, name, status, call_type, objective, agent_id, segment_id, stats, created_at, updated_at',
    )
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message)
  const filas = (data ?? []) as FilaCampana[]

  // Los nombres se buscan aparte y no con un embed: el agente y el segmento se
  // repiten entre campañas, así que son dos consultas cortas contra las
  // cuarenta que haría el listado si preguntara de a una.
  const nombres = async (tabla: string, ids: string[]) => {
    const limpios = [...new Set(ids.filter(Boolean))]
    if (limpios.length === 0) return new Map<string, string>()
    const { data: rows } = await ctx.db
      .from(tabla)
      .select('id, name')
      .eq('workspace_id', ctx.workspaceId)
      .in('id', limpios)
    return new Map(
      ((rows ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]),
    )
  }
  const agentes = await nombres(
    'ai_agents',
    filas.map((c) => c.agent_id),
  )
  const segmentos = await nombres(
    'contact_segments',
    filas.map((c) => c.segment_id ?? ''),
  )

  return {
    campanas: filas.map((c) => {
      const publico = c.stats?.total ?? null
      const encoladas = c.stats?.enqueued ?? 0
      return {
        id: c.id,
        nombre: c.name,
        // draft nunca llama: queda esperando a que alguien la ponga en marcha.
        estado: c.status,
        tipo: c.call_type,
        objetivo: c.objective,
        agente: agentes.get(c.agent_id) ?? null,
        segmento: c.segment_id ? (segmentos.get(c.segment_id) ?? null) : null,
        publico,
        encoladas,
        faltan: publico === null ? null : Math.max(0, publico - encoladas),
        creada: c.created_at,
        actualizada: c.updated_at,
      }
    }),
  }
}

async function llamar(ctx: CapabilityContext, args: Record<string, unknown>) {
  const contactoId = typeof args.contacto_id === 'string' ? args.contacto_id.trim() : ''
  if (!contactoId) throw new Error('Falta el contacto al que llamar.')
  const agente = await resolverAgente(ctx, args)
  const objetivo = typeof args.objetivo === 'string' ? args.objetivo.trim() : ''

  const res = await enqueueCall({
    workspaceId: ctx.workspaceId,
    agentId: agente.id,
    contactId: contactoId,
    callType: tipoDe(args),
    phone: typeof args.telefono === 'string' ? args.telefono : null,
    // Sin `immediate`, a diferencia del botón del panel: ahí hay alguien
    // mirando la pantalla en horario de trabajo, y acá la aprobación puede
    // llegar a cualquier hora. La franja del agente es del comercio y una
    // llamada pedida por el chat no la puede saltar.
    context: objetivo ? { objective_override: objetivo } : {},
  })
  if (!res.enqueued) throw new Error(`No se encoló la llamada. ${motivo(res.reason)}`)

  return {
    llamada_id: res.callId,
    agente: agente.nombre,
    suena: res.scheduledAt,
  }
}

// ---------------------------------------------------------------------------

/**
 * UNA LLAMADA, ENTERA.
 *
 * `voz.listar` da la fila del listado. Cuando una salió mal, lo que hace falta
 * es lo otro: el resumen que dejó el agente, con qué contexto se hizo, cuánto
 * duró, cuánto costó, el error si hubo, y la grabación para escucharla.
 */
async function detalleLlamada(ctx: CapabilityContext, args: Record<string, unknown>) {
  const id = String(args.llamada_id ?? '').trim()
  if (!id) throw new Error('Falta el id de la llamada.')

  const { data } = await ctx.db
    .from('voice_calls')
    .select(
      'id, direction, call_type, phone, language, status, outcome, outcome_details, summary, context, scheduled_at, started_at, answered_at, ended_at, duration_seconds, cost, recording_url, error, attempt, max_attempts, city, upsell_amount, conversation_id, contacts(name), ai_agents(name)',
    )
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .maybeSingle()
  if (!data) throw new Error('Esa llamada no existe en esta cuenta.')

  const c = data as unknown as {
    id: string
    direction: string | null
    call_type: string | null
    phone: string | null
    language: string | null
    status: string | null
    outcome: string | null
    outcome_details: unknown
    summary: string | null
    context: unknown
    scheduled_at: string | null
    started_at: string | null
    answered_at: string | null
    ended_at: string | null
    duration_seconds: number | null
    cost: number | null
    recording_url: string | null
    error: string | null
    attempt: number | null
    max_attempts: number | null
    city: string | null
    upsell_amount: number | null
    conversation_id: string | null
    contacts: { name: string | null } | null
    ai_agents: { name: string | null } | null
  }

  return {
    llamada_id: c.id,
    quien: c.contacts?.name ?? c.phone ?? 'sin nombre',
    telefono: c.phone,
    agente: c.ai_agents?.name ?? null,
    sentido: c.direction,
    tipo: c.call_type,
    idioma: c.language,
    estado: c.status,
    // Cómo salió, y el detalle que dejó el agente al colgar.
    resultado: c.outcome,
    detalle_del_resultado: c.outcome_details,
    resumen: c.summary,
    // Con qué datos se hizo la llamada: explica por qué dijo lo que dijo.
    contexto: c.context,
    agendada: c.scheduled_at,
    empezo: c.started_at,
    atendieron: c.answered_at,
    termino: c.ended_at,
    duracion_segundos: c.duration_seconds,
    costo: c.cost,
    // Para escucharla. Es lo único que zanja una discusión sobre qué se dijo.
    grabacion: c.recording_url,
    error: c.error,
    intento: c.attempt,
    intentos_maximos: c.max_attempts,
    ciudad: c.city,
    venta_adicional: c.upsell_amount,
    conversation_id: c.conversation_id,
  }
}


/**
 * Las llamadas, dibujadas.
 *
 * En la lista se busca cuál abrir, así que las columnas son cómo salió y qué
 * dejó dicho el agente. En la ficha de una está lo que zanja la discusión: el
 * resumen, cuánto duró y el enlace a la grabación.
 */
function vistaLlamadas(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    cuando: string
    contacto: string | null
    telefono: string | null
    estado: string | null
    resultado: string | null
    duracion_seg: number | null
    resumen: string | null
  }>(r, 'llamadas')
  return tabla({
    titulo: tt(ctx, 'operation.subVoz'),
    columnas: [
      { clave: 'quien', titulo: tt(ctx, 'operation.vColCliente') },
      { clave: 'cuando', titulo: tt(ctx, 'operation.vColCuando') },
      { clave: 'resultado', titulo: tt(ctx, 'operation.vColResultado') },
      { clave: 'resumen', titulo: tt(ctx, 'operation.vColResumen') },
      { clave: 'duracion', titulo: tt(ctx, 'operation.vColDuracion'), alineado: 'der' },
    ],
    filas: filas.map((c) => ({
      quien: corto(c.contacto ?? c.telefono, 22),
      cuando: fecha(ctx, c.cuando),
      resultado: c.resultado ?? c.estado ?? '—',
      resumen: corto(c.resumen, 46),
      duracion: c.duracion_seg != null ? segundos(c.duracion_seg) : '—',
    })),
    vacio: tt(ctx, 'operation.vSinLlamadas'),
  })
}

function vistaLlamada(
  ctx: CapabilityContext,
  r: Awaited<ReturnType<typeof detalleLlamada>>,
): Artefacto | null {
  if (!tieneCampos(r, 'llamada_id')) return null
  const t = (k: string) => tt(ctx, `operation.${k}`)
  return ficha({
    titulo: String(r.quien),
    subtitulo: [r.agente, r.tipo].filter(Boolean).map(String).join(' · ') || undefined,
    chips: [r.estado, r.resultado].filter(Boolean).map(String),
    campos: [
      { etiqueta: t('vColCuando'), valor: r.empezo ? fecha(ctx, r.empezo) : '' },
      {
        etiqueta: t('vColDuracion'),
        valor: r.duracion_segundos != null ? segundos(r.duracion_segundos) : '',
      },
      { etiqueta: t('vColResumen'), valor: corto(r.resumen, 240) },
      { etiqueta: t('vColMotivo'), valor: corto(r.error, 120) },
      // La grabación es lo único que zanja una discusión sobre qué se dijo.
      { etiqueta: t('vColGrabacion'), valor: r.grabacion ? String(r.grabacion) : '' },
    ],
  })
}

/** Segundos, en la unidad que se lee sin dividir mentalmente. */
function segundos(s: number): string {
  if (s < 60) return `${Math.round(s)} s`
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

/**
 * Las campañas de llamadas, con lo que falta por llamar.
 *
 * `faltan` es la única columna que contesta la pregunta que se hace: ¿ya
 * terminó? El total y las encoladas por separado obligan a restar de memoria.
 */
function vistaCampanasVoz(ctx: CapabilityContext, r: unknown): Artefacto {
  const filas = lista<{
    nombre?: string
    name?: string
    estado?: string
    publico?: number | null
    encoladas?: number
    faltan?: number | null
  }>(r, 'campanas')
  return tabla({
    titulo: tt(ctx, 'operation.vTitCampanasVoz'),
    columnas: [
      { clave: 'nombre', titulo: tt(ctx, 'operation.vColCampana') },
      { clave: 'estado', titulo: tt(ctx, 'operation.vColEstado') },
      { clave: 'llamadas', titulo: tt(ctx, 'operation.vColLlamadas'), alineado: 'der' },
      { clave: 'faltan', titulo: tt(ctx, 'operation.vColFaltan'), alineado: 'der' },
    ],
    filas: filas.map((c) => ({
      nombre: corto(c.nombre ?? c.name, 28),
      estado: c.estado ?? '—',
      llamadas: `${numero(ctx, c.encoladas ?? 0)}/${c.publico != null ? numero(ctx, c.publico) : '—'}`,
      faltan: c.faltan != null ? numero(ctx, c.faltan) : '—',
    })),
    vacio: tt(ctx, 'operation.vSinCampanasVoz'),
  })
}

/**
 * A quién se va a llamar, antes de que suene.
 *
 * Una llamada es irreversible de la peor manera: le suena el teléfono a una
 * persona y no hay forma de deshacerlo. Así que lo que se aprueba tiene que
 * decir a quién, con qué agente y para qué, y decirlo con todas las letras.
 */
function vistaLlamar(ctx: CapabilityContext, args: Record<string, unknown>): Artefacto {
  const t = (k: string) => tt(ctx, `operation.${k}`)
  return cambio({
    titulo: t('vTitLlamar'),
    que: corto(args.objetivo, 120),
    alcance: typeof args.telefono === 'string' ? args.telefono : undefined,
    aviso: t('vLlamarAviso'),
  })
}
export const VOICE_CAPABILITIES: Capability[] = [
  {
    key: 'voz.detalle',
    description:
      'Una llamada entera: cómo salió, el resumen que dejó el agente al colgar, con qué contexto se hizo la llamada, cuánto duró, cuánto costó, el error si lo hubo y el enlace a la grabación. Es lo que hay que mirar cuando una llamada salió mal — la grabación zanja cualquier discusión sobre qué se dijo.',
    descriptionEn:
      'One call in full: how it went, the summary the agent left when hanging up, the context the call was made with, how long it lasted, what it cost, the error if any and the recording link. This is what to look at when a call went wrong — the recording settles any argument about what was said.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        llamada_id: { type: 'string', description: 'El id que devuelve voz.listar.' },
      },
      required: ['llamada_id'],
    },
    run: detalleLlamada,
    vista: (ctx, _args, r) => vistaLlamada(ctx, r as Awaited<ReturnType<typeof detalleLlamada>>),
  },
  {
    key: 'voz.listar',
    description:
      'Las llamadas telefónicas de los últimos días con su resultado: quién atendió, cuánto duró, qué se logró (confirmed, recovered, declined, callback_requested, opt_out…) y el resumen que dejó el agente. Trae además el total de contestadas, confirmadas y minutos de las salientes, con las mismas cuentas que el panel de voz.',
    descriptionEn:
      'The phone calls of the last few days with their result: who picked up, how long it lasted, what was achieved and the summary the agent left. It also returns answered, confirmed and talk minutes for outbound calls, with the same math as the voice dashboard.',
    risk: 'lectura',
    schema: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Ventana hacia atrás. Por defecto 7, máximo 90.' },
        limite: {
          type: 'number',
          description: `Cuántas llamadas devolver. Por defecto 50, máximo ${TOPE_LISTADO}.`,
        },
      },
    },
    run: listar,
    vista: (ctx, _args, r) => vistaLlamadas(ctx, r),
  },

  {
    key: 'voz.campanas',
    description:
      'Las campañas de llamadas y cómo van: a qué segmento apuntan, con qué agente, cuántos contactos quedan por encolar y en qué estado están (draft no llama a nadie hasta que se pone en marcha; running va avanzando de a tandas; done ya terminó).',
    descriptionEn:
      'The voice campaigns and their progress: which segment they target, with which agent, how many contacts are left to enqueue and their status (draft never calls until started; running advances in batches; done is finished).',
    risk: 'lectura',
    schema: { type: 'object', properties: {} },
    run: campanas,
    vista: (ctx, _args, r) => vistaCampanasVoz(ctx, r),
  },

  {
    key: 'voz.llamar',
    description:
      'Encola una llamada telefónica saliente a un contacto. SUENA EL TELÉFONO DE UNA PERSONA REAL y no se puede deshacer. El contacto se identifica por su id (sale de contactos.listar). Sin agente se usa el de voz de mayor prioridad. Respeta la franja horaria del agente: si está fuera de hora, queda agendada para la próxima franja.',
    descriptionEn:
      "Queues an outbound phone call to a contact. A REAL PERSON'S PHONE RINGS and it cannot be undone. The contact is identified by its id. With no agent, the highest-priority voice agent is used. It honors the agent's calling window: outside those hours the call is scheduled for the next one.",
    risk: 'irreversible',
    schema: {
      type: 'object',
      properties: {
        contacto_id: { type: 'string', description: 'Id del contacto al que llamar.' },
        agente_id: {
          type: 'string',
          description: 'Con qué agente. Por defecto, el de voz de mayor prioridad.',
        },
        objetivo: {
          type: 'string',
          description: 'Qué tiene que lograr en esta llamada. Reemplaza al objetivo del agente.',
        },
        telefono: {
          type: 'string',
          description: 'Otro número, si no es el del contacto.',
        },
        tipo: {
          type: 'string',
          enum: [...OUTBOUND_CALL_TYPES],
          description: 'Guion con el que habla. Por defecto manual.',
        },
      },
      required: ['contacto_id'],
    },
    async preview(ctx, args) {
      const contactoId = typeof args.contacto_id === 'string' ? args.contacto_id.trim() : ''
      const { data } = await ctx.db
        .from('contacts')
        .select('name, phone, voice_opt_out')
        .eq('id', contactoId)
        .eq('workspace_id', ctx.workspaceId)
        .maybeSingle()
      const contacto = data as {
        name: string | null
        phone: string | null
        voice_opt_out: boolean | null
      } | null
      if (!contacto) throw new Error('Ese contacto no existe en esta cuenta.')

      const quien = contacto.name?.trim() || 'ese contacto'
      if (contacto.voice_opt_out) {
        throw new Error(`${quien} pidió no recibir llamadas.`)
      }
      const telefono =
        (typeof args.telefono === 'string' ? args.telefono.trim() : '') ||
        contacto.phone?.trim() ||
        ''
      if (!telefono) throw new Error(`${quien} no tiene teléfono cargado.`)

      // Si falta el agente o no tiene voz, decirlo ACÁ evita que alguien
      // apruebe una llamada que después no se va a encolar.
      const agente: AgenteVoz = await resolverAgente(ctx, args)

      const tz = await workspaceTimezone(ctx.db, ctx.workspaceId)
      const cuando = nextAllowedTime(tz, agente.horas)
      // Un minuto de margen: `nextAllowedTime` devuelve el mismo instante que
      // recibió cuando ya estamos dentro de la franja.
      const suenaYa = cuando.getTime() - Date.now() < 60_000
      const objetivo = typeof args.objetivo === 'string' ? args.objetivo.trim() : ''

      return [
        `Llamaría a ${quien} al ${telefono} con el agente «${agente.nombre}».`,
        objetivo ? ` Objetivo: ${objetivo}.` : '',
        suenaYa
          ? ' El teléfono suena en cuanto lo apruebes y la llamada no se puede deshacer.'
          : ` Está fuera de la franja de llamadas del agente (${agente.horas.start}–${agente.horas.end}), así que sonaría el ${enHorario(cuando, tz)}.`,
      ].join('')
    },
    run: llamar,
    artifact: (ctx, args) => vistaLlamar(ctx, args),
  },
]
