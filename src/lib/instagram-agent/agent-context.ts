import type { SupabaseClient } from '@supabase/supabase-js';
import { loadIgProfile } from './profile-enrich';
import { resolveIgSegment, type LeadScore } from './segment';

/**
 * "One brain" — a compact Instagram context block for the REACTIVE agent's
 * system prompt, so when a person we already understand writes in, the agent
 * answers knowing who they are (segment, persona, follow relationship) and which
 * live campaign/offer includes them — instead of replying blind. The same brand
 * identity across proactive + reactive.
 *
 * Returns null when there's nothing worth injecting. Only called for the
 * Instagram channel (gated by the caller), so it never pollutes WhatsApp/email.
 * Guardrail: the block instructs the agent to use this only to calibrate tone,
 * never to claim it looked at the person's profile.
 */
export async function loadInstagramContext(
  db: SupabaseClient,
  contactId: string,
): Promise<string | null> {
  const profile = await loadIgProfile(db, contactId).catch(() => null);

  // Latest campaign membership → lead score + live offer code.
  const { data: recRow } = await db
    .from('instagram_campaign_recipients')
    .select('lead_score, discount_code, instagram_campaigns(name, offer_code, status)')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const rec = recRow as {
    lead_score: LeadScore | null;
    discount_code: string | null;
    instagram_campaigns:
      | { name: string; offer_code: string | null; status: string }
      | { name: string; offer_code: string | null; status: string }[]
      | null;
  } | null;
  const camp = rec
    ? Array.isArray(rec.instagram_campaigns)
      ? rec.instagram_campaigns[0]
      : rec.instagram_campaigns
    : null;

  if (!profile && !camp) return null;

  const segment = resolveIgSegment({
    followsBusiness: profile?.follows_business,
    followerCount: profile?.follower_count,
    isVerified: profile?.is_verified,
    leadScore: rec?.lead_score ?? null,
  });

  const lines: string[] = [
    'CONTEXTO DE INSTAGRAM (úsalo SOLO para calibrar tono y oferta; NUNCA digas ni insinúes que viste su perfil):',
    `- Segmento: ${segment.label} → ${segment.toneHint}; oferta: ${segment.offerHint}`,
  ];
  if (profile?.follows_business) lines.push('- Ya te sigue en Instagram.');
  if (profile?.is_verified) lines.push('- Cuenta verificada / figura pública.');
  if (profile?.follower_count)
    lines.push(`- Seguidores: ${profile.follower_count.toLocaleString('es')}.`);
  if (profile?.persona_hint)
    lines.push(`- Intereses (de su perfil): ${profile.persona_hint}.`);

  if (camp && (camp.status === 'active' || camp.status === 'paused')) {
    lines.push(`- Está en la campaña activa "${camp.name}".`);
    const code = rec?.discount_code || camp.offer_code;
    if (code) lines.push(`- Su código de oferta disponible: ${code}.`);
  }

  return lines.join('\n');
}
