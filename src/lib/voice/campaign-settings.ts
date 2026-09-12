import type { SupabaseClient } from '@supabase/supabase-js';
import type { VoiceCallType } from '@/types';
import { OUTBOUND_CALL_TYPES } from './constants';

export class VoiceCampaignInputError extends Error {}

export async function createVoiceCampaign(db: SupabaseClient, workspaceId: string, input: Record<string, unknown>) {
  if (typeof input.agent_id !== 'string' || typeof input.segment_id !== 'string' || typeof input.name !== 'string' || !input.name.trim()
    || input.name.length > 200 || (input.objective != null && (typeof input.objective !== 'string' || input.objective.length > 4000))
    || (input.start !== undefined && typeof input.start !== 'boolean')
    || !OUTBOUND_CALL_TYPES.includes((input.call_type ?? 'manual') as VoiceCallType)) throw new VoiceCampaignInputError('invalid_campaign');
  const [agent, segment] = await Promise.all([
    db.from('ai_agents').select('id').eq('id', input.agent_id).eq('workspace_id', workspaceId).is('deleted_at', null).maybeSingle(),
    db.from('contact_segments').select('id').eq('id', input.segment_id).eq('workspace_id', workspaceId).maybeSingle(),
  ]);
  if (agent.error) throw agent.error;
  if (segment.error) throw segment.error;
  if (!agent.data || !segment.data) throw new VoiceCampaignInputError('invalid_campaign_resources');
  const { data, error } = await db.from('voice_campaigns').insert({
    workspace_id: workspaceId, agent_id: input.agent_id, segment_id: input.segment_id,
    name: input.name.trim(), objective: typeof input.objective === 'string' ? input.objective.trim() || null : null,
    call_type: input.call_type ?? 'manual', status: input.start === true ? 'running' : 'draft',
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function changeVoiceCampaignStatus(db: SupabaseClient, workspaceId: string, id: unknown, status: unknown) {
  if (typeof id !== 'string' || !id || typeof status !== 'string' || !['running', 'paused', 'canceled'].includes(status)) throw new VoiceCampaignInputError('invalid_campaign_status');
  // Terminal campaigns cannot be restarted, and concurrent status changes cannot overwrite completion.
  const { data, error } = await db.from('voice_campaigns')
    .update({ status, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', id)
    .in('status', ['draft', 'running', 'paused']).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new VoiceCampaignInputError('campaign_unavailable');
  return { ok: true };
}
