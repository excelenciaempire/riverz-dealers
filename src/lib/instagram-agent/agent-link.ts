import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessHours } from '@/lib/ai/types';
import {
  withinBusinessHours,
  containsEscalationKeyword,
} from '@/lib/ai/business-hours';

// `proactive_send_mode` (auto | hybrid_intent | approval) SE ELIMINÓ: el
// alcance proactivo es siempre automático, no hay nada que aprobar. Se
// guardaba pero ninguna rama lo leía, así que "approval" enviaba igual.
// Quién habla lo deciden las puertas reales: spam/intención, el contrato
// del agente (`igAgentCanAutoReply`) y el límite diario del workspace.

export interface IgAgentConfig {
  /** The agent whose brand voice + guardrails govern proactive Instagram. */
  id: string | null;
  /** Pausado en el editor ⇒ no habla por ningún canal, comentarios incluidos. */
  is_active: boolean;
  /** 'workspace' | 'channels' — junto con `channels` define el alcance. */
  scope: string;
  channels: string[];
  /**
   * SUPER AGENTE (migración 131). Encendido, este agente escribe también el
   * PRIMER mensaje de una respuesta a un comentario, con todas sus
   * herramientas, en vez del redactor sin herramientas de siempre.
   *
   * Viaja en la misma fila que ya cargamos, así que apagado no cuesta ninguna
   * consulta extra.
   */
  is_super: boolean;
  business_hours: BusinessHours | null;
  reply_outside_hours: boolean;
  escalate_keywords: string[];
}

/**
 * Por dónde vamos a hablar. NO es "qué agente elegir": es qué vinculación de
 * canal cuenta como válida para esta interacción.
 *
 * Separar las superficies no obliga a clonar al agente. Un comercio puede
 * querer una voz distinta para los comentarios —que los lee cualquiera— que
 * para el privado, y el editor ya deja marcarlo; pero por defecto es el mismo
 * agente en los dos sitios, porque es la misma marca contestando.
 */
export type IgSurface = 'comment' | 'dm';

/** Canales que sirven para cada superficie, en orden de preferencia. */
const SURFACE_CHANNELS: Record<IgSurface, string[]> = {
  comment: ['ig_comment', 'instagram'],
  dm: ['instagram'],
};

/** Config vacía: ningún agente gobierna, así que nada se envía solo. */
const NO_AGENT: IgAgentConfig = {
  id: null,
  is_active: false,
  scope: 'workspace',
  channels: [],
  is_super: false,
  business_hours: null,
  reply_outside_hours: true,
  escalate_keywords: [],
};

/** Columnas mínimas para poder aplicar el MISMO contrato que el runner. */
const AGENT_BASE =
  'id, is_active, scope, is_super, business_hours, reply_outside_hours, escalate_keywords, priority, created_at';
const AGENT_FIELDS = `${AGENT_BASE}, ai_agent_channels(channel)`;
/** Variante con inner join: obligatoria para poder filtrar por canal. */
const AGENT_FIELDS_IG = `${AGENT_BASE}, ai_agent_channels!inner(channel)`;

interface AgentRow {
  id: string;
  is_active?: boolean | null;
  scope?: string | null;
  is_super?: boolean | null;
  business_hours?: BusinessHours | null;
  reply_outside_hours?: boolean | null;
  escalate_keywords?: string[] | null;
  ai_agent_channels?: Array<{ channel: string }> | null;
}

function normalize(row: AgentRow): IgAgentConfig {
  return {
    id: row.id,
    is_active: Boolean(row.is_active),
    scope: row.scope ?? 'workspace',
    channels: (row.ai_agent_channels ?? []).map((c) => c.channel),
    is_super: Boolean(row.is_super),
    business_hours: row.business_hours ?? null,
    reply_outside_hours: row.reply_outside_hours ?? true,
    escalate_keywords: row.escalate_keywords ?? [],
  };
}

/**
 * ¿Puede este agente responder SOLO un comentario/DM proactivo ahora mismo?
 *
 * Los comentarios no pasaban por ninguna de las reglas del editor: un agente
 * pausado seguía gobernando la voz, un negocio con horario 9-18 mandaba DMs
 * de madrugada, un agente acotado a "Solo WhatsApp" contestaba Instagram, y
 * un comentario que pedía un humano recibía un DM de venta. Este gate aplica
 * el mismo contrato que `shouldSkip` del runner.
 *
 * `text` es lo que escribió la persona (comentario o DM), para las palabras
 * de escalamiento.
 */
export function igAgentCanAutoReply(
  agent: IgAgentConfig,
  text: string,
  surface: IgSurface = 'dm',
): boolean {
  if (!agent.id || !agent.is_active) return false;
  // Alcance: 'workspace' cubre todo; 'channels' debe incluir el canal por el
  // que vamos a hablar. Antes exigía SIEMPRE 'instagram', así que un agente
  // creado para comentarios —una opción que el editor ya ofrece— se rechazaba
  // a sí mismo y contestaba el de DMs en su lugar.
  if (
    agent.scope === 'channels' &&
    !SURFACE_CHANNELS[surface].some((c) => agent.channels.includes(c))
  ) {
    return false;
  }
  if (!agent.reply_outside_hours && !withinBusinessHours(agent.business_hours)) {
    return false;
  }
  if (containsEscalationKeyword(agent.escalate_keywords, text)) return false;
  return true;
}

/**
 * Resolve which AI agent's identity governs proactive Instagram for a
 * workspace — the same brain that answers reactively, so there's ONE identity,
 * not a second "agent". Prefers the explicitly linked agent; otherwise the
 * freshest active agent (matching how `loadBrandContext` already picks the
 * brand voice). Returns its id + automation mode, defaulting to 'auto' with no
 * agent so behaviour is unchanged for workspaces that never configured one.
 */
export async function resolveIgAgent(
  db: SupabaseClient,
  workspaceId: string,
  linkedAgentId?: string | null,
  surface: IgSurface = 'dm',
): Promise<IgAgentConfig> {
  // Los agentes BORRADOS no gobiernan nada: su voz y su conocimiento ya no
  // representan a la marca. Sin este filtro, un agente eliminado de otro
  // producto seguía escribiendo los DMs proactivos.
  if (linkedAgentId) {
    const { data } = await db
      .from('ai_agents')
      .select(AGENT_FIELDS)
      .eq('id', linkedAgentId)
      .is('deleted_at', null)
      .maybeSingle();
    if (data) return normalize(data as unknown as AgentRow);
  }
  // Preferir el agente que ATIENDE Instagram: es su voz la que el cliente ya
  // conoce. Sin esa preferencia, un agente suelto de otro producto creado más
  // tarde en el mismo workspace secuestraba la voz de los DMs proactivos.
  // `priority` primero para empatar con `pickAgent` del runner — antes esto
  // ordenaba sólo por updated_at, así que editar otro agente podía cambiar
  // quién habla en Instagram sin tocar nada de Instagram.
  // Se prueban los canales de la superficie EN ORDEN: para un comentario, el
  // agente atado a 'ig_comment' manda sobre el de 'instagram'. Antes esto
  // preguntaba siempre por 'instagram', así que un agente creado para
  // comentarios existía en la pantalla y no gobernaba nada.
  for (const channel of SURFACE_CHANNELS[surface]) {
    const { data: owned } = await db
      .from('ai_agents')
      .select(AGENT_FIELDS_IG)
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .eq('ai_agent_channels.channel', channel)
      .order('is_active', { ascending: false })
      .order('priority', { ascending: false })
      // Mismo desempate estable que `pickAgent`: por antigüedad, para que
      // editar un agente no cambie quién habla en Instagram.
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (owned) return normalize(owned as unknown as AgentRow);
  }

  const { data } = await db
    .from('ai_agents')
    .select(AGENT_FIELDS)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('is_active', { ascending: false })
    .order('priority', { ascending: false })
    // Mismo desempate estable que `pickAgent`: por antigüedad, para que
    // editar un agente no cambie quién habla en Instagram.
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return NO_AGENT;
  return normalize(data as unknown as AgentRow);
}

