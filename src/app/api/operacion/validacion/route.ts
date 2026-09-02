import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { resolveWorkspaceIdForUser } from '@/lib/workspaces/resolve';
import { csrfGuard } from '@/lib/csrf';
import { ponerMotor } from '@/lib/workspaces/motor';
import {
  cargarPerfilOperativo,
  estadoPreparacion,
} from '@/lib/operacion/perfil-operativo';
import {
  evaluarEscenario,
  escenariosParaCanal,
  resumenValidacion,
  type ValidationOutcome,
} from '@/lib/operacion/validacion';

export const dynamic = 'force-dynamic';

async function contexto() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const workspaceId = await resolveWorkspaceIdForUser(admin, user.id);
  return workspaceId ? { admin, user, workspaceId } : null;
}

export async function GET() {
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const [{ data: agents }, { count: productCount }, { data: channels }, profile, { data: latest }] = await Promise.all([
    ctx.admin.from('ai_agents').select('id, name, is_active, requires_approval, medios_pago').eq('workspace_id', ctx.workspaceId).is('deleted_at', null).order('created_at'),
    ctx.admin.from('shopify_products').select('id', { count: 'exact', head: true }).eq('workspace_id', ctx.workspaceId),
    ctx.admin.from('channel_connections').select('channel, status').eq('workspace_id', ctx.workspaceId),
    cargarPerfilOperativo(ctx.admin, ctx.workspaceId),
    ctx.admin.from('operacion_validation_runs').select('id, agent_id, channel, status, readiness, created_at').eq('workspace_id', ctx.workspaceId).order('created_at', { ascending: false }).limit(1),
  ]);
  const connected = ((channels ?? []) as Array<{ channel: string; status: string }>).filter((channel) => channel.status === 'connected');
  const firstAgent = (agents ?? [])[0] as { medios_pago?: string[] | null } | undefined;
  const readiness = estadoPreparacion({
    profile,
    hasProduct: (productCount ?? 0) > 0,
    hasConnectedChannel: connected.length > 0,
    hasPaymentMethods: Boolean(firstAgent?.medios_pago?.length || profile?.paymentMethods?.length),
  });
  return NextResponse.json({
    agents: agents ?? [],
    channels: connected.map((channel) => channel.channel),
    scenarios: escenariosParaCanal(connected[0]?.channel),
    readiness,
    latest: latest?.[0] ?? null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;
  const ctx = await contexto();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null) as {
    action?: 'record' | 'release'; agentId?: string; channel?: string; outcomes?: unknown;
  } | null;
  if (!body?.agentId) return NextResponse.json({ error: 'agent_required' }, { status: 400 });
  const { data: agent } = await ctx.admin
    .from('ai_agents')
    .select('id, medios_pago')
    .eq('id', body.agentId)
    .eq('workspace_id', ctx.workspaceId)
    .maybeSingle();
  if (!agent) return NextResponse.json({ error: 'agent_not_found' }, { status: 404 });

  if (body.action === 'release') {
    const { data: last } = await ctx.admin
      .from('operacion_validation_runs')
      .select('status')
      .eq('workspace_id', ctx.workspaceId)
      .eq('agent_id', body.agentId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.status !== 'passed') return NextResponse.json({ error: 'validation_required' }, { status: 409 });
    await ctx.admin.from('ai_agents').update({ is_active: true, requires_approval: false }).eq('id', body.agentId);
    await ponerMotor(ctx.admin, ctx.workspaceId, true, ctx.user.id);
    return NextResponse.json({ ok: true, released: true });
  }

  const raw = Array.isArray(body.outcomes) ? body.outcomes : [];
  const outcomes: ValidationOutcome[] = raw
    .map((row) => {
      const item = row as { id?: unknown; reply?: unknown; tools?: unknown };
      const scenario = escenariosParaCanal(typeof body.channel === 'string' ? body.channel : null)
        .find((candidate) => candidate.id === item.id);
      if (!scenario || typeof item.reply !== 'string') return null;
      return evaluarEscenario(scenario, item.reply, Array.isArray(item.tools) ? item.tools.filter((tool): tool is string => typeof tool === 'string') : []);
    })
    .filter((row): row is ValidationOutcome => Boolean(row));
  const [{ count: productCount }, { data: channels }, profile] = await Promise.all([
    ctx.admin.from('shopify_products').select('id', { count: 'exact', head: true }).eq('workspace_id', ctx.workspaceId),
    ctx.admin.from('channel_connections').select('status').eq('workspace_id', ctx.workspaceId),
    cargarPerfilOperativo(ctx.admin, ctx.workspaceId),
  ]);
  const readiness = estadoPreparacion({
    profile,
    hasProduct: (productCount ?? 0) > 0,
    hasConnectedChannel: (channels ?? []).some((channel: { status: string }) => channel.status === 'connected'),
    hasPaymentMethods: Boolean((agent as { medios_pago?: string[] | null }).medios_pago?.length || profile?.paymentMethods?.length),
  });
  const status = resumenValidacion({ ...readiness, outcomes });
  const { data, error } = await ctx.admin.from('operacion_validation_runs').insert({
    workspace_id: ctx.workspaceId,
    agent_id: body.agentId,
    channel: typeof body.channel === 'string' ? body.channel.slice(0, 40) : 'webchat',
    status,
    readiness: { ...readiness, completed: outcomes.map((outcome) => outcome.id) },
    scenarios: outcomes,
    created_by: ctx.user.id,
  }).select('id, status, readiness, scenarios, created_at').single();
  if (error) return NextResponse.json({ error: 'validation_save_failed' }, { status: 500 });
  return NextResponse.json({ run: data });
}
