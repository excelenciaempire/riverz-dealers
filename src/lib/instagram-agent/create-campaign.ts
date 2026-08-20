import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveIgAgent } from './agent-link';
import type { InstagramPlan } from './types';

/**
 * Guardar un plan como campaña en borrador.
 *
 * Vivía dentro del POST de /api/ai/instagram-agent/campaigns, así que era la
 * pantalla la única que sabía crear una campaña: quién la firma, con qué voz
 * habla y cuánta gente queda de control. El chat agéntico necesita exactamente
 * lo mismo, y volver a escribirlo del otro lado hubiera dejado dos campañas
 * distintas según de dónde se creó.
 */

export interface NuevaCampana {
  workspaceId: string;
  /** Usuario que la crea, cuando hay uno. El cron y el MCP no tienen. */
  createdBy?: string | null;
  goal: string;
  plan: InstagramPlan;
  /**
   * Llega crudo (del body HTTP o de un modelo), por eso `unknown`: la
   * validación es la misma para los dos y vive acá.
   */
  holdoutPct?: unknown;
  /** Agente explícito; sin él manda el que ya atiende Instagram. */
  agentId?: string | null;
}

/**
 * % de la audiencia que NO recibe el mensaje y sirve de línea base.
 *
 * Es lo que permite decir "esto vendió X de más" en vez de atribuir todo lo que
 * pasó después. La columna sólo acepta 0–50, así que un valor fuera de rango
 * haría fallar el insert entero en vez de guardarse acotado.
 */
export function clampHoldoutPct(value: unknown): number {
  return Math.max(0, Math.min(50, Math.round(Number(value ?? 10)) || 0));
}

export async function createCampaignDraft(
  db: SupabaseClient,
  input: NuevaCampana,
): Promise<{ id: string; name: string; holdout_pct: number; ai_agent_id: string | null }> {
  // La campaña la gobierna el agente cuya voz ya contesta en Instagram: los DMs
  // proactivos y las respuestas del día a día tienen que sonar a la misma
  // persona. Explícito si lo mandan; si no, el que atiende el canal.
  const agent = await resolveIgAgent(db, input.workspaceId, input.agentId ?? null);
  const holdoutPct = clampHoldoutPct(input.holdoutPct);

  const { data, error } = await db
    .from('instagram_campaigns')
    .insert({
      workspace_id: input.workspaceId,
      created_by: input.createdBy ?? null,
      name: input.plan.campaign_name.slice(0, 160),
      goal: input.goal.slice(0, 2000),
      // Nace en borrador SIEMPRE. Guardar un plan y empezar a escribirle a
      // gente son dos decisiones distintas, y la segunda es `launchCampaign`.
      status: 'draft',
      plan: input.plan,
      offer_code: input.plan.offer?.code ?? null,
      holdout_pct: holdoutPct,
      ai_agent_id: agent.id,
      metrics: {},
    })
    .select('id, name')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'no se pudo crear la campaña');

  const row = data as { id: string; name: string };
  return { ...row, holdout_pct: holdoutPct, ai_agent_id: agent.id };
}
