import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { HttpAssistantGrantError } from './http-action-assistant-grants';

export const HTTP_ASSISTANT_CHANNELS = ['whatsapp', 'instagram', 'messenger', 'gmail', 'outlook', 'zoho', 'webchat'] as const;
const uuid = z.string().uuid();
const profile = z.object({ id: uuid, workspace_id: uuid, name: z.string().min(1).max(120),
  is_active: z.boolean(), scope: z.enum(['workspace', 'channels']) }).strict();
export interface HttpAssistantChoice { id: string; name: string; is_active: boolean; channels: string[] }

/** Configuration-only metadata for existing profiles. Never returns prompts, keys, customer data or API destinations. */
export async function httpAssistantGrantChoices(db: SupabaseClient, workspaceId: string): Promise<HttpAssistantChoice[]> {
  try {
    const selected = await db.from('ai_agents').select('id, workspace_id, name, is_active, scope')
      .eq('workspace_id', workspaceId).is('deleted_at', null).order('name', { ascending: true }).limit(101);
    if (selected.error) throw new HttpAssistantGrantError('unavailable');
    if (Array.isArray(selected.data) && selected.data.length > 100) throw new HttpAssistantGrantError('limit');
    const profiles = z.array(profile).max(100).safeParse(selected.data);
    if (!profiles.success || profiles.data.some(row => row.workspace_id !== workspaceId)
      || new Set(profiles.data.map(row => row.id)).size !== profiles.data.length) throw new HttpAssistantGrantError('unavailable');
    if (!profiles.data.length) return [];
    const ids = profiles.data.map(row => row.id);
    const selectedChannels = await db.from('ai_agent_channels').select('agent_id, channel').in('agent_id', ids).limit(1001);
    const assignments = z.array(z.object({ agent_id: uuid, channel: z.string().max(40) }).strict()).max(1000).safeParse(selectedChannels.data);
    if (selectedChannels.error || !assignments.success || assignments.data.some(row => !ids.includes(row.agent_id))) throw new HttpAssistantGrantError('unavailable');
    return profiles.data.map(row => ({ id: row.id, name: row.name, is_active: row.is_active,
      channels: row.scope === 'workspace' ? [...HTTP_ASSISTANT_CHANNELS]
        : HTTP_ASSISTANT_CHANNELS.filter(channel => assignments.data.some(item => item.agent_id === row.id && item.channel === channel)) }));
  } catch (error) { if (error instanceof HttpAssistantGrantError) throw error; throw new HttpAssistantGrantError('unavailable'); }
}
