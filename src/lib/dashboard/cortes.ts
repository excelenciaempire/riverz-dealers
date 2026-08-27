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

export interface Cortes {
  canales: CorteCanal[]
  agentes: CorteAgente[]
  ia: CorteIA
}

const TOPE = 5000

export async function leerCortes(
  db: SupabaseClient,
  workspaceId: string,
  rango: { desde: Date; hasta: Date },
): Promise<Cortes> {
  const desde = rango.desde.toISOString()
  const hasta = rango.hasta.toISOString()

  // El período anterior, del mismo largo, para poder decir si mejoró. Un
  // porcentaje solo no dice nada: 61% es bueno o malo según de dónde venía.
  const largo = Math.max(1, rango.hasta.getTime() - rango.desde.getTime())
  const desdePrevio = new Date(rango.desde.getTime() - largo).toISOString()

  const [convRes, iaRes, agentesRes, previoRes, iaPrevioRes] = await Promise.all([
    db
      .from('conversations')
      .select('id, channel, status, needs_human_at, assigned_agent_id, csat')
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
      .select('id, name, is_active')
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
  ])

  const convs = (convRes.data ?? []) as {
    id: string
    channel: string | null
    status: string | null
    needs_human_at: string | null
    assigned_agent_id: string | null
    csat: number | null
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

  const tasa = (total: number, ok: number) => (total > 0 ? Math.round((ok / total) * 100) : null)

  // Satisfacción sobre quienes CALIFICARON, no sobre el total: dividir por
  // todas convertiría "poca gente votó" en "a poca gente le sirvió", que son
  // dos problemas distintos y se arreglan de forma distinta.
  const calificaron = convs.filter((c) => c.csat === 1 || c.csat === -1)
  const conformes = calificaron.filter((c) => c.csat === 1).length

  return {
    ia: {
      atendidas: atendidas.length,
      resueltas,
      tasa: tasa(atendidas.length, resueltas),
      tasaPrevia: tasa(atendidasPrevias.length, resueltasPrevias),
      calificaron: calificaron.length,
      satisfaccion: tasa(calificaron.length, conformes),
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
