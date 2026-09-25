import { NextResponse } from 'next/server';
import { assertCronAuth } from '@/lib/auth/cron';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { sendCampaignBatch } from '@/lib/instagram-agent/send';
import { scoreCampaignRecipients } from '@/lib/instagram-agent/lead-scoring';
import { replyToComments } from '@/lib/instagram-agent/comment-reply';
import { detectRepliesAndCapture } from '@/lib/instagram-agent/capture';
import { attributeAndRollup } from '@/lib/instagram-agent/attribution';
import { coercePlan, type InstagramCampaign } from '@/lib/instagram-agent/types';
import { puedeUsarIa } from '@/lib/wallet/puerta';
import { withCronRun } from "@/lib/cron/heartbeat";

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
async function cronHandler(request: Request) {
  try {
    assertCronAuth(request, 'AUTOMATION_CRON_SECRET');
  } catch (r) {
    if (r instanceof Response) return r;
    throw r;
  }

  const db = supabaseAdmin();

  const { data: campaigns, error } = await db
    .from('instagram_campaigns')
    .select('id, workspace_id, goal, plan, offer_code, shopify_price_rule_id, status, launched_at, ai_agent_id')
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
      'id' | 'workspace_id' | 'goal' | 'offer_code' | 'status' | 'launched_at'
    > & {
      plan: unknown;
      shopify_price_rule_id: number | null;
      ai_agent_id: string | null;
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
      goal: raw.goal,
      plan,
      offer_code: raw.offer_code,
      shopify_price_rule_id: raw.shopify_price_rule_id,
      ai_agent_id: raw.ai_agent_id,
    };

    try {
      // Puntuar y redactar cada DM se cobra: la cuenta que no puede usar la
      // IA —sin pagar o sin saldo— no envía. Lo que sigue no gasta y corre igual.
      const conIa = await puedeUsarIa(db, raw.workspace_id);
      // Lead scoring + supresión de spam antes de enviar (prioriza alta
      // intención, descarta spam/hate).
      const score = conIa ? await scoreCampaignRecipients(db, raw.id) : { scored: 0, spam: 0 };
      const send = conIa
        ? await sendCampaignBatch(db, campaign)
        : { sent: 0, failed: 0, remaining: 0, skipped: 'sin_ia' };
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
      // Sin IA no es una falla del cron: es una cuenta que no puede gastar.
      const skipped = (send as { skipped?: string }).skipped;
      if (skipped && skipped !== 'sin_ia') failures += 1;
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

/** Registra la corrida en cron_runs con duración y resultado reales. */
export const GET = withCronRun("instagram-agent", cronHandler);
