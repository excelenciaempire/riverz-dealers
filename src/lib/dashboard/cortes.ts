/**
 * Quién atendió: por canal y por agente.
 *
 * Inicio contaba el volumen por canal —cuántos mensajes entraron y salieron por
 * cada uno— y nada más. Con eso no se puede contestar la pregunta que importa:
 * **dónde está trabajando la IA y dónde no**. Un comercio con cuatro canales
 * conectados y un agente veía un solo número de «respondió la IA» sin saber si
 * ese número venía de WhatsApp o de Instagram, ni cuál de sus agentes lo hizo.
 *
 * El corte por agente además muestra en cuántas se ABSTUVO. `ai_replies` guarda
 * el motivo desde siempre y es lo que explica un agente que parece apagado: no
 * está apagado, se está absteniendo, y el motivo dice por qué.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BusinessHours } from '@/lib/ai/types'
import {
  escalacionesPorMotivo,
  fueraDeHorario as estaFueraDeHorario,
  primeraRespuesta,
  type Escalacion,
  type Horario,
  type PrimeraRespuesta,
} from './servicio'

export interface CorteCanal {
  canal: string
  conversaciones: number
  resueltas: number
  conIa: number
}

export interface CorteAgente {
  agenteId: string
  nombre: string
  activo: boolean
  respondio: number
  seAbstuvo: number
  fallo: number
  /** El motivo más repetido de abstención, que es el que hay que mirar. */
  motivo: string | null
}

/**
 * Cuánto resolvió la IA sola, en toda la cuenta.
 *
 * Es el número con el que se vende esta categoría —Fin cobra por resolución y
 * Gorgias vende "el 60% al instante"— y Riverz lo tenía sólo para el chat web,
 * calculado dentro de la ruta de estadísticas de ese canal. Acá vale para
 * todos.
 *
 * El denominador son las conversaciones que la IA **atendió**, no todas. Un
 * comercio con la IA encendida en WhatsApp y apagada en el correo no tiene un
 * agente que resuelve poco: tiene un canal donde no lo dejaron entrar, y
 * mezclarlos convierte una decisión suya en un mal número suyo.
 *
 * "Resuelta" es por descarte: la atendió la IA y NO terminó escalada ni
 * asignada a una persona. Es la misma definición que ya usaba el chat web —no
 * se inventa una segunda, que sería la forma más rápida de que dos pantallas
 * muestren dos verdades.
 */
export interface CorteIA {
  /** Conversaciones que la IA contestó al menos una vez. */
  atendidas: number
  /** De ésas, las que nunca necesitaron a una persona. */
  resueltas: number
  /** Porcentaje, y el del período anterior de igual largo. `null` = sin datos. */
  tasa: number | null
  tasaPrevia: number | null
  /** Satisfacción, sobre quienes calificaron. */
  calificaron: number
  satisfaccion: number | null
}

/**
 * Lo que un humano no habría contestado.
 *
 * `atendidas` son las conversaciones que abrió alguien fuera del horario del
 * comercio y que la IA contestó igual. No es una métrica de volumen: es la
 * única que no admite el "y una persona lo hubiera hecho igual", porque a las
 * tres de la mañana no lo hubiera hecho nadie.
 *
 * `sinHorario` marca el caso en que no se puede saber —el agente no tiene
 * horario cargado—, para que la pantalla diga "falta configurarlo" en vez de
 * un cero que parece un resultado.
 */
export interface CorteFueraDeHorario {
  atendidas: number
  /** Total de conversaciones abiertas fuera de hora, con o sin respuesta. */
  total: number
  sinHorario: boolean
}

export interface Cortes {
  canales: CorteCanal[]
  agentes: CorteAgente[]
  ia: CorteIA
  fueraDeHorario: CorteFueraDeHorario
  /** Segundos hasta la primera respuesta, por quién la dio. */
  respuesta: PrimeraRespuesta
  /** Dónde se planta la IA y devuelve el hilo. */
  escalaciones: { total: number; motivos: Escalacion[] }
}

const TOPE = 5000

/**
 * Cuántas muestras hacen falta para que un porcentaje se pueda mostrar.
 * Diez es poco pero corta el caso que rompe la confianza: la cuenta nueva que
 * ve 100% el lunes y 33% el martes.
 */
export const MINIMO_PARA_PORCENTAJE = 10

export async function leerCortes(
  db: SupabaseClient,
  workspaceId: string,
  rango: { desde: Date; hasta: Date },
  /** La zona del workspace: los días y el horario se cortan acá, no en UTC. */
  tz = 'UTC',
): Promise<Cortes> {
  const desde = rango.desde.toISOString()
  const hasta = rango.hasta.toISOString()

  // El período anterior, del mismo largo, para poder decir si mejoró. Un
  // porcentaje solo no dice nada: 61% es bueno o malo según de dónde venía.
  const largo = Math.max(1, rango.hasta.getTime() - rango.desde.getTime())
  const desdePrevio = new Date(rango.desde.getTime() - largo).toISOString()

  const [convRes, iaRes, agentesRes, previoRes, iaPrevioRes, msgRes] = await Promise.all([
    db
      .from('conversations')
      .select(
        'id, channel, status, needs_human_at, needs_human_reason, assigned_agent_id, csat, created_at',
      )
      .eq('workspace_id', workspaceId)
      .gte('last_message_at', desde)
      .lte('last_message_at', hasta)
      .limit(TOPE),
    db
      .from('ai_replies')
      .select('agent_id, conversation_id, status, skip_reason')
      .eq('workspace_id', workspaceId)
      .gte('created_at', desde)
      .lte('created_at', hasta)
      .limit(TOPE),
    db
      .from('ai_agents')
      .select('id, name, is_active, business_hours')
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null),
    db
      .from('conversations')
      .select('id, needs_human_at, assigned_agent_id')
      .eq('workspace_id', workspaceId)
      .gte('last_message_at', desdePrevio)
      .lt('last_message_at', desde)
      .limit(TOPE),
    db
      .from('ai_replies')
      .select('conversation_id')
      .eq('workspace_id', workspaceId)
      .eq('status', 'sent')
      .gte('created_at', desdePrevio)
      .lt('created_at', desde)
      .limit(TOPE),
    // Los mensajes del rango, para medir quién contestó primero.
    //
    // `messages` no tiene `workspace_id` —cuelga de la conversación (migración
    // 013)—, así que el corte va por el join. Y sólo las tres columnas que
    // hacen falta: el cuerpo no se usa y en una cuenta con movimiento son
    // megabytes al pedo.
    db
      .from('messages')
      // `origin` es lo que separa al asistente de una automatización: sin él,
      // `primeraRespuesta` mete a las dos en la misma bolsa.
      .select('conversation_id, sender_type, created_at, origin, conversations!inner(workspace_id)')
      .eq('conversations.workspace_id', workspaceId)
      .gte('created_at', desde)
      .lte('created_at', hasta)
      .order('created_at', { ascending: true })
      .limit(20000),
  ])

  const convs = (convRes.data ?? []) as {
    id: string
    channel: string | null
    status: string | null
    needs_human_at: string | null
    needs_human_reason: string | null
    assigned_agent_id: string | null
    csat: number | null
    created_at: string | null
  }[]
  const ias = (iaRes.data ?? []) as {
    agent_id: string | null
    conversation_id: string | null
    status: string | null
    skip_reason: string | null
  }[]
  const agentes = (agentesRes.data ?? []) as {
    id: string
    name: string | null
    is_active: boolean
    business_hours: BusinessHours | null
  }[]

  // Qué conversaciones tocó la IA, para cruzarlas con su canal.
  const conIa = new Set(
    ias.filter((r) => r.status === 'sent' && r.conversation_id).map((r) => r.conversation_id!),
  )
  const canalDe = new Map(convs.map((c) => [c.id, c.channel ?? 'desconocido']))

  const porCanal = new Map<string, CorteCanal>()
  for (const c of convs) {
    const canal = c.channel ?? 'desconocido'
    const a = porCanal.get(canal) ?? { canal, conversaciones: 0, resueltas: 0, conIa: 0 }
    a.conversaciones += 1
    if (c.status === 'resolved' || c.status === 'closed') a.resueltas += 1
    if (conIa.has(c.id)) a.conIa += 1
    porCanal.set(canal, a)
  }
  // Un canal cuya conversación quedó fuera del tope igual aportó respuestas:
  // se cuenta lo que se sabe y no se inventa lo que no.
  void canalDe

  const nombres = new Map(agentes.map((a) => [a.id, a]))
  const porAgente = new Map<string, CorteAgente & { motivos: Map<string, number> }>()
  for (const r of ias) {
    const id = r.agent_id ?? 'sin-agente'
    const meta = nombres.get(id)
    const a =
      porAgente.get(id) ??
      {
        agenteId: id,
        nombre: meta?.name ?? 'Asistente',
        activo: meta?.is_active ?? false,
        respondio: 0,
        seAbstuvo: 0,
        fallo: 0,
        motivo: null,
        motivos: new Map<string, number>(),
      }
    if (r.status === 'sent') a.respondio += 1
    else if (r.status === 'failed') a.fallo += 1
    else {
      a.seAbstuvo += 1
      if (r.skip_reason) a.motivos.set(r.skip_reason, (a.motivos.get(r.skip_reason) ?? 0) + 1)
    }
    porAgente.set(id, a)
  }

  // ── Cuánto resolvió sola ──
  const atendidas = convs.filter((c) => conIa.has(c.id))
  const necesitoPersona = (c: { needs_human_at: string | null; assigned_agent_id: string | null }) =>
    Boolean(c.needs_human_at) || Boolean(c.assigned_agent_id)
  const resueltas = atendidas.filter((c) => !necesitoPersona(c)).length

  const conIaPrevia = new Set(
    ((iaPrevioRes.data ?? []) as { conversation_id: string | null }[])
      .filter((r) => r.conversation_id)
      .map((r) => r.conversation_id!),
  )
  const atendidasPrevias = (
    (previoRes.data ?? []) as {
      id: string
      needs_human_at: string | null
      assigned_agent_id: string | null
    }[]
  ).filter((c) => conIaPrevia.has(c.id))
  const resueltasPrevias = atendidasPrevias.filter((c) => !necesitoPersona(c)).length

  // Un porcentaje necesita material para significar algo.
  //
  // Con tres conversaciones atendidas, «resolvió el 100%» es cierto y no dice
  // nada: al día siguiente marca 33% y el comercio deja de creerle a la
  // pantalla. Debajo del umbral se devuelve `null` y cada tarjeta muestra los
  // números enteros, que no mienten en ninguna escala. Va acá y no en la
  // interfaz para que TODAS las pantallas usen el mismo criterio — dos
  // umbrales distintos serían dos verdades sobre la misma cuenta.
  const tasa = (total: number, ok: number) =>
    total >= MINIMO_PARA_PORCENTAJE ? Math.round((ok / total) * 100) : null

  // Satisfacción sobre quienes CALIFICARON, no sobre el total: dividir por
  // todas convertiría "poca gente votó" en "a poca gente le sirvió", que son
  // dos problemas distintos y se arreglan de forma distinta.
  const calificaron = convs.filter((c) => c.csat === 1 || c.csat === -1)
  const conformes = calificaron.filter((c) => c.csat === 1).length

  // ── Lo que un humano no habría contestado ──
  //
  // El horario sale del agente que lo tenga cargado. Con varios agentes se usa
  // el primero que tenga uno: son el horario del comercio, no de cada agente, y
  // en la práctica el comercio carga uno solo. Sin ninguno no se calcula nada y
  // la pantalla pide configurarlo — un cero acá parecería un resultado.
  // El horario sale de `business_hours`, que es donde lo escribe el editor del
  // asistente y donde lo lee el motor para decidir si contesta. Antes se leían
  // las columnas sueltas `business_hours_start/end/days`, que NO las escribe
  // nadie: siempre venían en null, así que esta pantalla pedía configurar un
  // horario que el comercio ya tenía configurado.
  const horario: Horario | null = agentes
    .map((a) => horarioDeLasVentanas(a.business_hours, tz))
    .find((h): h is Horario => h !== null) ?? null

  let fueraTotal = 0
  let fueraAtendidas = 0
  if (horario) {
    for (const c of convs) {
      // Cuándo ESCRIBIÓ la persona, no cuándo se movió el hilo por última vez.
      const cuando = c.created_at
      if (!cuando) continue
      if (estaFueraDeHorario(cuando, horario) !== true) continue
      fueraTotal += 1
      if (conIa.has(c.id)) fueraAtendidas += 1
    }
  }

  const mensajes = (msgRes.data ?? []) as {
    conversation_id: string | null
    sender_type: string | null
    created_at: string
  }[]

  return {
    ia: {
      atendidas: atendidas.length,
      resueltas,
      tasa: tasa(atendidas.length, resueltas),
      tasaPrevia: tasa(atendidasPrevias.length, resueltasPrevias),
      calificaron: calificaron.length,
      satisfaccion: tasa(calificaron.length, conformes),
    },
    fueraDeHorario: {
      atendidas: fueraAtendidas,
      total: fueraTotal,
      sinHorario: !horario,
    },
    respuesta: primeraRespuesta(mensajes),
    escalaciones: {
      total: convs.filter((c) => c.needs_human_at).length,
      motivos: escalacionesPorMotivo(convs),
    },
    canales: [...porCanal.values()].sort((a, b) => b.conversaciones - a.conversaciones),
    agentes: [...porAgente.values()]
      .map(({ motivos, ...a }) => ({
        ...a,
        motivo: [...motivos.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      }))
      .sort((a, b) => b.respondio - a.respondio),
  }
}

/**
 * El horario semanal del asistente, traducido a la forma que espera el panel.
 *
 * El asistente lo guarda como ventanas por día ("1": ["09:00-18:00"]) porque
 * puede tener varias por día; el panel trabaja con un inicio, un fin y los días
 * en que abre. Se toma la primera ventana de cada día: para "de 9 a 18 de lunes
 * a viernes" —que es lo que carga casi todo el mundo— dice exactamente eso.
 */
function horarioDeLasVentanas(
  bh: BusinessHours | null,
  tz: string,
): Horario | null {
  const ventanas = (bh?.windows ?? null) as Record<string, string[]> | null
  if (!ventanas) return null
  const dias: number[] = []
  let inicio: string | null = null
  let fin: string | null = null
  for (const [dia, lista] of Object.entries(ventanas)) {
    const primera = (lista ?? [])[0]
    if (!primera) continue
    const [desde, hasta] = primera.split('-')
    if (!desde || !hasta) continue
    dias.push(Number(dia))
    if (!inicio) {
      inicio = desde
      fin = hasta
    }
  }
  if (dias.length === 0 || !inicio || !fin) return null
  return { inicio, fin, dias, tz: bh?.timezone || tz }
}
