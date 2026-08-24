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

export const VOICE_CAPABILITIES: Capability[] = [
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
  },
]
