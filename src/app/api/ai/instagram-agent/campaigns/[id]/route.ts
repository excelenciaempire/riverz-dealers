import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveShortId } from '@/lib/short-id';
import { csrfGuard } from '@/lib/csrf';
import { coercePlan, type CampaignStatus } from '@/lib/instagram-agent/types';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

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
  const { id: rawId } = await context.params;
  const locale = await getLocale();
  const supabase = await createClient();
  const id = await resolveShortId(supabase, 'instagram_campaigns', rawId);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );
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
    return NextResponse.json(
      { error: translate(locale, 'errAi.campaignNotFound') },
      { status: 404 },
    );
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

  // Ingresos por post de origen — "qué post genera ventas" (atribución por
  // fuente, estilo Blueberry). Solo cuenta destinatarios convertidos cuyo
  // post de origen conocemos (los del trigger en tiempo real).
  const { data: converted } = await supabase
    .from('instagram_campaign_recipients')
    .select('source_post_id, revenue, currency')
    .eq('campaign_id', id)
    .eq('status', 'converted')
    .not('source_post_id', 'is', null)
    .limit(5000);
  const postMap = new Map<
    string,
    { conversions: number; revenue: number; currency: string | null }
  >();
  for (const r of (converted ?? []) as Array<{
    source_post_id: string;
    revenue: number | null;
    currency: string | null;
  }>) {
    const cur = postMap.get(r.source_post_id) ?? {
      conversions: 0,
      revenue: 0,
      currency: null,
    };
    cur.conversions += 1;
    cur.revenue += Number(r.revenue ?? 0) || 0;
    cur.currency = r.currency ?? cur.currency;
    postMap.set(r.source_post_id, cur);
  }
  const revenue_by_post = [...postMap.entries()]
    .map(([post_id, v]) => ({ post_id, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return NextResponse.json({
    campaign,
    recipients_by_status: byStatus,
    revenue_by_post,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id: rawId } = await context.params;
  const locale = await getLocale();

  const supabase = await createClient();
  const id = await resolveShortId(supabase, 'instagram_campaigns', rawId);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status)) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.invalidStatus') },
        { status: 400 },
      );
    }
    patch.status = body.status;
  }
  if (body.plan !== undefined) {
    const plan = coercePlan(body.plan);
    if (!plan) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.invalidPlan') },
        { status: 400 },
      );
    }
    patch.plan = plan;
    patch.name = plan.campaign_name.slice(0, 160);
    patch.offer_code = plan.offer?.code ?? null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.nothingToUpdate') },
      { status: 400 },
    );
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
    return NextResponse.json(
      { error: translate(locale, 'errAi.campaignNotFound') },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true, campaign: data });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id: rawId } = await context.params;
  const locale = await getLocale();

  const supabase = await createClient();
  const id = await resolveShortId(supabase, 'instagram_campaigns', rawId);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );
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
