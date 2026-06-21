import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Un solo chatbot ACTIVO por canal.
 *
 * El runner ya enruta un único agente por canal (mayor prioridad), pero nada
 * impedía tener dos agentes activos pisándose el mismo canal — confuso e
 * impredecible para el merchant. Este helper detecta ese choque al guardar un
 * agente activo y deja que la ruta lo bloquee con un mensaje claro (en vez de
 * desactivar a otro en silencio). El merchant resuelve pausando uno o
 * acotando los canales.
 */

// Canales sobre los que el asistente de IA puede responder (DM + email). Un
// agente de scope 'workspace' ocupa TODOS estos; uno de scope 'channels' solo
// los suyos.
export const AI_CHANNELS = [
  'whatsapp',
  'instagram',
  'messenger',
  'gmail',
  'outlook',
] as const;

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger',
  gmail: 'Gmail',
  outlook: 'Outlook',
};

export function channelLabels(channels: string[]): string {
  return channels.map((c) => CHANNEL_LABELS[c] ?? c).join(', ');
}

function effectiveChannels(scope: string, channels: string[]): string[] {
  if (scope === 'workspace') return [...AI_CHANNELS];
  const allowed = AI_CHANNELS as readonly string[];
  return channels.filter((c) => allowed.includes(c));
}

export interface ChannelConflict {
  agentName: string;
  channels: string[];
}

/**
 * ¿El agente que se está guardando (activo) choca con otro agente activo del
 * workspace en algún canal? Devuelve el primer conflicto, o null si no hay.
 * `agentId` es el id del que se guarda (se excluye de la búsqueda); null al crear.
 */
export async function findChannelConflict(
  admin: SupabaseClient,
  args: {
    workspaceId: string;
    agentId: string | null;
    scope: string;
    channels: string[];
  },
): Promise<ChannelConflict | null> {
  const mine = new Set(effectiveChannels(args.scope, args.channels));
  if (mine.size === 0) return null;

  let query = admin
    .from('ai_agents')
    .select('id, name, scope, ai_agent_channels(channel)')
    .eq('workspace_id', args.workspaceId)
    .eq('is_active', true)
    .is('deleted_at', null);
  if (args.agentId) query = query.neq('id', args.agentId);
  const { data } = await query;

  for (const a of (data ?? []) as Array<{
    name: string | null;
    scope: string;
    ai_agent_channels?: { channel: string }[];
  }>) {
    const theirs = effectiveChannels(
      a.scope,
      (a.ai_agent_channels ?? []).map((c) => c.channel),
    );
    const overlap = theirs.filter((c) => mine.has(c));
    if (overlap.length > 0) {
      return { agentName: a.name ?? 'Asistente', channels: overlap };
    }
  }
  return null;
}
