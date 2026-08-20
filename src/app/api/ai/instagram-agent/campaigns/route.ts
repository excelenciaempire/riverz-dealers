import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveWorkspaceId } from '@/lib/instagram-agent/workspace';
import { createCampaignDraft } from '@/lib/instagram-agent/create-campaign';
import { coercePlan } from '@/lib/instagram-agent/types';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * GET  /api/ai/instagram-agent/campaigns        — lista las campañas del workspace.
 * POST /api/ai/instagram-agent/campaigns        — guarda un plan generado como
 *                                                 campaña en estado `draft`.
 *
 * RLS (migración 066) scope todo por is_workspace_member, así que el cliente
 * autenticado solo ve/escribe lo de su workspace.
 */

export async function GET() {
  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );
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

  const locale = await getLocale();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.notAuthenticated') },
      { status: 401 },
    );
  }

  const workspaceId = await resolveWorkspaceId(supabase, user.id);
  if (!workspaceId) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.noWorkspace') },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const goal: string = (body.goal ?? '').toString().trim();
  const plan = coercePlan(body.plan);
  if (!goal || !plan) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.missingGoalOrPlan') },
      { status: 400 },
    );
  }

  // El armado de la campaña (voz de marca, grupo de control, borrador) vive en
  // `createCampaignDraft`: el chat agéntico crea la misma fila sin pasar por acá.
  try {
    const campaign = await createCampaignDraft(supabase, {
      workspaceId,
      createdBy: user.id,
      goal,
      plan,
      holdoutPct: body.holdout_pct,
      agentId: typeof body.ai_agent_id === 'string' ? body.ai_agent_id : null,
    });
    return NextResponse.json({ success: true, id: campaign.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'error' },
      { status: 500 },
    );
  }
}
