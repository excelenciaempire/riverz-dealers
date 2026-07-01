import type { SupabaseClient } from '@supabase/supabase-js';
import { completeText, hasLlm } from '@/lib/ai/llm-client';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { instagramAdapter } from '@/lib/channels/instagram/adapter';
import { coercePlan, type InstagramPlan } from './types';
import { loadBrandContext, brandBrief, type BrandContext } from './brand-context';
import { craftPersonalizedDM } from './personalize-dm';
import { scoreLeads, type LeadScore } from './lead-scoring';
import { resolveIgAgent, needsApproval } from './agent-link';
import { claimCommentPrivateReply } from './private-reply-lock';
import { loadIgProfile } from './profile-enrich';
import { resolveIgSegment } from './segment';
import { setCommentHidden } from '@/lib/channels/comment-moderation';
import { proactiveGate, logProactiveSend } from './controls';
import { limitByKey } from '@/lib/rate-limit';
import {
  getShopifyAdmin,
  ensureCampaignPriceRule,
  mintUniqueCode,
  parsePercent,
} from './discounts';

/**
 * Real-time loop — the Blueberry behavior that batch sending can't give:
 *   - maybeInstantOutreach: someone engages (comments) → within seconds they
 *     get enrolled in the active campaign and a personalized DM goes out at
 *     peak intent.
 *   - maybeRunCloser: a campaign recipient replies → the agent answers,
 *     handles the objection and pushes the sale with their own code, instead
 *     of falling to the generic assistant with no campaign context.
 *
 * Both are fire-and-forget from the inbox ingest path and degrade gracefully
 * (no active campaign / no model / Shopify down → no-op).
 */

interface ActiveCampaign {
  id: string;
  workspace_id: string;
  goal: string | null;
  plan: InstagramPlan;
  offer_code: string | null;
  shopify_price_rule_id: number | null;
  holdout_pct: number;
  /** The linked agent (brand voice + automation mode); null = freshest active. */
  ai_agent_id: string | null;
}

type ContactLite = { id: string; external_id: string | null; name: string | null };

async function newestActiveCampaign(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ActiveCampaign | null> {
  const { data } = await db
    .from('instagram_campaigns')
    .select('id, workspace_id, goal, plan, offer_code, shopify_price_rule_id, holdout_pct, ai_agent_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('launched_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as Omit<ActiveCampaign, 'plan'> & { plan: unknown };
  const plan = coercePlan(row.plan);
  if (!plan) return null;
  return { ...row, plan };
}

/** Has this contact asked to stop receiving messages? (compliance gate) */
async function isOptedOut(db: SupabaseClient, contactId: string): Promise<boolean> {
  const { data } = await db
    .from('contacts')
    .select('opted_out')
    .eq('id', contactId)
    .maybeSingle();
  return (data as { opted_out?: boolean } | null)?.opted_out === true;
}

async function igConnection(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ChannelConnection | null> {
  const { data } = await db
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', 'instagram')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ChannelConnection) ?? null;
}

function offerFrom(
  campaign: Pick<ActiveCampaign, 'plan' | 'offer_code'>,
): { code: string; discount: string } | null {
  if (campaign.plan.offer) {
    return { code: campaign.plan.offer.code, discount: campaign.plan.offer.discount };
  }
  return campaign.offer_code ? { code: campaign.offer_code, discount: '' } : null;
}

/**
 * Someone just engaged (an Instagram comment). Enroll them in the active
 * campaign and send a personalized DM right now, within Meta's response
 * window — peak intent. Idempotent: a person already in the campaign is not
 * re-contacted.
 */
export async function maybeInstantOutreach(
  db: SupabaseClient,
  opts: {
    workspaceId: string;
    contact: ContactLite;
    sourcePostId?: string | null;
    /** The comment id, so we can DM as a private reply (required for
     *  comment-sourced contacts whose external_id isn't messageable). */
    commentId?: string | null;
    engagementText: string | null;
  },
): Promise<void> {
  if (!opts.contact.external_id) return;
  // Respect opt-out — never re-engage a contact who asked to stop.
  if (await isOptedOut(db, opts.contact.id)) return;
  const campaign = await newestActiveCampaign(db, opts.workspaceId);
  if (!campaign) return;

  // Enroll (idempotent on campaign_id+contact_id). A returned row means we
  // inserted it now → first contact; empty means they were already enrolled.
  const isHoldout =
    campaign.holdout_pct > 0 && Math.random() * 100 < campaign.holdout_pct;
  const { data: upserted } = await db
    .from('instagram_campaign_recipients')
    .upsert(
      {
        campaign_id: campaign.id,
        contact_id: opts.contact.id,
        source_external_id: opts.contact.external_id,
        source_post_id: opts.sourcePostId ?? null,
        // Keep the comment id so an approval can still be delivered as a
        // private reply (Meta allows one per comment within ~7 days).
        source_comment_id: opts.commentId ?? null,
        status: 'queued',
        is_holdout: isHoldout,
      },
      { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true },
    )
    .select('id');
  const recipientId = (upserted as Array<{ id: string }> | null)?.[0]?.id;
  if (!recipientId) return; // already contacted by this campaign
  if (isHoldout) return; // control group: enrolled as baseline, no DM

  // Throttle the EXPENSIVE part (score + craft + DM + Shopify mint), not the
  // enroll — a viral post with hundreds of fresh commenters shouldn't fan out
  // unbounded LLM/Meta/Shopify calls. Over the cap, the row stays 'queued' and
  // the cron worker drains it at its own controlled pace, so no one is lost.
  const gate = await limitByKey(`ig-instant:${opts.workspaceId}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!gate.success) return;

  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  // Spam / intent gate on what they actually said.
  let leadScore: LeadScore = 'medium';
  if (hasLlm(apiKey) && opts.engagementText) {
    try {
      const [s] = await scoreLeads(apiKey, [opts.engagementText]);
      if (s?.spam) {
        // Auto-hide spam/hate on the merchant's own post — sanctioned API,
        // best-effort (degrades if instagram_manage_comments isn't granted yet).
        if (opts.commentId) {
          const conn = await igConnection(db, opts.workspaceId);
          if (conn) await setCommentHidden(conn, 'ig_comment', opts.commentId);
        }
        await db
          .from('instagram_campaign_recipients')
          .update({
            status: 'skipped',
            is_spam: true,
            error: 'spam/hate',
            lead_score: s.score,
            lead_sentiment: s.sentiment,
          })
          .eq('id', recipientId);
        return;
      }
      if (s) {
        leadScore = s.score;
        await db
          .from('instagram_campaign_recipients')
          .update({ lead_score: s.score, lead_sentiment: s.sentiment })
          .eq('id', recipientId);
      }
    } catch {
      /* proceed unscored */
    }
  }
  // Automation level of the linked agent (their in-app setting): auto |
  // hybrid_intent | approval — always within Meta policy, this decides whether
  // the DM goes out now or waits for a human. Brand voice comes from the SAME
  // linked agent, so proactive copy matches the reactive assistant.
  const agent = await resolveIgAgent(db, opts.workspaceId, campaign.ai_agent_id);
  const brand = await loadBrandContext(db, opts.workspaceId, agent.id);

  // Who they are → segment → tailored tone/offer. Comment-only contacts aren't
  // Profile-API-eligible yet, so profile is usually null here (segment falls
  // back to intent); the rich signals kick in once they DM.
  const profile = await loadIgProfile(db, opts.contact.id).catch(() => null);
  const segment = resolveIgSegment({
    followsBusiness: profile?.follows_business,
    followerCount: profile?.follower_count,
    isVerified: profile?.is_verified,
    leadScore,
  });
  const personaFields = {
    personaHint: profile?.persona_hint ?? null,
    followsBusiness: profile?.follows_business ?? null,
    isVerified: profile?.is_verified ?? null,
    segment,
  };

  if (needsApproval(agent.proactive_send_mode, leadScore)) {
    // Human-approval mode: draft the DM and hold it for review. Don't send and
    // don't claim the per-comment reply lock yet — that happens on approval.
    const draft = await craftPersonalizedDM({
      apiKey,
      base: campaign.plan.message.text,
      brand,
      goal: campaign.goal,
      offer: offerFrom(campaign),
      products: campaign.plan.recommended_products,
      name: opts.contact.name,
      engagement: opts.engagementText,
      ...personaFields,
    });
    await db
      .from('instagram_campaign_recipients')
      .update({ status: 'pending_review', draft_text: draft })
      .eq('id', recipientId)
      .eq('status', 'queued');
    return;
  }

  // Trust gate: emergency pause + rolling-24h daily cap. If blocked, leave the
  // recipient queued (the cron is gated too) so nothing is lost, just deferred.
  const trust = await proactiveGate(db, opts.workspaceId);
  if (!trust.ok) return;

  // Auto mode. One private reply per comment across BOTH systems: claim the
  // shared lock first; if the comment-to-DM engine already replied, skip.
  if (opts.commentId) {
    const won = await claimCommentPrivateReply(
      db,
      opts.workspaceId,
      opts.commentId,
      'campaign',
    );
    if (!won) {
      await db
        .from('instagram_campaign_recipients')
        .update({ status: 'skipped', error: 'comment ya respondido' })
        .eq('id', recipientId)
        .eq('status', 'queued');
      return;
    }
  }

  // Claim atomically so the cron worker can't also send this row.
  const { data: claimed } = await db
    .from('instagram_campaign_recipients')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', recipientId)
    .eq('status', 'queued')
    .select('id');
  if (!(claimed as Array<{ id: string }> | null)?.length) return; // lost the race

  const connection = await igConnection(db, opts.workspaceId);
  if (!connection) {
    await db
      .from('instagram_campaign_recipients')
      .update({ status: 'queued', sent_at: null })
      .eq('id', recipientId);
    return;
  }

  // Per-user discount code (best-effort).
  let offer = offerFrom(campaign);
  const pct = parsePercent(campaign.plan.offer?.discount);
  if (pct) {
    const shop = await getShopifyAdmin(db, opts.workspaceId);
    if (shop) {
      const priceRuleId = await ensureCampaignPriceRule(db, campaign, shop.client);
      if (priceRuleId) {
        const code = await mintUniqueCode(shop.client, priceRuleId, {
          name: opts.contact.name,
          pct,
          recipientId,
        });
        if (code) {
          offer = { code, discount: offer?.discount || `${pct}%` };
          await db
            .from('instagram_campaign_recipients')
            .update({ discount_code: code })
            .eq('id', recipientId);
        }
      }
    }
  }

  const text = await craftPersonalizedDM({
    apiKey,
    base: campaign.plan.message.text,
    brand,
    goal: campaign.goal,
    offer,
    products: campaign.plan.recommended_products,
    name: opts.contact.name,
    engagement: opts.engagementText,
    ...personaFields,
  });

  try {
    await instagramAdapter.sendText({
      channel: 'instagram',
      connection,
      conversation: { id: '' } as unknown as Conversation,
      contact: {
        id: opts.contact.id,
        external_id: opts.contact.external_id,
      } as unknown as Contact,
      // Comment-sourced → private reply by comment id (the user's
      // comment-author id is not a messageable IGSID).
      commentId: opts.commentId ?? undefined,
      text,
    } satisfies OutboundText);
    await logProactiveSend(db, {
      workspaceId: opts.workspaceId,
      campaignId: campaign.id,
      contactId: opts.contact.id,
      kind: 'outreach',
      text,
    });
  } catch (err) {
    await db
      .from('instagram_campaign_recipients')
      .update({
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 500) : 'send failed',
      })
      .eq('id', recipientId);
  }
}

const CLOSE_SYSTEM = `Eres un vendedor por DM de Instagram de una marca B2C. La persona ya recibió un primer DM de una campaña y AHORA te respondió. Tu trabajo: avanzar la venta en UN mensaje.

Reglas:
- Responde su pregunta u objeción de forma concreta.
- Recomienda el producto correcto del contexto (no inventes nada fuera de él).
- Cierra con su código de descuento (si lo hay) y un siguiente paso claro (el link o "te paso el link").
- Voz de marca, cálido, natural. Nunca admitas ser IA.
- Nunca digas ni insinúes que revisaste su perfil o sus fotos; usa cualquier pista solo para el tono. Adapta tono y oferta al segmento.
- Máximo 480 caracteres, 0 a 2 emojis, UNA sola llamada a la acción.
- Devuelve SOLO el texto del DM, sin comillas ni explicaciones.`;

async function generateCloserReply(input: {
  apiKey: string | null;
  plan: InstagramPlan;
  brand: BrandContext | null;
  goal: string | null;
  offer: { code: string; discount: string } | null;
  name: string | null;
  inbound: string | null;
  leadScore: LeadScore | null;
  personaHint?: string | null;
  followsBusiness?: boolean | null;
  segment?: { label: string; toneHint: string; offerHint: string } | null;
}): Promise<string | null> {
  const first = (input.name ?? '').trim().split(/\s+/)[0] || null;
  const userPrompt = [
    brandBrief(input.brand),
    input.goal ? `OBJETIVO DE LA CAMPAÑA:\n${input.goal}` : '',
    input.plan.recommended_products.length
      ? `PRODUCTOS: ${input.plan.recommended_products.join(', ')}`
      : '',
    input.offer?.code
      ? `OFERTA: código ${input.offer.code}${input.offer.discount ? ` (${input.offer.discount})` : ''}`
      : 'OFERTA: ninguna',
    `PRIMER DM QUE LE ENVIAMOS (contexto): ${input.plan.message.text}`,
    input.segment
      ? `SEGMENTO: ${input.segment.label} → tono: ${input.segment.toneHint}; oferta: ${input.segment.offerHint}`
      : '',
    `Nombre: ${first ?? '(desconocido)'}`,
    input.followsBusiness != null
      ? `Relación: ${input.followsBusiness ? 'ya te sigue' : 'aún no te sigue'}`
      : '',
    input.personaHint
      ? `Pista de perfil (SOLO para el tono; no digas que viste su perfil): ${input.personaHint}`
      : '',
    `SU RESPUESTA (responde a esto y cierra): ${
      input.inbound ? `"${input.inbound.slice(0, 500).replace(/\s+/g, ' ').trim()}"` : '(sin texto)'
    }`,
    '',
    'Escribe el DM de cierre.',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const text = (
      await completeText({
        // Hot lead → top model to close; the rest, triage.
        tier: input.leadScore === 'high' ? 'premium' : 'triage',
        system: CLOSE_SYSTEM,
        user: userPrompt,
        maxTokens: 400,
        anthropicKey: input.apiKey,
        effort: 'low',
      })
    )
      .trim()
      .replace(/^["'“”]|["'“”]$/g, '')
      .trim();
    if (!text) return null;
    return text.slice(0, 950);
  } catch {
    return null;
  }
}

/**
 * A campaign recipient replied. If so, answer + close in the campaign's
 * context and return true (so the caller suppresses the generic assistant).
 * Returns false when this contact isn't a live campaign recipient.
 */
export async function maybeRunCloser(
  db: SupabaseClient,
  opts: {
    workspaceId: string;
    contact: ContactLite;
    connection: ChannelConnection;
    inboundText: string | null;
  },
): Promise<boolean> {
  const { data: recRow } = await db
    .from('instagram_campaign_recipients')
    .select('id, status, discount_code, lead_score, campaign_id')
    .eq('contact_id', opts.contact.id)
    .in('status', ['sent', 'replied'])
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const rec = recRow as
    | {
        id: string;
        status: string;
        discount_code: string | null;
        lead_score: LeadScore | null;
        campaign_id: string;
      }
    | null;
  if (!rec) return false;

  const { data: campRow } = await db
    .from('instagram_campaigns')
    .select('id, status, goal, plan, offer_code, ai_agent_id')
    .eq('id', rec.campaign_id)
    .maybeSingle();
  const camp = campRow as
    | {
        id: string;
        status: string;
        goal: string | null;
        plan: unknown;
        offer_code: string | null;
        ai_agent_id: string | null;
      }
    | null;
  if (!camp || camp.status !== 'active') return false;
  const plan = coercePlan(camp.plan);
  if (!plan) return false;

  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  // If we genuinely can't close (no model / no messageable id), DON'T claim
  // this DM — return false so the generic assistant answers instead of the
  // customer getting silence.
  if (!hasLlm(apiKey) || !opts.contact.external_id) return false;
  // Respect opt-out — hand back to the generic assistant rather than push a sale.
  if (await isOptedOut(db, opts.contact.id)) return false;

  // Mark replied inline (faster than waiting for the cron's capture pass).
  await db
    .from('instagram_campaign_recipients')
    .update({ status: 'replied', replied_at: new Date().toISOString() })
    .eq('id', rec.id);

  const brand = await loadBrandContext(db, opts.workspaceId, camp.ai_agent_id);
  const offer = rec.discount_code
    ? { code: rec.discount_code, discount: plan.offer?.discount ?? '' }
    : offerFrom({ plan, offer_code: camp.offer_code });

  // They DM'd → enriched. Segment + persona tune the close.
  const profile = await loadIgProfile(db, opts.contact.id).catch(() => null);
  const segment = resolveIgSegment({
    followsBusiness: profile?.follows_business,
    followerCount: profile?.follower_count,
    isVerified: profile?.is_verified,
    leadScore: rec.lead_score,
  });
  const reply = await generateCloserReply({
    apiKey,
    plan,
    brand,
    goal: camp.goal,
    offer,
    name: opts.contact.name,
    inbound: opts.inboundText,
    leadScore: rec.lead_score,
    personaHint: profile?.persona_hint ?? null,
    followsBusiness: profile?.follows_business ?? null,
    segment,
  });
  if (reply) {
    try {
      await instagramAdapter.sendText({
        channel: 'instagram',
        connection: opts.connection,
        conversation: { id: '' } as unknown as Conversation,
        contact: {
          id: opts.contact.id,
          external_id: opts.contact.external_id,
        } as unknown as Contact,
        text: reply,
      } satisfies OutboundText);
      await logProactiveSend(db, {
        workspaceId: opts.workspaceId,
        campaignId: camp.id,
        contactId: opts.contact.id,
        kind: 'closer',
        text: reply,
      });
    } catch {
      /* swallow — the recipient is already marked replied */
    }
  }
  return true;
}
