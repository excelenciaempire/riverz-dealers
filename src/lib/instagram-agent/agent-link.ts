import type { SupabaseClient } from '@supabase/supabase-js';

export type ProactiveSendMode = 'auto' | 'hybrid_intent' | 'approval';

export interface IgAgentConfig {
  /** The agent whose brand voice + guardrails govern proactive Instagram. */
  id: string | null;
  /** How much runs automatically vs. waits for human approval. */
  proactive_send_mode: ProactiveSendMode;
}

const VALID_MODES: ProactiveSendMode[] = ['auto', 'hybrid_intent', 'approval'];

function normalize(row: {
  id: string;
  proactive_send_mode?: string | null;
}): IgAgentConfig {
  const mode = row.proactive_send_mode as ProactiveSendMode;
  return {
    id: row.id,
    proactive_send_mode: VALID_MODES.includes(mode) ? mode : 'auto',
  };
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
  if (linkedAgentId) {
    const { data } = await db
      .from('ai_agents')
      .select('id, proactive_send_mode')
      .eq('id', linkedAgentId)
      .maybeSingle();
    if (data) return normalize(data as { id: string; proactive_send_mode?: string | null });
  }
  // Preferir el agente que ATIENDE Instagram: es su voz la que el cliente ya
  // conoce. Sin esa preferencia, un agente suelto de otro producto creado más
  // tarde en el mismo workspace secuestraba la voz de los DMs proactivos.
  const { data: igOwned } = await db
    .from('ai_agents')
    .select('id, proactive_send_mode, is_active, updated_at, ai_agent_channels!inner(channel)')
    .eq('workspace_id', workspaceId)
    .eq('ai_agent_channels.channel', 'instagram')
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (igOwned) {
    return normalize(igOwned as { id: string; proactive_send_mode?: string | null });
  }

  const { data } = await db
    .from('ai_agents')
    .select('id, proactive_send_mode, is_active, updated_at')
    .eq('workspace_id', workspaceId)
    .order('is_active', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return { id: null, proactive_send_mode: 'auto' };
  return normalize(data as { id: string; proactive_send_mode?: string | null });
}

/** Does this lead need human approval before a proactive DM, given the mode? */
export function needsApproval(
  mode: ProactiveSendMode,
  leadScore: 'high' | 'medium' | 'low' | null,
): boolean {
  if (mode === 'auto') return false;
  if (mode === 'approval') return true;
  // hybrid_intent: auto only for clearly high-intent leads.
  return leadScore !== 'high';
}
