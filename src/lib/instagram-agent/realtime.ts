import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { instagramAdapter } from '@/lib/channels/instagram/adapter';
import { coercePlan, type InstagramPlan } from './types';
import { loadBrandContext, brandBrief, type BrandContext } from './brand-context';
import { craftPersonalizedDM } from './personalize-dm';
import { scoreLeads, type LeadScore } from './lead-scoring';
import { pickModel } from './model';
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
}

type ContactLite = { id: string; external_id: string | null; name: string | null };

async function newestActiveCampaign(
  db: SupabaseClient,
  workspaceId: string,
): Promise<ActiveCampaign | null> {
  const { data } = await db
    .from('instagram_campaigns')
    .select('id, workspace_id, goal, plan, offer_code, shopify_price_rule_id, holdout_pct')
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
    engagementText: string | null;
  },
): Promise<void> {
  if (!opts.contact.external_id) return;
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
        status: 'queued',
        is_holdout: isHoldout,
      },
      { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true },
    )
    .select('id');
  const recipientId = (upserted as Array<{ id: string }> | null)?.[0]?.id;
  if (!recipientId) return; // already contacted by this campaign
  if (isHoldout) return; // control group: enrolled as baseline, no DM

  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;

  // Spam / intent gate on what they actually said.
  let leadScore: LeadScore = 'medium';
  if (apiKey && opts.engagementText) {
    try {
      const [s] = await scoreLeads(apiKey, [opts.engagementText]);
      if (s?.spam) {
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
  void leadScore;

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

  const brand = await loadBrandContext(db, opts.workspaceId);
  const text = await craftPersonalizedDM({
    apiKey,
    base: campaign.plan.message.text,
    brand,
    goal: campaign.goal,
    offer,
    products: campaign.plan.recommended_products,
    name: opts.contact.name,
    engagement: opts.engagementText,
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
      text,
    } satisfies OutboundText);
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
- Máximo 480 caracteres, 0 a 2 emojis, UNA sola llamada a la acción.
- Devuelve SOLO el texto del DM, sin comillas ni explicaciones.`;

async function generateCloserReply(input: {
  apiKey: string;
  plan: InstagramPlan;
  brand: BrandContext | null;
  goal: string | null;
  offer: { code: string; discount: string } | null;
  name: string | null;
  inbound: string | null;
  leadScore: LeadScore | null;
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
    `Nombre: ${first ?? '(desconocido)'}`,
    `SU RESPUESTA (responde a esto y cierra): ${
      input.inbound ? `"${input.inbound.slice(0, 500).replace(/\s+/g, ' ').trim()}"` : '(sin texto)'
    }`,
    '',
    'Escribe el DM de cierre.',
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const client = new Anthropic({ apiKey: input.apiKey });
    const res = await client.messages.create({
      model: pickModel('close', { leadScore: input.leadScore ?? 'medium' }),
      max_tokens: 400,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: CLOSE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    });
    let text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
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
    .select('id, status, goal, plan, offer_code')
    .eq('id', rec.campaign_id)
    .maybeSingle();
  const camp = campRow as
    | { id: string; status: string; goal: string | null; plan: unknown; offer_code: string | null }
    | null;
  if (!camp || camp.status !== 'active') return false;
  const plan = coercePlan(camp.plan);
  if (!plan) return false;

  // Mark replied inline (faster than waiting for the cron's capture pass).
  await db
    .from('instagram_campaign_recipients')
    .update({ status: 'replied', replied_at: new Date().toISOString() })
    .eq('id', rec.id);

  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  // We "handled" this contact even if we can't actually reply, so the generic
  // assistant doesn't also fire with no campaign context.
  if (!apiKey || !opts.contact.external_id) return true;

  const brand = await loadBrandContext(db, opts.workspaceId);
  const offer = rec.discount_code
    ? { code: rec.discount_code, discount: plan.offer?.discount ?? '' }
    : offerFrom({ plan, offer_code: camp.offer_code });

  const reply = await generateCloserReply({
    apiKey,
    plan,
    brand,
    goal: camp.goal,
    offer,
    name: opts.contact.name,
    inbound: opts.inboundText,
    leadScore: rec.lead_score,
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
    } catch {
      /* swallow — the recipient is already marked replied */
    }
  }
  return true;
}
