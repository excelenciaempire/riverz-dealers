import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpActor } from './tokens';

export async function verifyConnection(db: SupabaseClient, actor: McpActor, code: unknown) {
  if (actor.kind !== 'workspace' || actor.origin !== 'oauth' || !actor.userId ||
    typeof code !== 'string' || !/^[a-f0-9-]{36}$/i.test(code)) throw new Error('invalid_connection_check');
  const { data, error } = await db.from('mcp_connection_checks')
    .update({ verified_at: new Date().toISOString(), token_id: actor.tokenId })
    .eq('id', code).eq('user_id', actor.userId).eq('workspace_id', actor.workspaceId)
    .gt('expires_at', new Date().toISOString()).is('verified_at', null).select('id, verified_at').maybeSingle();
  if (error || !data) throw new Error('connection_check_expired_or_invalid');
  return { connected: true, user_id: actor.userId, workspace_id: actor.workspaceId, verified_at: data.verified_at };
}
