import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const channel = z.enum(['whatsapp', 'instagram', 'messenger', 'gmail', 'outlook', 'zoho', 'webchat', 'voice', 'ig_comment', 'fb_comment']);
const scope = z.enum(['contact', 'business']);
const base = z.object({ agent_id: uuid, channel, expected_version: z.number().int().nonnegative() }).strict();
const save = base.extend({ context_scope: scope, action_revision: z.number().int().positive() }).strict();
const metadata = z.object({ agent_id: uuid, channel, context_scope: scope, action_revision: z.number().int().positive(),
  revision: z.number().int().positive(), state: z.enum(['active', 'withdrawn']), granted_by: uuid,
  updated_at: z.string().datetime({ offset: true }) }).strict();
export type HttpAssistantGrant = z.infer<typeof metadata>;
export class HttpAssistantGrantError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'forbidden' | 'changed' | 'identity_required' | 'limit' | 'read_only' | 'unavailable') {
    super(`http_grant_${code}`); this.name = 'HttpAssistantGrantError';
  }
}
function failure(code: HttpAssistantGrantError['code']): never { throw new HttpAssistantGrantError(code); }
/** Private configuration helper. Does not register tools, grant human identity to an assistant or execute HTTP. */
export async function manageHttpAssistantGrant(db: SupabaseClient, workspaceId: string, actorId: string, actionId: string,
  operation: 'list' | 'save' | 'withdraw', input?: unknown): Promise<{ grants: HttpAssistantGrant[] } | HttpAssistantGrant> {
  try {
    const context = z.object({ workspaceId: uuid, actorId: uuid, actionId: uuid }).safeParse({ workspaceId, actorId, actionId });
    if (!context.success) return failure('invalid');
    const parsed = operation === 'save' ? save.safeParse(input) : operation === 'withdraw' ? base.safeParse(input) : null;
    if (operation !== 'list' && !parsed?.success) return failure('invalid');
    const args = parsed?.success ? parsed.data : null;
    const result = await db.rpc('manage_http_action_assistant_grant', { p_workspace_id: context.data.workspaceId,
      p_actor_id: context.data.actorId, p_action_id: context.data.actionId, p_operation: operation,
      p_agent_id: args?.agent_id ?? null, p_channel: args?.channel ?? null, p_grant_revision: args?.expected_version ?? null,
      p_context_scope: args && 'context_scope' in args ? args.context_scope : null,
      p_action_revision: args && 'action_revision' in args ? args.action_revision : null });
    if (result.error) {
      const codes: Record<string, HttpAssistantGrantError['code']> = { invalid_http_grant_context: 'not_found',
        http_grant_admin_required: 'forbidden', http_grant_changed: 'changed', http_grant_invalid: 'invalid',
        http_grant_identity_required: 'identity_required', http_grant_limit: 'limit', subscription_read_only: 'read_only' };
      return failure(codes[result.error.message] ?? 'unavailable');
    }
    if (operation === 'list') {
      const list = z.object({ grants: z.array(metadata).max(100) }).strict().safeParse(result.data);
      if (!list.success) return failure('unavailable'); return list.data;
    }
    const row = metadata.safeParse(result.data);
    if (!row.success || !args || row.data.agent_id !== args.agent_id || row.data.channel !== args.channel) return failure('unavailable');
    if (operation === 'save' && (row.data.state !== 'active' || row.data.revision !== args.expected_version + 1
      || !('action_revision' in args) || row.data.action_revision !== args.action_revision
      || !('context_scope' in args) || row.data.context_scope !== args.context_scope || row.data.granted_by !== context.data.actorId)) return failure('unavailable');
    if (operation === 'withdraw' && (row.data.state !== 'withdrawn' || ![args.expected_version, args.expected_version + 1].includes(row.data.revision))) return failure('unavailable');
    return row.data;
  } catch (cause) { if (cause instanceof HttpAssistantGrantError) throw cause; return failure('unavailable'); }
}
