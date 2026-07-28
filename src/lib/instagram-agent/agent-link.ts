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
  business_hours: BusinessHours | null;
  reply_outside_hours: boolean;
  escalate_keywords: string[];
}

/** Config vacía: no hay agente. Los comentarios se contestan igual, con la
 *  marca y el catálogo; lo que se pierde son las herramientas. */
const NO_AGENT: IgAgentConfig = {
  id: null,
  is_active: false,
  scope: 'workspace',
  channels: [],
  business_hours: null,
  reply_outside_hours: true,
  escalate_keywords: [],
};

/** Columnas mínimas para poder aplicar el MISMO contrato que el runner. */
const AGENT_BASE =
  'id, is_active, scope, business_hours, reply_outside_hours, escalate_keywords, priority, created_at';
const AGENT_FIELDS = `${AGENT_BASE}, ai_agent_channels(channel)`;
/** Variante con inner join: obligatoria para poder filtrar por canal. */
const AGENT_FIELDS_IG = `${AGENT_BASE}, ai_agent_channels!inner(channel)`;

interface AgentRow {
  id: string;
  is_active?: boolean | null;
  scope?: string | null;
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
export function igAgentCanAutoReply(agent: IgAgentConfig, text: string): boolean {
  if (!agent.id || !agent.is_active) return false;
  // Alcance: 'workspace' cubre todo; 'channels' debe incluir Instagram.
  if (agent.scope === 'channels' && !agent.channels.includes('instagram')) {
    return false;
  }
  if (!agent.reply_outside_hours && !withinBusinessHours(agent.business_hours)) {
    return false;
  }
  if (containsEscalationKeyword(agent.escalate_keywords, text)) return false;
  return true;
}

/**
 * Puerta de COMENTARIOS. Deliberadamente distinta de la de arriba.
 *
 * Asistentes IA gobierna las conversaciones por DM; Comentarios se gobierna
 * solo, con su propio interruptor. Así que aquí NO se pregunta si el agente
 * está activo ni qué canales tiene marcados: un agente acotado a "solo
 * WhatsApp", o pausado, dejaba mudos los comentarios sin que nada en la
 * pantalla de Comentarios lo explicara. Del agente se toma la VOZ, nunca el
 * permiso.
 *
 * Lo único que sí se respeta es que la persona pida un humano: eso no es
 * configuración de canal, es no venderle a quien está pidiendo ayuda.
 */
export function commentAgentCanReply(
  agent: IgAgentConfig,
  text: string,
): boolean {
  return !containsEscalationKeyword(agent.escalate_keywords, text);
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
  const { data: igOwned } = await db
    .from('ai_agents')
    .select(AGENT_FIELDS_IG)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .eq('ai_agent_channels.channel', 'instagram')
    .order('is_active', { ascending: false })
    .order('priority', { ascending: false })
    // Mismo desempate estable que `pickAgent`: por antigüedad, para que
    // editar un agente no cambie quién habla en Instagram.
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (igOwned) return normalize(igOwned as unknown as AgentRow);

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

