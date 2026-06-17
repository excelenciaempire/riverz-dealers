import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { sendCampaignBatch } from '@/lib/instagram-agent/send';
import { scoreCampaignRecipients } from '@/lib/instagram-agent/lead-scoring';
import { replyToComments } from '@/lib/instagram-agent/comment-reply';
import { detectRepliesAndCapture } from '@/lib/instagram-agent/capture';
import { attributeAndRollup } from '@/lib/instagram-agent/attribution';
import { coercePlan, type InstagramCampaign } from '@/lib/instagram-agent/types';

/**
 * GET /api/cron/instagram-agent
 *
 * Worker del Agente de Instagram. Por cada campaña `active`:
 *   1. envía una tanda de DMs en cola (Fase 3),
 *   2. detecta respuestas entrantes y captura leads (Fase 4),
 *   3. atribuye conversiones desde Shopify (Fase 5).
 *
 * Auth: header `x-cron-secret` == AUTOMATION_CRON_SECRET (mismo secreto
 * compartido que el resto de crons). Pensado para un pinger cada 1-5 min.
 */
export async function GET(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const db = supabaseAdmin();

  const { data: campaigns, error } = await db
    .from('instagram_campaigns')
    .select('id, workspace_id, plan, offer_code, status, launched_at')
    .eq('status', 'active')
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  let failures = 0;

  for (const raw of (campaigns ?? []) as Array<
    Pick<
      InstagramCampaign,
      'id' | 'workspace_id' | 'offer_code' | 'status' | 'launched_at'
    > & {
      plan: unknown;
    }
  >) {
    const plan = coercePlan(raw.plan);
    if (!plan) {
      results.push({ campaign: raw.id, skipped: 'invalid_plan' });
      continue;
    }
    const campaign = {
      id: raw.id,
      workspace_id: raw.workspace_id,
      plan,
      offer_code: raw.offer_code,
    };

    try {
      // Lead scoring + supresión de spam antes de enviar (prioriza alta
      // intención, descarta spam/hate).
      const score = await scoreCampaignRecipients(db, raw.id);
      const send = await sendCampaignBatch(db, campaign);
      // Responder públicamente a comentarios de alta intención (→ DM).
      const comments = await replyToComments(db, campaign);
      // Detectar respuestas + capturar email/teléfono de los ya enviados.
      const capture = await detectRepliesAndCapture(db, raw.id, raw.workspace_id);
      // Cerrar el loop: atribuir conversiones de Shopify + métricas en vivo.
      const metrics = await attributeAndRollup(db, {
        id: raw.id,
        workspace_id: raw.workspace_id,
        launched_at: raw.launched_at,
        offer_code: raw.offer_code,
      });

      // Si no quedan en cola y todo se envió, la campaña queda lista para
      // finalizar manualmente; la dejamos `active` para seguir atribuyendo.
      results.push({
        campaign: raw.id,
        scored: score.scored,
        spam: score.spam,
        ...send,
        comment_replies: comments.replied,
        ...capture,
        conversions: metrics.conversions,
        revenue: metrics.revenue,
        incremental_revenue: metrics.incremental_revenue,
        uplift_pct: metrics.uplift_pct,
      });
      if ((send as { skipped?: string }).skipped) failures += 1;
    } catch (err) {
      failures += 1;
      results.push({
        campaign: raw.id,
        error: err instanceof Error ? err.message : 'batch failed',
      });
    }
  }

  // 207 si alguna campaña falló parcialmente, para que el monitor del cron
  // se ponga en rojo ante un token de Instagram caído.
  const status = failures > 0 ? 207 : 200;
  return NextResponse.json(
    { processed: results.length, failures, results },
    { status },
  );
}
