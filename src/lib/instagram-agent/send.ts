import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelConnection, Contact, Conversation } from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { instagramAdapter } from '@/lib/channels/instagram/adapter';
import type { InstagramCampaign } from './types';
import { loadBrandContext } from './brand-context';
import { latestInbound, resolveIgReach } from './engagement';
import { claimCommentPrivateReply } from './private-reply-lock';
import { craftPersonalizedDM } from './personalize-dm';
import { loadIgProfile } from './profile-enrich';
import { resolveIgSegment, type LeadScore } from './segment';
import { proactiveGate, logProactiveSend, featureEnabled } from './controls';
import { loadStoreLinks } from './store-links';
import { recordProactiveDm } from './record-dm';
import { loadCustomerContext } from './customer-context';
import { loadProductBrain } from './product-brain';
import {
  getShopifyAdmin,
  ensureCampaignPriceRule,
  mintUniqueCode,
  parsePercent,
} from './discounts';

/**
 * Envía la tanda de DMs en cola de una campaña de Instagram.
 *
 * Usa instagramAdapter.sendText (Meta Graph, messaging_type=RESPONSE), que
 * solo está permitido dentro de la ventana de 24h tras una interacción del
 * usuario — justo el modelo del agente (responder a comentarios/historias/
 * DMs). El adapter no persiste en la BD; aquí solo actualizamos el estado del
 * recipient. La conversación entrante la materializa el webhook cuando la
 * persona responde (lo aprovecha la fase de captura).
 *
 * Debe llamarse con el cliente service-role (el cron no tiene sesión y hay
 * que leer connection.secrets).
 */
export async function sendCampaignBatch(
  db: SupabaseClient,
  campaign: Pick<InstagramCampaign, 'id' | 'workspace_id' | 'plan' | 'offer_code'> & {
    goal?: string | null;
    shopify_price_rule_id?: number | null;
    ai_agent_id?: string | null;
  },
  limit = 25,
): Promise<{
  sent: number;
  failed: number;
  remaining: number;
  skipped?: string;
}> {
  // 1) Conexiones de Instagram del workspace — TODAS. Con más de una cuenta
  //    conectada, cada DM debe salir por la cuenta con la que la persona
  //    interactuó (se resuelve por destinatario más abajo); la más reciente
  //    queda solo como fallback para filas sin conversación rastreable.
  const { data: connRows } = await db
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', campaign.workspace_id)
    .eq('channel', 'instagram')
    .neq('status', 'disconnected')
    .order('updated_at', { ascending: false });
  const igConns = (connRows ?? []) as ChannelConnection[];
  if (igConns.length === 0) {
    return { sent: 0, failed: 0, remaining: 0, skipped: 'instagram_not_connected' };
  }
  const connection = igConns[0];

  // El interruptor de "iniciar conversaciones": apagado, el worker no envía.
  if (!(await featureEnabled(db, campaign.workspace_id, 'outreach'))) {
    return { sent: 0, failed: 0, remaining: 0, skipped: 'outreach_disabled' };
  }

  // Trust gate: emergency pause + rolling-24h daily cap for the workspace.
  const gate = await proactiveGate(db, campaign.workspace_id);
  if (!gate.ok) {
    return { sent: 0, failed: 0, remaining: 0, skipped: gate.reason };
  }

  // 2) Recipients en cola con su contacto. Excluimos el grupo de control
  //    (holdout) y el spam; priorizamos por lead score (high primero).
  const { data: recipients } = await db
    .from('instagram_campaign_recipients')
    .select('id, contact_id, lead_score, contacts(id, external_id, name, opted_out)')
    .eq('campaign_id', campaign.id)
    .eq('status', 'queued')
    .eq('is_holdout', false)
    .eq('is_spam', false)
    .limit(limit * 4);

  type ContactJoin = {
    id: string;
    external_id: string | null;
    name: string | null;
    opted_out: boolean | null;
  };
  const allRows = (recipients ?? []) as unknown as Array<{
    id: string;
    contact_id: string | null;
    lead_score: string | null;
    contacts: ContactJoin | ContactJoin[] | null;
  }>;
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const ranked = allRows
    .slice()
    .sort((a, b) => (rank[a.lead_score ?? 'low'] ?? 3) - (rank[b.lead_score ?? 'low'] ?? 3))
    .slice(0, limit);

  // Suppress opt-outs (STOP / unsubscribe): honor the contact's request and
  // never DM them again — a hard compliance gate, before any code minting.
  const rows = ranked.filter((r) => {
    const c = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    return c?.opted_out !== true;
  });
  const suppressed = ranked.filter((r) => {
    const c = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
    return c?.opted_out === true;
  });
  for (const r of suppressed) {
    await db
      .from('instagram_campaign_recipients')
      .update({ status: 'skipped', error: 'opted_out' })
      .eq('id', r.id);
  }
  if (rows.length === 0) {
    return { sent: 0, failed: 0, remaining: 0 };
  }

  // Con varias cuentas IG conectadas: resolver por destinatario la cuenta con
  // la que interactuó (vía la conversación que el webhook ya atribuyó), para
  // que el DM salga por la identidad correcta. Una sola cuenta → sin costo.
  const connByContact =
    igConns.length > 1
      ? await resolveRecipientConnections(
          db,
          rows.map((r) => r.contact_id).filter((id): id is string => Boolean(id)),
          igConns,
        )
      : new Map<string, ChannelConnection>();

  // Brand voice + knowledge once per batch, from the SAME linked agent that
  // answers reactively, so every DM sounds on-brand and consistent.
  const brand = await loadBrandContext(db, campaign.workspace_id, campaign.ai_agent_id ?? null);
  // Enlaces reales de la tienda, una vez por tanda: sin ellos el modelo
  // escribía "[enlace de la tienda web]" y eso llegaba al cliente.
  const links = await loadStoreLinks(
    db,
    campaign.workspace_id,
    campaign.plan.recommended_products,
  );
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  const offer = campaign.plan.offer
    ? { code: campaign.plan.offer.code, discount: campaign.plan.offer.discount }
    : campaign.offer_code
      ? { code: campaign.offer_code, discount: '' }
      : null;

  // Per-user discount codes (Blueberry's "Code: Grace10"): mint a unique
  // Shopify code per recipient under one campaign price rule. Sequential,
  // because Shopify's Admin API rate-limits hard. Gated on a percentage
  // offer + Shopify connected; any failure leaves the shared code in place.
  const pct = parsePercent(campaign.plan.offer?.discount);
  const codeByRecipient = new Map<string, string>();
  if (pct && offer) {
    const shop = await getShopifyAdmin(db, campaign.workspace_id);
    if (shop) {
      const priceRuleId = await ensureCampaignPriceRule(db, campaign, shop.client);
      if (priceRuleId) {
        for (const r of rows) {
          const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
          if (!contact?.external_id) continue;
          const code = await mintUniqueCode(shop.client, priceRuleId, {
            name: contact.name,
            pct,
            recipientId: r.id,
          });
          if (code) {
            codeByRecipient.set(r.id, code);
            await db
              .from('instagram_campaign_recipients')
              .update({ discount_code: code })
              .eq('id', r.id);
          }
        }
      }
    }
  }

  // Craft a 1:1 DM per recipient IN PARALLEL (each grounded in the person's
  // own engagement + the brand voice + their own code). The model calls
  // dominate latency, so concurrency keeps a 25-person batch within seconds.
  type Prepared = {
    id: string;
    contact: { id: string; external_id: string } | null;
    text: string;
    /** Comment id when the only sanctioned route is a private reply. */
    commentId?: string;
    /** Set when the row must be skipped instead of sent (e.g. outside window). */
    skip?: string;
  };
  const prepared: Prepared[] = await Promise.all(
    rows.map(async (r): Promise<Prepared> => {
      const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
      if (!contact?.external_id) return { id: r.id, contact: null, text: '' };
      const inbound = await latestInbound(db, contact.id).catch(() => ({
        text: null,
        at: null,
      }));
      // How we're allowed to reach them right now. Most of a campaign audience
      // are COMMENTERS: their comment-author id isn't a messageable IGSID and a
      // comment doesn't open the 24h window, so a plain DM is rejected by Meta —
      // the sanctioned route is a private reply carrying the comment id (7 days).
      // Someone who actually DM'd us gets the richer free-form DM instead.
      const reach = await resolveIgReach(db, contact.id).catch(
        () => ({ kind: 'none', reason: 'no_engagement' }) as const,
      );
      if (reach.kind === 'none') {
        return {
          id: r.id,
          contact: { id: contact.id, external_id: contact.external_id },
          text: '',
          skip: reach.reason,
        };
      }
      const personalCode = codeByRecipient.get(r.id);
      const recipientOffer = personalCode
        ? { code: personalCode, discount: offer?.discount || (pct ? `${pct}%` : '') }
        : offer;
      // Who they are (enriched at their first DM) → segment → tailored tone/offer.
      const profile = await loadIgProfile(db, contact.id).catch(() => null);
      // Y quién es como clienta: a quien ya compró no se le vende de cero.
      const customer = await loadCustomerContext(db, contact.id);
      // El cerebro del producto del que habla (o el que la campaña destaca).
      const productBrain = await loadProductBrain(db, campaign.workspace_id, {
        text: inbound.text,
        preferTitles: campaign.plan.recommended_products,
      });
      const segment = resolveIgSegment({
        followsBusiness: profile?.follows_business,
        followerCount: profile?.follower_count,
        isVerified: profile?.is_verified,
        leadScore: (r.lead_score as LeadScore | null) ?? null,
      });
      const text = await craftPersonalizedDM({
        apiKey,
        base: campaign.plan.message.text,
        brand,
        links,
        customer: customer?.brief ?? null,
        product: productBrain?.brief ?? null,
        goal: campaign.goal ?? null,
        offer: recipientOffer,
        products: campaign.plan.recommended_products,
        name: contact.name,
        engagement: inbound.text,
        personaHint: profile?.persona_hint ?? null,
        openerHint: profile?.opener_hint ?? null,
        followsBusiness: profile?.follows_business ?? null,
        isVerified: profile?.is_verified ?? null,
        segment,
      });
      return {
        id: r.id,
        contact: { id: contact.id, external_id: contact.external_id },
        text,
        commentId: reach.kind === 'private_reply' ? reach.commentId : undefined,
      };
    }),
  );

  let sent = 0;
  let failed = 0;

  // Send sequentially (don't hammer the Meta API in parallel).
  for (const p of prepared) {
    if (p.skip) {
      await db
        .from('instagram_campaign_recipients')
        .update({ status: 'skipped', error: p.skip })
        .eq('id', p.id);
      continue;
    }
    if (!p.contact) {
      await db
        .from('instagram_campaign_recipients')
        .update({ status: 'skipped', error: 'contacto sin external_id de Instagram' })
        .eq('id', p.id);
      continue;
    }

    // One private reply per comment across BOTH systems (comment-to-DM rules
    // and the campaign engine): claim the shared lock first. If the other path
    // already answered this comment, skip instead of letting Meta reject us.
    if (p.commentId) {
      const won = await claimCommentPrivateReply(
        db,
        campaign.workspace_id,
        p.commentId,
        'campaign',
      );
      if (!won) {
        await db
          .from('instagram_campaign_recipients')
          .update({ status: 'skipped', error: 'comment ya respondido' })
          .eq('id', p.id)
          .eq('status', 'queued');
        continue;
      }
    }

    // Atomically CLAIM the row (queued → sent) BEFORE sending. The real-time
    // path can claim+send the same recipient concurrently; without this guard
    // both would send and the person gets two DMs. If the claim affects no
    // rows, the other path already took it — skip.
    const { data: claimed } = await db
      .from('instagram_campaign_recipients')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        error: null,
        ...(p.commentId ? { source_comment_id: p.commentId } : {}),
      })
      .eq('id', p.id)
      .eq('status', 'queued')
      .select('id');
    if (!(claimed as Array<{ id: string }> | null)?.length) continue;

    try {
      await instagramAdapter.sendText({
        channel: 'instagram',
        connection: connByContact.get(p.contact.id) ?? connection,
        // El adapter de Instagram no usa `conversation` para enviar; basta
        // con un objeto mínimo para satisfacer el contrato del tipo.
        conversation: { id: '' } as unknown as Conversation,
        contact: { id: p.contact.id, external_id: p.contact.external_id } as unknown as Contact,
        // Comment-sourced → private reply by comment id (their comment-author
        // id is not messageable and the 24h window is closed).
        commentId: p.commentId,
        text: p.text,
      } satisfies OutboundText);

      sent += 1;
      // Que quede en la bandeja: el comercio tiene que poder leer lo que su
      // agente le dijo a esta persona.
      await recordProactiveDm(db, {
        workspaceId: campaign.workspace_id,
        contactId: p.contact.id,
        externalId: p.contact.external_id,
        connection: connByContact.get(p.contact.id) ?? connection,
        text: p.text,
        origin: 'ig_outreach',
        originName: campaign.plan?.campaign_name ?? null,
      });
      await logProactiveSend(db, {
        workspaceId: campaign.workspace_id,
        campaignId: campaign.id,
        contactId: p.contact.id,
        kind: 'batch',
        text: p.text,
      });
    } catch (err) {
      await db
        .from('instagram_campaign_recipients')
        .update({
          status: 'failed',
          error: err instanceof Error ? err.message.slice(0, 500) : 'send failed',
        })
        .eq('id', p.id);
      failed += 1;
    }
  }

  // ¿Quedan más en cola (enviables) para la próxima vuelta del worker?
  const { count: remaining } = await db
    .from('instagram_campaign_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .eq('status', 'queued')
    .eq('is_holdout', false)
    .eq('is_spam', false);

  return { sent, failed, remaining: remaining ?? 0 };
}

/**
 * Cuenta IG real de cada contacto: su conversación más reciente (instagram o
 * ig_comment) ya lleva el connection_id que el webhook atribuyó al ingresar.
 * Si esa fila es la hermana ig_comment, se prefiere la fila instagram de la
 * MISMA cuenta (mismo external_account_id — comparten token); la hermana en sí
 * sirve de último recurso. Contactos sin conversación rastreable no entran al
 * mapa y caen al fallback del caller.
 */
async function resolveRecipientConnections(
  db: SupabaseClient,
  contactIds: string[],
  igConns: ChannelConnection[],
): Promise<Map<string, ChannelConnection>> {
  const out = new Map<string, ChannelConnection>();
  if (contactIds.length === 0) return out;

  const { data } = await db
    .from('conversations')
    .select('contact_id, connection_id, last_message_at')
    .in('contact_id', contactIds)
    .in('channel', ['instagram', 'ig_comment'])
    .not('connection_id', 'is', null)
    .order('last_message_at', { ascending: false });
  const newestConnByContact = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ contact_id: string; connection_id: string }>) {
    if (!newestConnByContact.has(row.contact_id)) {
      newestConnByContact.set(row.contact_id, row.connection_id);
    }
  }
  if (newestConnByContact.size === 0) return out;

  const byId = new Map<string, ChannelConnection>(igConns.map((c) => [c.id, c]));
  const missing = [...new Set(newestConnByContact.values())].filter((id) => !byId.has(id));
  if (missing.length > 0) {
    const { data: extra } = await db
      .from('channel_connections')
      .select('*')
      .in('id', missing);
    for (const c of (extra ?? []) as ChannelConnection[]) byId.set(c.id, c);
  }

  for (const [contactId, connId] of newestConnByContact) {
    const src = byId.get(connId);
    if (!src) continue;
    if (src.channel === 'instagram') {
      out.set(contactId, src);
      continue;
    }
    const sibling = igConns.find(
      (c) => String(c.external_account_id ?? '') === String(src.external_account_id ?? ''),
    );
    out.set(contactId, sibling ?? src);
  }
  return out;
}
