import type { SupabaseClient } from '@supabase/supabase-js';
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
  const { data } = await db
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'webchat')
    .maybeSingle();
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
  const existing = await getWebchatConnection(workspaceId, db);
  const config: WebchatConfig = { ...webchatConfig(existing), ...patch };
  const status = config.enabled ? 'connected' : 'disconnected';

  if (existing) {
    const { data, error } = await db
      .from('channel_connections')
      .update({ config, status, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as ChannelConnection;
  }

  const { data, error } = await db
    .from('channel_connections')
    .insert({
      workspace_id: workspaceId,
      channel: 'webchat',
      label: 'Chat web',
      config,
      status,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as ChannelConnection;
}
