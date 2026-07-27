import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessHours } from '@/lib/ai/types';
import {
  withinBusinessHours,
  containsEscalationKeyword,
} from '@/lib/ai/business-hours';

export type ProactiveSendMode = 'auto' | 'hybrid_intent' | 'approval';

export interface IgAgentConfig {
  /** The agent whose brand voice + guardrails govern proactive Instagram. */
  id: string | null;
  /** How much runs automatically vs. waits for human approval. */
  proactive_send_mode: ProactiveSendMode;
  /** Pausado en el editor ⇒ no habla por ningún canal, comentarios incluidos. */
  is_active: boolean;
  /** 'workspace' | 'channels' — junto con `channels` define el alcance. */
  scope: string;
  channels: string[];
  business_hours: BusinessHours | null;
  reply_outside_hours: boolean;
  escalate_keywords: string[];
}

const VALID_MODES: ProactiveSendMode[] = ['auto', 'hybrid_intent', 'approval'];

/** Config vacía: ningún agente gobierna, así que nada se envía solo. */
const NO_AGENT: IgAgentConfig = {
  id: null,
  proactive_send_mode: 'auto',
  is_active: false,
  scope: 'workspace',
  channels: [],
  business_hours: null,
  reply_outside_hours: true,
  escalate_keywords: [],
};

/** Columnas mínimas para poder aplicar el MISMO contrato que el runner. */
const AGENT_BASE =
  'id, proactive_send_mode, is_active, scope, business_hours, reply_outside_hours, escalate_keywords, priority, updated_at';
const AGENT_FIELDS = `${AGENT_BASE}, ai_agent_channels(channel)`;
/** Variante con inner join: obligatoria para poder filtrar por canal. */
const AGENT_FIELDS_IG = `${AGENT_BASE}, ai_agent_channels!inner(channel)`;

interface AgentRow {
  id: string;
  proactive_send_mode?: string | null;
  is_active?: boolean | null;
  scope?: string | null;
  business_hours?: BusinessHours | null;
  reply_outside_hours?: boolean | null;
  escalate_keywords?: string[] | null;
  ai_agent_channels?: Array<{ channel: string }> | null;
}

function normalize(row: AgentRow): IgAgentConfig {
  const mode = row.proactive_send_mode as ProactiveSendMode;
  return {
    id: row.id,
    proactive_send_mode: VALID_MODES.includes(mode) ? mode : 'auto',
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
export function igAgentCanAutoReply(
  agent: IgAgentConfig,
  text: string,
): boolean {
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
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (igOwned) {
    return normalize(igOwned as unknown as AgentRow);
  }

  const { data } = await db
    .from('ai_agents')
    .select(AGENT_FIELDS)
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('is_active', { ascending: false })
    .order('priority', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return NO_AGENT;
  return normalize(data as unknown as AgentRow);
}

