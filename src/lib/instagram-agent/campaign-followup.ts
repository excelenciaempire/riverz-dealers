import type { SupabaseClient } from '@supabase/supabase-js';
import { coercePlan } from './types';

/**
 * El seguimiento que el plan de campaña prometía y nadie enviaba.
 *
 * El plan genera un "Seguimiento si no responden" y la UI lo muestra, pero no
 * existía ningún camino que lo mandara. Construir un motor de seguimientos
 * aparte habría duplicado el que Riverz ya tiene (`/api/cron/ai-followups`,
 * que sabe de rachas de silencio, topes por agente, ventana de 24h de Meta y
 * horarios): en vez de eso, cuando ese motor va a seguir a alguien que está en
 * una campaña de Instagram viva, le pasamos QUÉ decir según el plan.
 *
 * Devuelve null cuando la persona no pertenece a ninguna campaña viva o el
 * plan no definió seguimiento.
 */
export async function campaignFollowUpHint(
  db: SupabaseClient,
  contactId: string,
): Promise<string | null> {
  const { data } = await db
    .from('instagram_campaign_recipients')
    .select(
      'discount_code, instagram_campaigns(name, goal, plan, offer_code, status)',
    )
    .eq('contact_id', contactId)
    .in('status', ['sent', 'replied'])
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  type CampRow = {
    name: string;
    goal: string | null;
    plan: unknown;
    offer_code: string | null;
    status: string;
  };
  const row = data as {
    discount_code: string | null;
    instagram_campaigns: CampRow | CampRow[] | null;
  };
  const camp = Array.isArray(row.instagram_campaigns)
    ? row.instagram_campaigns[0]
    : row.instagram_campaigns;
  if (!camp || camp.status !== 'active') return null;

  const plan = coercePlan(camp.plan);
  const followUp = plan?.follow_up?.trim();
  if (!followUp) return null;

  const code = row.discount_code || camp.offer_code;
  const lines = [
    `SEGUIMIENTO DE CAMPAÑA — esta persona entró por la campaña "${camp.name}"${
      camp.goal ? ` (objetivo: ${camp.goal})` : ''
    }.`,
    `La idea del seguimiento planificado es: "${followUp}"`,
    'Escríbelo con tus palabras y en tu voz, enganchado a lo último que hablaron; no lo copies literal.',
  ];
  if (code) lines.push(`Su código de oferta sigue disponible: ${code}.`);
  return lines.join('\n');
}
