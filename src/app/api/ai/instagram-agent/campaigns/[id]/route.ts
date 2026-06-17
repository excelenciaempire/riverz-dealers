import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { coercePlan, type CampaignStatus } from '@/lib/instagram-agent/types';

/**
 * GET    /api/ai/instagram-agent/campaigns/[id]  — detalle (plan + métricas + recipients resumidos).
 * PATCH  /api/ai/instagram-agent/campaigns/[id]  — editar plan o cambiar estado (pausar/retomar/finalizar).
 * DELETE /api/ai/instagram-agent/campaigns/[id]  — eliminar campaña (cascade a recipients).
 *
 * RLS scope por workspace; el cliente autenticado solo toca lo suyo.
 */

const VALID_STATUS: CampaignStatus[] = ['draft', 'active', 'paused', 'done'];

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { data: campaign, error } = await supabase
    .from('instagram_campaigns')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!campaign) {
    return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  }

  // Resumen de destinatarios por estado, para el dashboard de la campaña.
  const { data: recipients } = await supabase
    .from('instagram_campaign_recipients')
    .select('status')
    .eq('campaign_id', id)
    .limit(5000);
  const byStatus: Record<string, number> = {};
  for (const r of (recipients ?? []) as { status: string }[]) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  }

  return NextResponse.json({ campaign, recipients_by_status: byStatus });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status)) {
      return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (body.plan !== undefined) {
    const plan = coercePlan(body.plan);
    if (!plan) {
      return NextResponse.json({ error: 'Plan inválido' }, { status: 400 });
    }
    patch.plan = plan;
    patch.name = plan.campaign_name.slice(0, 160);
    patch.offer_code = plan.offer?.code ?? null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('instagram_campaigns')
    .update(patch)
    .eq('id', id)
    .select('id, status')
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
  }
  return NextResponse.json({ success: true, campaign: data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { error } = await supabase
    .from('instagram_campaigns')
    .delete()
    .eq('id', id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
