import type { SupabaseClient } from '@supabase/supabase-js';
import { withinBusinessHours } from '@/lib/ai/business-hours';
import type { BusinessHours } from '@/lib/ai/types';
import type { ChannelConnection, WebchatConfig } from '@/types';
import { supabaseAdmin } from '@/lib/channels/admin-client';

/**
 * La fila `channel_connections` del chat web: una por comercio (índice único
 * parcial, migración 171). Guarda la configuración y nada más — la llave
 * pública se deriva del workspace, así que no hay secreto que almacenar.
 */

export async function getWebchatConnection(
  workspaceId: string,
  db: SupabaseClient = supabaseAdmin(),
): Promise<ChannelConnection | null> {
  const { data, error } = await db
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'webchat')
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelConnection | null) ?? null;
}

export function webchatConfig(connection: ChannelConnection | null): WebchatConfig {
  return (connection?.config ?? {}) as WebchatConfig;
}

/**
 * Guarda la configuración fusionándola con la que había.
 *
 * Fusiona en vez de reemplazar porque las pantallas guardan de a pedazos —la
 * de apariencia no sabe de dominios— y un `update` con el objeto entero borra
 * lo que la otra acababa de escribir.
 */
export async function upsertWebchatConnection(
  workspaceId: string,
  patch: WebchatConfig,
  db: SupabaseClient = supabaseAdmin(),
): Promise<ChannelConnection> {
  const { data, error } = await db.rpc('update_webchat_settings', {
    p_workspace_id: workspaceId,
    p_patch: patch,
  }).single();
  if (error) throw error;
  return data as ChannelConnection;
}

/**
 * El agente que atiende el chat: su idioma y si está en horario.
 *
 * El idioma del MARCO del chat sale de acá y no del panel del comercio: quien
 * lee "¿te sirvió?" o "Reanudar" es el cliente, y el comercio ya eligió en qué
 * idioma le habla su agente.
 */
export async function agenteDelChat(
  workspaceId: string,
  agentId?: string | null,
): Promise<{ locale: string | null; offline: boolean }> {
  const admin = supabaseAdmin();
  let q = admin
    .from('ai_agents')
    .select('language, business_hours, reply_outside_hours')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1);
  if (agentId) q = q.eq('id', agentId);

  const { data } = await q.maybeSingle();
  const a = data as {
    language?: string | null;
    business_hours?: BusinessHours | null;
    reply_outside_hours?: boolean | null;
  } | null;
  if (!a) return { locale: null, offline: false };

  // Fuera de horario sólo cuenta si el agente NO contesta fuera de horario:
  // si contesta igual, avisar que está cerrado sería mentirle al visitante.
  const offline =
    a.reply_outside_hours === false && !withinBusinessHours(a.business_hours ?? null);
  return { locale: a.language ?? null, offline };
}
