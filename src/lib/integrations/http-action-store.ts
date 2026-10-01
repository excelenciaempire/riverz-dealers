import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { httpActionContainsSecret, httpActionDefinition, httpActionWrite } from './http-action-contract';
import { openHttpCredential, sealHttpCredential } from './http-action-credentials';

const metadata = z.object({ id: z.string().uuid(), definition: httpActionDefinition,
  state: z.enum(['draft', 'active', 'withdrawn']), revision: z.number().int().positive(),
  updated_at: z.string().datetime({ offset: true }), has_secret: z.boolean() }).strict();
export type HttpActionMetadata = z.infer<typeof metadata>;
const internal = metadata.omit({ has_secret: true }).extend({ workspace_id: z.string().uuid(), credential_ciphertext: z.string().nullable() }).strict();
export type HttpActionRecord = z.infer<typeof internal>;
export class HttpActionStoreError extends Error {
  constructor(readonly code: 'invalid' | 'not_found' | 'forbidden' | 'changed' | 'credential_required' | 'limit' | 'read_only' | 'unavailable') {
    super(`http_action_${code}`); this.name = 'HttpActionStoreError';
  }
}
function databaseError(message: string): never {
  const codes: Record<string, HttpActionStoreError['code']> = { invalid_http_action_context: 'not_found',
    http_action_admin_required: 'forbidden', http_action_changed: 'changed', http_action_invalid: 'invalid',
    http_action_credential_required: 'credential_required', http_action_limit: 'limit', subscription_read_only: 'read_only' };
  throw new HttpActionStoreError(codes[message] ?? 'unavailable');
}
/** Service-only read; callers must establish current authority before invoking. */
export async function loadHttpAction(db: SupabaseClient, workspaceId: string, id: string): Promise<HttpActionRecord> {
  const result = await db.from('http_actions').select('id, workspace_id, definition, credential_ciphertext, state, revision, updated_at')
    .eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
  if (result.error) throw new HttpActionStoreError('unavailable');
  if (!result.data) throw new HttpActionStoreError('not_found');
  try {
    const row = internal.parse(result.data);
    if (row.workspace_id !== workspaceId || row.id !== id) throw new Error('invalid_scope');
    return row;
  } catch { throw new HttpActionStoreError('unavailable'); }
}
export async function manageHttpAction(db: SupabaseClient, workspaceId: string, actorId: string,
  operation: 'list' | 'history' | 'create' | 'save' | 'activate' | 'withdraw', id?: string, input?: unknown) {
  const actionId = operation === 'create' ? randomUUID() : id;
  let definition, ciphertext: string | null = null, replace = false, revision: number | null = null;
  if (operation === 'create' || operation === 'save') {
    const parsed = httpActionWrite.safeParse(input);
    if (!parsed.success || (operation === 'create' && parsed.data.expected_version !== 0)) throw new HttpActionStoreError('invalid');
    definition = parsed.data.definition; revision = parsed.data.expected_version;
    if (definition.credential_kind === 'none') {
      if (parsed.data.secret !== undefined) throw new HttpActionStoreError('invalid');
      replace = true;
    } else {
      let secret = parsed.data.secret;
      if (!secret && operation === 'save') {
        const previous = await loadHttpAction(db, workspaceId, actionId!);
        try { secret = openHttpCredential(workspaceId, actionId!, definition, previous.credential_ciphertext ?? '').value; }
        catch { throw new HttpActionStoreError('credential_required'); }
      }
      if (!secret) throw new HttpActionStoreError('credential_required');
      if (httpActionContainsSecret(definition, secret)) throw new HttpActionStoreError('invalid');
      if (parsed.data.secret) {
        ciphertext = sealHttpCredential(workspaceId, actionId!, definition, secret); replace = true;
      }
    }
  } else if (operation === 'activate' || operation === 'withdraw') {
    const parsed = z.object({ expected_version: z.number().int().positive() }).strict().safeParse(input);
    if (!parsed.success) throw new HttpActionStoreError('invalid');
    revision = parsed.data.expected_version;
    if (operation === 'activate') {
      const current = await loadHttpAction(db, workspaceId, actionId!);
      if (current.definition.credential_kind !== 'none') {
        try { openHttpCredential(workspaceId, actionId!, current.definition, current.credential_ciphertext ?? ''); }
        catch { throw new HttpActionStoreError('credential_required'); }
      }
    }
  }
  const result = await db.rpc('manage_http_action', { p_workspace_id: workspaceId, p_actor_id: actorId,
    p_operation: operation, p_action_id: actionId ?? null, p_revision: revision,
    p_definition: definition ?? null, p_ciphertext: ciphertext, p_replace_credential: replace });
  if (result.error) databaseError(result.error.message);
  try {
    if (operation === 'list') return z.object({ actions: z.array(metadata).max(20) }).strict().parse(result.data);
    if (operation === 'history') return z.object({ history: z.array(z.object({ revision: z.number().int().positive(), definition: httpActionDefinition,
      state: z.enum(['draft', 'active', 'withdrawn']), credential_present: z.boolean(), observed_at: z.string().datetime({ offset: true }) }).strict()).max(50) }).strict().parse(result.data);
    const row = metadata.parse(result.data);
    if (row.id !== actionId) throw new Error('invalid_action_scope');
    return row;
  } catch { throw new HttpActionStoreError('unavailable'); }
}
