import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { csrfGuard } from '@/lib/csrf';
import { resolveAudience } from '@/lib/instagram-agent/resolve-audience';
import { coercePlan } from '@/lib/instagram-agent/types';
import { getLocale } from '@/lib/i18n/server';
import { translate } from '@/lib/i18n/translate';

/**
 * POST /api/ai/instagram-agent/campaigns/[id]/launch
 *
 * Lanza (o retoma) una campaña: resuelve la audiencia si todavía no tiene
 * destinatarios y la marca `active`. El cron `instagram-agent` se encarga del
 * envío real de los DMs en cola.
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
    .select('id, workspace_id, plan, status, holdout_pct')
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
    status: string;
    holdout_pct: number;
  };
  if (row.status === 'done') {
    return NextResponse.json(
      { error: translate(locale, 'errAi.campaignAlreadyDone') },
      { status: 400 },
    );
  }

  // Resolver audiencia si no queda NADIE en cola. Contar todas las filas (y no
  // solo las `queued`) dejaba campañas activas sin nada que enviar: bastaba con
  // que sus destinatarios estuvieran ya enviados, descartados o en aprobación
  // para que el lanzamiento no resolviera audiencia nueva y el worker girara en
  // vacío para siempre. El upsert de resolveAudience es idempotente, así que
  // volver a resolver no duplica a nadie.
  const [{ count: queuedCount }, { count: totalCount }] = await Promise.all([
    supabase
      .from('instagram_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'queued'),
    supabase
      .from('instagram_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', id),
  ]);

  let queued = queuedCount ?? 0;
  const hadRecipients = (totalCount ?? 0) > 0;
  if (queued === 0) {
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
      queued = result.queued;
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
    // Sin nadie en cola Y sin historial: no hay campaña que lanzar. Con
    // historial (todo ya enviado/atendido) sí activamos: la campaña sigue
    // atribuyendo ventas e inscribiendo en tiempo real a quien comente ahora.
    if (queued === 0 && !hadRecipients) {
      return NextResponse.json(
        { error: translate(locale, 'errAi.noInstagramContactsLaunch') },
        { status: 400 },
      );
    }
  }

  const { error: updErr } = await supabase
    .from('instagram_campaigns')
    .update({ status: 'active', launched_at: new Date().toISOString() })
    .eq('id', id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, status: 'active', queued });
}
