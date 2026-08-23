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

export interface Cortes {
  canales: CorteCanal[]
  agentes: CorteAgente[]
}

const TOPE = 5000

export async function leerCortes(
  db: SupabaseClient,
  workspaceId: string,
  rango: { desde: Date; hasta: Date },
): Promise<Cortes> {
  const desde = rango.desde.toISOString()
  const hasta = rango.hasta.toISOString()

  const [convRes, iaRes, agentesRes] = await Promise.all([
    db
      .from('conversations')
      .select('id, channel, status')
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
  ])

  const convs = (convRes.data ?? []) as {
    id: string
    channel: string | null
    status: string | null
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

  return {
    canales: [...porCanal.values()].sort((a, b) => b.conversaciones - a.conversaciones),
    agentes: [...porAgente.values()]
      .map(({ motivos, ...a }) => ({
        ...a,
        motivo: [...motivos.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
      }))
      .sort((a, b) => b.respondio - a.respondio),
  }
}
