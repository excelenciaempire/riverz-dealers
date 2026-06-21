import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveAudience } from '@/lib/instagram-agent/resolve-audience';
import { coercePlan } from '@/lib/instagram-agent/types';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * POST /api/ai/instagram-agent/campaigns/[id]/resolve
 *
 * Materializa la audiencia de la campaña en instagram_campaign_recipients
 * (status='queued') a partir de los contactos de Instagram del workspace.
 * Idempotente. No envía nada — eso lo hace el lanzamiento + el worker.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const block = await csrfGuard(request);
  if (block) return block;
  const { id } = await context.params;
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

  const { data: campaign, error } = await supabase
    .from('instagram_campaigns')
    .select('id, workspace_id, plan, holdout_pct')
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

  const row = campaign as {
    id: string;
    workspace_id: string;
    plan: unknown;
    holdout_pct: number;
  };
  const plan = coercePlan(row.plan);
  if (!plan) {
    return NextResponse.json(
      { error: translate(locale, 'errAi.campaignNoValidPlan') },
      { status: 400 },
    );
  }

  try {
    const result = await resolveAudience(supabase, {
      id: row.id,
      workspace_id: row.workspace_id,
      plan,
      holdout_pct: row.holdout_pct,
    });
    if (result.available === 0) {
      return NextResponse.json({
        success: true,
        queued: 0,
        message: translate(locale, 'errAi.noInstagramContactsResolve'),
      });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : translate(locale, 'errAi.resolveAudienceFailed'),
      },
      { status: 500 },
    );
  }
}
