import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { userAccess } from '@/lib/mcp/access';
import { csrfGuard } from '@/lib/csrf';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';
import { SHOW_RIVERZ_IMPROVEMENTS } from '@/lib/ui/improvements-preview';
import { idColumn } from '@/lib/short-id';
import { httpActionDefinition } from '@/lib/integrations/http-action-contract';
import { httpFlowActionAllowed, httpFlowConfig } from '@/lib/flows/http-contract';
import { limitByKey } from '@/lib/rate-limit';

const write = z.object({ operation: z.enum(['save','withdraw']), node_key: z.string().min(1).max(120),
  expected_revision: z.number().int().nonnegative(), reviewed_config: httpFlowConfig.optional() }).strict()
  .refine(value=>value.operation!=='save' || value.reviewed_config!==undefined);
async function handle(request: Request, rawId: string, mutation: boolean) {
  const locale = await getLocale(), headers = { 'Cache-Control': 'private, no-store' };
  const fail = (status: number) => NextResponse.json({ error: translate(locale, 'flows.httpUnavailable') }, { status, headers });
  if (!SHOW_RIVERZ_IMPROVEMENTS) return fail(404);
  if (mutation) { const rejected = await csrfGuard(request); if (rejected) { rejected.headers.set('Cache-Control',headers['Cache-Control']);return rejected; } }
  if ([...new URL(request.url).searchParams].length) return fail(400);
  try {
    const client = await createClient(), auth = await client.auth.getUser();
    if (auth.error || !auth.data.user) return fail(401);
    const actor = auth.data.user.id, workspace = await resolveWorkspaceIdForUser(client, actor);
    if (!workspace) return fail(404);
    const db = supabaseAdmin(), access = await userAccess(db, actor, workspace);
    if (!access?.admin || (access.sections !== null && !['/automatizaciones','/bandeja'].every(s => access.sections!.includes(s)))) return fail(403);
    const budget=await limitByKey(`http-flow-config:${workspace}:${actor}`,{limit:40,windowMs:60000});
    if (!budget.success) return fail(429);
    const requestedWorkspace=request.headers.get('x-riverz-workspace');
    if (requestedWorkspace!==null && requestedWorkspace.toLowerCase()!==workspace.toLowerCase()) return fail(409);
    if (!/^(?:[a-zA-Z0-9]{8}|[0-9a-fA-F-]{36})$/.test(rawId)) return fail(404);
    const selected = await db.from('flows').select('id').eq(idColumn(rawId), rawId).eq('workspace_id', workspace).is('deleted_at', null).maybeSingle();
    if (selected.error) return fail(503);
    if (!selected.data) return fail(404);
    const flowId = z.string().uuid().parse(selected.data.id);
    let input: z.infer<typeof write> | undefined;
    if (mutation) {
      const reader = request.body?.getReader(); if (!reader) return fail(400);
      const chunks: Uint8Array[] = []; let size=0;
      try { while (true) { const piece=await reader.read(); if (piece.done) break; size+=piece.value.byteLength;
        if (size>16384) { await reader.cancel(); return fail(413); } chunks.push(piece.value); }
      } finally { reader.releaseLock(); }
      const parsed = write.safeParse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));
      if (!parsed.success) return fail(400); input=parsed.data;
    }
    const result = await db.rpc('manage_http_flow_grant', { p_workspace_id: workspace, p_actor_id: actor,
      p_flow_id: flowId, p_operation: input?.operation ?? 'list', p_node_key: input?.node_key ?? null,
      p_expected_revision: input?.expected_revision ?? null,p_reviewed_config:input?.reviewed_config ?? null });
    if (result.error) return fail(result.error.message==='subscription_read_only' ? 402 : 409);
    if (mutation) return NextResponse.json(result.data,{headers});
    const actions = await db.from('http_actions').select('id, definition, revision').eq('workspace_id', workspace).eq('state','active').limit(21);
    if (actions.error || !Array.isArray(actions.data) || actions.data.length>20) return fail(503);
    const choices = actions.data.flatMap(row => {
      const definition=httpActionDefinition.safeParse(row.definition);
      if (!definition.success || !httpFlowActionAllowed(definition.data)) return [];
      return [{ id: row.id, revision:row.revision, name:definition.data.name,
        inputs:definition.data.parameters.filter(p=>!p.source || p.source==='input').map(p=>({key:p.key,required:p.required,type:p.type})),
        outputs:definition.data.outputs.map(p=>p.key) }];
    });
    return NextResponse.json({ ...result.data, actions:choices },{headers});
  } catch(error) { return fail(error instanceof SyntaxError ? 400 : 503); }
}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) { return handle(request,(await params).id,false); }
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) { return handle(request,(await params).id,true); }
