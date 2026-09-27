import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAnthropicKey } from '@/lib/ai/platform-key';
import type { ModeloCobro } from './plan';

/** Configuration readiness only; provider validity is checked when used. Never return keys. */
export async function byokReadiness(db: SupabaseClient, workspaceId: string, model: ModeloCobro) {
  if (model !== 'byok') return null;
  const resolved = await resolveAnthropicKey(db, { workspaceId });
  if (resolved?.source === 'agent') return { needsKey: false, agentId: null };
  const { data, error } = await db.from('ai_agents').select('id')
    .eq('workspace_id', workspaceId).is('deleted_at', null)
    .order('is_active', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return { needsKey: true, agentId: data?.id ?? null };
}
