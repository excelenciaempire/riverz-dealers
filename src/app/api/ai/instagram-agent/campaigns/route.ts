import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { coercePlan } from '@/lib/instagram-agent/types';

/**
 * GET  /api/ai/instagram-agent/campaigns        — lista las campañas del workspace.
 * POST /api/ai/instagram-agent/campaigns        — guarda un plan generado como
 *                                                 campaña en estado `draft`.
 *
 * RLS (migración 066) scope todo por is_workspace_member, así que el cliente
 * autenticado solo ve/escribe lo de su workspace.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('instagram_campaigns')
    .select(
      'id, name, goal, status, offer_code, metrics, launched_at, created_at, updated_at',
    )
    .order('updated_at', { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ campaigns: data ?? [] });
}

export async function POST(request: Request) {
  const block = await csrfGuard(request);
  if (block) return block;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: 'No perteneces a ningún workspace.' },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const goal: string = (body.goal ?? '').toString().trim();
  const plan = coercePlan(body.plan);
  if (!goal || !plan) {
    return NextResponse.json(
      { error: 'Faltan el objetivo o un plan válido.' },
      { status: 400 },
    );
  }
  // % de holdout (grupo de control) para medir incrementalidad. 0–50.
  const holdoutPct = Math.max(
    0,
    Math.min(50, Math.round(Number(body.holdout_pct ?? 10)) || 0),
  );

  const { data, error } = await supabase
    .from('instagram_campaigns')
    .insert({
      workspace_id: workspaceId,
      created_by: user.id,
      name: plan.campaign_name.slice(0, 160),
      goal: goal.slice(0, 2000),
      status: 'draft',
      plan,
      offer_code: plan.offer?.code ?? null,
      holdout_pct: holdoutPct,
      metrics: {},
    })
    .select('id')
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: (data as { id: string }).id });
}
