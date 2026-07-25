/**
 * Shared helpers for the per-workspace voice channel_connections row + role
 * checks. Used by the number-provisioning and regulatory routes so config
 * read/write and admin gating stay consistent (and merges never clobber).
 */
import type { VoiceConnectionConfig } from '@/types';
import { supabaseAdmin } from '@/lib/channels/admin-client';

export async function isVoiceMember(userId: string, workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

/** Buying/releasing a number + submitting regulatory docs are paid/sensitive →
 *  admins only, matching every other channel-connect action in the app. */
export async function isVoiceAdmin(userId: string, workspaceId: string): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();
  return Boolean(data);
}

export async function readVoiceConfig(
  workspaceId: string,
): Promise<{ id: string | null; config: VoiceConnectionConfig }> {
  // limit(1) (not maybeSingle): if a race ever produced two voice rows, don't
  // throw — take the earliest deterministically.
  const { data } = await supabaseAdmin()
    .from('channel_connections')
    .select('id, config')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'voice')
    .order('created_at', { ascending: true })
    .limit(1);
  const row = (data as { id?: string; config?: VoiceConnectionConfig }[] | null)?.[0] ?? null;
  return { id: row?.id ?? null, config: row?.config ?? {} };
}

export async function writeVoiceConfig(
  workspaceId: string,
  id: string | null,
  config: VoiceConnectionConfig,
  status: string,
): Promise<void> {
  if (id) {
    await supabaseAdmin()
      .from('channel_connections')
      .update({ config, status, updated_at: new Date().toISOString() })
      .eq('id', id);
  } else {
    await supabaseAdmin()
      .from('channel_connections')
      .insert({ workspace_id: workspaceId, channel: 'voice', label: 'Voz', config, status });
  }
}
