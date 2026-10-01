import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { userAccess } from '@/lib/mcp/access';
import { PublicJsonError, requestPublicJson } from '@/lib/security/public-json-request';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { actionOutput, actionRequest, httpActionContainsSecret, type HttpActionBindings } from './http-action-contract';
import { openHttpCredential } from './http-action-credentials';
import { HttpActionStoreError, loadHttpAction } from './http-action-store';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const execution = z.object({ workspaceId: uuid, actorUserId: uuid, actionId: uuid, expectedRevision: z.number().int().positive(),
  invocationKey: z.string().regex(/^[0-9a-f]{64}$/), confirmed: z.boolean(), conversationId: uuid.optional() }).strict();
export type HttpExecutionContext = z.input<typeof execution>;
const failure = z.enum(['http_destination_forbidden', 'http_input_invalid', 'http_timeout', 'http_transport_failed',
  'http_response_invalid', 'http_response_too_large', 'http_status_failed', 'http_output_invalid',
  'http_action_credential_unavailable', 'http_execution_unavailable']);
const projected = z.record(z.string(), z.union([z.string().max(4000), z.number().finite().min(-1e12).max(1e12), z.boolean()]));
const receipt = z.object({ id: uuid, state: z.enum(['claimed', 'acknowledged', 'blocked', 'uncertain']),
  status_code: z.number().int().min(100).max(599).nullable(), error_code: failure.nullable(), result: projected.nullable() }).strict()
  .refine(row => row.state === 'acknowledged'
    ? row.status_code !== null && row.status_code >= 200 && row.status_code < 300 && row.error_code === null && row.result !== null
    : row.result === null && (row.state === 'claimed' ? row.error_code === null && row.status_code === null
      : row.error_code !== null && (row.state !== 'blocked' || row.status_code === null)));
const claimResult = z.discriminatedUnion('claimed', [
  z.object({ claimed: z.literal(true), id: uuid, state: z.literal('claimed'), lease_id: uuid }).strict(),
  z.object({ claimed: z.literal(false), ...receipt.shape }).strict(),
]);
export type HttpExecutionReceipt = z.infer<typeof receipt> & { cached: boolean };
export class HttpExecutionError extends Error {
  constructor(readonly code: 'not_found' | 'forbidden' | 'changed' | 'confirmation_required' | 'read_only' | 'review_required' | 'conflict' | 'invalid' | 'unavailable') {
    super(`http_execution_${code}`); this.name = 'HttpExecutionError';
  }
}
const fail = (code: HttpExecutionError['code']): never => { throw new HttpExecutionError(code); };
function rpcError(message: string): never {
  const codes: Record<string, HttpExecutionError['code']> = { invalid_http_execution_context: 'not_found',
    http_execution_forbidden: 'forbidden', http_action_changed: 'changed', http_execution_confirmation_required: 'confirmation_required',
    subscription_read_only: 'read_only', http_execution_review_required: 'review_required', http_execution_conflict: 'conflict' };
  return fail(codes[message] ?? 'unavailable');
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex');
const conversationRow = z.object({ id: uuid, workspace_id: uuid, contact_id: uuid, channel: z.string(), connection_id: uuid.nullable() }).strict();
const contactRow = z.object({ id: uuid, workspace_id: uuid, phone: z.string().nullable(), email: z.string().nullable() }).strict();

/** Internal preflight; caller must establish current actor membership and section access first. */
export async function httpActionBindingsForConversation(db: SupabaseClient,
  ctx: Pick<z.output<typeof execution>, 'workspaceId' | 'actorUserId' | 'conversationId'>): Promise<HttpActionBindings | null> {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return fail('not_found');
  if (!ctx.conversationId) return null;
  const result = await db.from('conversations').select('id, workspace_id, contact_id, channel, connection_id')
    .eq('workspace_id', ctx.workspaceId).eq('id', ctx.conversationId).is('deleted_at', null).maybeSingle();
  if (result.error) return fail('unavailable');
  const parsed = conversationRow.safeParse(result.data);
  if (!parsed.success || parsed.data.workspace_id !== ctx.workspaceId || parsed.data.id !== ctx.conversationId) return fail('not_found');
  const conversation = parsed.data;
  if (['gmail', 'outlook', 'zoho'].includes(conversation.channel)) {
    if (!conversation.connection_id) return fail('not_found');
    const mailbox = await db.from('channel_connections').select('id').eq('workspace_id', ctx.workspaceId)
      .eq('id', conversation.connection_id).eq('channel', conversation.channel).eq('created_by', ctx.actorUserId).maybeSingle();
    if (mailbox.error) return fail('unavailable');
    if (mailbox.data?.id !== conversation.connection_id) return fail('not_found');
  }
  const customer = await db.from('contacts').select('id, workspace_id, phone, email')
    .eq('workspace_id', ctx.workspaceId).eq('id', conversation.contact_id).maybeSingle();
  if (customer.error) return fail('unavailable');
  const contact = contactRow.safeParse(customer.data);
  if (!contact.success || contact.data.workspace_id !== ctx.workspaceId || contact.data.id !== conversation.contact_id) return fail('not_found');
  return { contact_id: contact.data.id, conversation_id: conversation.id, phone: contact.data.phone, email: contact.data.email };
}

/** Internal only. Adapters must derive actor, invocation key and confirmation from protected server state.
 * No client/model arguments may populate this context. A receipt precedes every network dispatch.
 */
export async function executeHttpAction(db: SupabaseClient, context: HttpExecutionContext, parameters: unknown): Promise<HttpExecutionReceipt> {
  if (!SHOW_RIVERZ_IMPROVEMENTS) return fail('not_found');
  try { return await executeActiveHttpAction(db, context, parameters); }
  catch (error) { if (error instanceof HttpExecutionError) throw error; return fail('unavailable'); }
}

async function executeActiveHttpAction(db: SupabaseClient, context: HttpExecutionContext, parameters: unknown): Promise<HttpExecutionReceipt> {
  const parsed = execution.safeParse(context);
  if (!parsed.success) return fail('invalid');
  const ctx = parsed.data, access = await userAccess(db, ctx.actorUserId, ctx.workspaceId);
  if (!access || (access.sections !== null && (!access.sections.includes('/automatizaciones')
    || (!!ctx.conversationId && !access.sections.includes('/bandeja'))))) return fail('forbidden');
  let action;
  try { action = await loadHttpAction(db, ctx.workspaceId, ctx.actionId); }
  catch (error) { return fail(error instanceof HttpActionStoreError && error.code === 'not_found' ? 'not_found' : 'unavailable'); }
  if (action.state !== 'active') return fail('not_found');
  if (action.revision !== ctx.expectedRevision) return fail('changed');
  if (action.definition.method === 'POST' && (!access.admin || !ctx.confirmed)) return fail('confirmation_required');
  const trusted = await httpActionBindingsForConversation(db, ctx);
  let request;
  try { request = actionRequest(action.definition, parameters, trusted ?? {}); }
  catch { return fail('invalid'); }
  // Only hashes and identity snapshot enter the claim; arbitrary request values stay out of the receipt.
  const claimed = await db.rpc('claim_http_action', { p_workspace_id: ctx.workspaceId, p_actor_id: ctx.actorUserId,
    p_action_id: ctx.actionId, p_revision: ctx.expectedRevision, p_invocation_key: ctx.invocationKey,
    p_input_hash: hash({ request, conversation_id: ctx.conversationId ?? null }), p_confirmed: ctx.confirmed,
    p_conversation_id: ctx.conversationId ?? null, p_context: trusted });
  if (claimed.error) return rpcError(claimed.error.message);
  const run = claimResult.safeParse(claimed.data);
  if (!run.success) return fail('unavailable');
  if (!run.data.claimed) {
    const saved = { id: run.data.id, state: run.data.state, status_code: run.data.status_code,
      error_code: run.data.error_code, result: run.data.result };
    const validated = receipt.safeParse(saved);
    if (!validated.success) return fail('unavailable');
    if (saved.result) {
      const shape = Object.fromEntries(action.definition.outputs.map(field => {
        const scalar = field.type === 'string' ? z.string().max(4000) : field.type === 'number'
          ? z.number().finite().min(-1e12).max(1e12) : z.boolean();
        return [field.key, field.required ? scalar : scalar.optional()];
      }));
      if (!z.object(shape).strict().safeParse(saved.result).success || Buffer.byteLength(JSON.stringify(saved.result)) > 65536) return fail('unavailable');
    }
    return { ...validated.data, cached: true };
  }
  const owned = run.data;
  let final: Omit<z.infer<typeof receipt>, 'id'>;
  let credential: ReturnType<typeof openHttpCredential> | undefined;
  try {
    if (action.definition.credential_kind !== 'none') credential = openHttpCredential(ctx.workspaceId, ctx.actionId,
      action.definition, action.credential_ciphertext ?? '');
  } catch {
    final = { state: 'blocked', status_code: null, error_code: 'http_action_credential_unavailable', result: null };
    return finish(final);
  }
  if (credential && httpActionContainsSecret(request, credential.value)) {
    return finish({ state: 'blocked', status_code: null, error_code: 'http_input_invalid', result: null });
  }
  try {
    const response = await requestPublicJson({ ...request, credential,
      idempotencyKey: hash({ workspace: ctx.workspaceId, action: ctx.actionId, invocation: ctx.invocationKey }) });
    let output;
    try {
      output = actionOutput(action.definition, response.data, credential?.value);
      if (Buffer.byteLength(JSON.stringify(output)) > 65536) throw new Error('http_output_invalid');
    } catch {
      return finish({ state: 'uncertain', status_code: response.status, error_code: 'http_output_invalid', result: null });
    }
    final = { state: 'acknowledged', status_code: response.status, error_code: null, result: output };
  } catch (error) {
    // Unknown exceptions cannot establish that no dispatch occurred. Never auto-retry them.
    const transport = error instanceof PublicJsonError ? error : null;
    final = { state: transport && !transport.dispatched ? 'blocked' : 'uncertain',
      status_code: transport?.dispatched ? transport.status ?? null : null,
      error_code: transport?.code ?? 'http_execution_unavailable', result: null };
  }
  return finish(final);

  async function finish(value: Omit<z.infer<typeof receipt>, 'id'>): Promise<HttpExecutionReceipt> {
    const completed = await db.rpc('finish_http_action', { p_workspace_id: ctx.workspaceId, p_run_id: owned.id,
      p_lease_id: owned.lease_id, p_state: value.state, p_status_code: value.status_code,
      p_error_code: value.error_code, p_result: value.result });
    if (completed.error) return fail('unavailable');
    const validated = receipt.safeParse(completed.data);
    if (!validated.success || validated.data.id !== owned.id || validated.data.state !== value.state
      || validated.data.status_code !== value.status_code || validated.data.error_code !== value.error_code
      || hash(validated.data.result) !== hash(value.result)) return fail('unavailable');
    return { ...validated.data, cached: false };
  }
}
