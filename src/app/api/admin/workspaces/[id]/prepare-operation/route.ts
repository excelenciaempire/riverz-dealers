import { NextResponse } from 'next/server';
import { csrfGuard } from '@/lib/csrf';
import { requireAdmin } from '@/lib/admin/guard';
import { recordAdminAction } from '@/lib/admin/audit';
import { supabaseAdmin } from '@/lib/channels/admin-client';
import { normalizarPerfilOperativo, PROMPT_VERSION } from '@/lib/operacion/perfil-operativo';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const block = await csrfGuard(request);
  if (block) return block;
  const gate = await requireAdmin();
  if (!gate.ok) return gate.res;
  const { id: workspaceId } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    websiteUrl?: unknown; language?: unknown; channel?: unknown; checkoutMode?: unknown; vertical?: unknown;
    country?: unknown; storePlatform?: unknown; paymentMethods?: unknown; initialGoal?: unknown;
  } | null;
  const websiteUrl = typeof body?.websiteUrl === 'string' ? body.websiteUrl.trim().slice(0, 500) : '';
  if (websiteUrl) {
    try { new URL(websiteUrl); } catch { return NextResponse.json({ error: 'invalid_website' }, { status: 400 }); }
  }
  const admin = supabaseAdmin();
  const { data: workspace } = await admin.from('workspaces').select('id').eq('id', workspaceId).maybeSingle();
  if (!workspace) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const profile = normalizarPerfilOperativo({
    source: 'admin', websiteUrl: websiteUrl || undefined,
    vertical: body?.vertical, checkoutMode: body?.checkoutMode,
    country: body?.country, targetChannel: body?.channel,
    storePlatform: body?.storePlatform, paymentMethods: body?.paymentMethods,
  });
  const initialGoal = body?.initialGoal === 'postventa' || body?.initialGoal === 'recuperacion'
    ? body.initialGoal
    : 'ventas';
  const { data: existingAgent } = await admin
    .from('ai_agents')
    .select('id')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  let generatedAgentId = (existingAgent as { id?: string } | null)?.id ?? null;
  if (!generatedAgentId) {
    const { data: created, error } = await admin.from('ai_agents').insert({
      workspace_id: workspaceId,
      name: 'Asistente de la marca',
      is_active: false,
      requires_approval: true,
      language: body?.language === 'en' ? 'en' : 'es',
      persona: '',
      scope: 'workspace',
      product_scope: 'all',
      role: 'ventas',
      model: 'claude-sonnet-5',
    }).select('id').single();
    if (error || !created) return NextResponse.json({ error: 'draft_create_failed' }, { status: 500 });
    generatedAgentId = (created as { id: string }).id;
  }
  const { error: setupError } = await admin.from('operacion_setup').upsert({
    workspace_id: workspaceId,
    step: 1,
    playbooks: [initialGoal],
    generated_agent_id: generatedAgentId,
    instalado_por: 'riverz',
    perfil_operativo: profile,
    perfil_actualizado_at: new Date().toISOString(),
    prompt_version: PROMPT_VERSION,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' });
  if (setupError) return NextResponse.json({ error: 'setup_save_failed' }, { status: 500 });
  await recordAdminAction(gate.actor, request, {
    action: 'prepare.workspace_operation', targetType: 'workspace', targetId: workspaceId,
    meta: { hasWebsite: Boolean(websiteUrl), agentId: generatedAgentId },
  });
  return NextResponse.json({ ok: true, agentId: generatedAgentId, profile });
}
