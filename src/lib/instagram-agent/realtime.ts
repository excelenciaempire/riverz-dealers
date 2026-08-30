import type { SupabaseClient } from '@supabase/supabase-js';
import { completeText, hasLlm } from '@/lib/ai/llm-client';
import {
  salidaParaCliente,
  recortarSalida,
  prometeAveriguar,
} from '@/lib/ai/salida';
import {
  afirmaLoQueNoSabe,
  instruccionPara,
  mereceRespuesta,
  esCriticaPublica,
} from './merece-respuesta';
import type {
  ChannelConnection,
  Contact,
  Conversation,
  NeedsHumanReason,
} from '@/types';
import type { OutboundText } from '@/lib/channels/types';
import { instagramAdapter } from '@/lib/channels/instagram/adapter';
import { messengerAdapter } from '@/lib/channels/messenger/adapter';
import { getAdapter } from '@/lib/channels/registry';
import { coercePlan, type InstagramPlan } from './types';
import { loadBrandContext, brandBrief, type BrandContext } from './brand-context';
import { craftPersonalizedDM } from './personalize-dm';
import { composeSuperAgentReply } from '@/lib/ai/super-agent';
import { scoreLeads, type LeadScore } from './lead-scoring';
import {
  resolveIgAgent,
  igAgentCanAutoReply,
  commentAgentCanReply,
} from './agent-link';
import { claimCommentPrivateReply } from './private-reply-lock';
import { loadIgProfile } from './profile-enrich';
import { resolveIgSegment } from './segment';
import { setCommentHidden } from '@/lib/channels/comment-moderation';
import { puedeUsarIa } from '@/lib/wallet/puerta';
import { aplicarDesenlace } from '@/lib/ai/desenlace';
import { maybeRequestOptIn } from '@/lib/channels/marketing-optin';
import {
  proactiveGate,
  logProactiveSend,
  autoReplyCommentsEnabled,
  featureEnabled,
  loadCommentSettings,
} from './controls';
import { decideCommentDm } from './dm-opportunity';
import {
  recordProactiveDm,
  recordPublicCommentReply,
  type CommentChannel,
} from './record-dm';
import { loadCustomerContext } from './customer-context';
import { loadOrderStatus } from './order-status';
import { loadCommentThread } from './comment-thread';
import { loadProductBrain } from './product-brain';
import { loadStoreLinks, linksBrief, type StoreLinks } from './store-links';
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

/**
 * Campaña que debe hacerse cargo de esta persona.
 *
 * Antes se tomaba "la campaña activa más reciente" y punto: con dos campañas
 * corriendo, la segunda se quedaba muda para siempre y quien ya estaba en la
 * primera nunca entraba a la nueva. Ahora se recorren las activas de la más
 * reciente a la más antigua y se elige la primera en la que esta persona
 * TODAVÍA no está — así ninguna campaña queda muerta y nadie recibe dos DMs
 * por lo mismo.
 */
async function campaignForContact(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<ActiveCampaign | null> {
  const { data } = await db
    .from('instagram_campaigns')
    .select('id, workspace_id, goal, plan, offer_code, shopify_price_rule_id, holdout_pct, ai_agent_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .order('launched_at', { ascending: false })
    .limit(10);
  const rows = (data ?? []) as Array<Omit<ActiveCampaign, 'plan'> & { plan: unknown }>;
  if (rows.length === 0) return null;

  const { data: enrolled } = await db
    .from('instagram_campaign_recipients')
    .select('campaign_id')
    .eq('contact_id', contactId)
    .in(
      'campaign_id',
      rows.map((r) => r.id),
    );
  const taken = new Set(
    ((enrolled ?? []) as Array<{ campaign_id: string }>).map((r) => r.campaign_id),
  );

  for (const row of rows) {
    if (taken.has(row.id)) continue;
    const plan = coercePlan(row.plan);
    if (!plan) continue;
    return { ...row, plan };
  }
  return null;
}

/**
 * El comentario queda esperando a una persona.
 *
 * Se usa cuando la IA no sabe la respuesta: no se publica nada y el hilo se
 * marca, así aparece en el filtro "Necesita humano" de la bandeja en vez de
 * quedar mezclado con todo lo demás. Sin esto, "no contestar" y "nadie se
 * entera" son lo mismo.
 *
 * Best-effort de punta a punta: lo importante —no publicar una promesa vacía—
 * ya pasó antes de llegar acá.
 */
async function marcarParaUnaPersona(
  db: SupabaseClient,
  contactId: string,
  pregunta: string,
  /** Por qué escala. Por defecto, el caso original: la IA no supo contestar. */
  motivo: NeedsHumanReason = 'answer_gap',
  resumen?: string,
): Promise<void> {
  try {
    const { data } = await db
      .from('conversations')
      .select('id')
      .eq('contact_id', contactId)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const convId = (data as { id: string } | null)?.id;
    if (!convId) return;
    await db
      .from('conversations')
      .update({
        needs_human_at: new Date().toISOString(),
        needs_human_reason: motivo,
        needs_human_summary:
          resumen ??
          `Preguntó: "${pregunta.slice(0, 200)}". La IA no sabe la respuesta.`,
      })
      .eq('id', convId)
      .is('needs_human_at', null);
  } catch (err) {
    console.error('[ig-agent] no se pudo marcar para una persona:', err);
  }
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

/**
 * La conexión de DM del workspace para una red concreta.
 *
 * Descarta las desconectadas, igual que `dmConnectionFor` acá abajo. Sin ese
 * filtro se tomaba "la fila más reciente" a secas, y cada reconexión deja una
 * fila muerta atrás: el 2026-08-29 había 60 filas de la misma página de Meta en
 * una sola cuenta, todas `disconnected` salvo una. Funcionaba de casualidad
 * —la viva era además la más reciente— y con una reconexión vieja tocada
 * después, el token que se usa para mandar el DM o para ocultar un comentario
 * sería uno muerto.
 */
async function dmConnection(
  db: SupabaseClient,
  workspaceId: string,
  channel: 'instagram' | 'messenger' = 'instagram',
): Promise<ChannelConnection | null> {
  const { data } = await db
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', channel)
    .neq('status', 'disconnected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ChannelConnection) ?? null;
}

/** Alias histórico: el resto del archivo solo habla de Instagram. */
const igConnection = (db: SupabaseClient, workspaceId: string) =>
  dmConnection(db, workspaceId, 'instagram');

/**
 * Conexión para MANDAR el DM: la cuenta que recibió el comentario, nunca
 * "la IG más reciente del workspace" (con 2 cuentas conectadas eso enviaba
 * por la equivocada y Meta rechazaba el private reply). Si la fuente es la
 * fila ig_comment, se prefiere su hermana `instagram` (misma cuenta, mismo
 * token); la propia fila sirve como último recurso porque comparte secrets.
 */
async function dmConnectionFor(
  db: SupabaseClient,
  workspaceId: string,
  source: ChannelConnection | null | undefined,
  channel: 'instagram' | 'messenger' = 'instagram',
): Promise<ChannelConnection | null> {
  if (!source) return dmConnection(db, workspaceId, channel);
  if (source.channel === channel) return source;
  const { data } = await db
    .from('channel_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('channel', channel)
    .eq('external_account_id', source.external_account_id ?? '')
    .neq('status', 'disconnected')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ChannelConnection | null) ?? source;
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
    /** The connection that RECEIVED the comment (the ig_comment row) —
     *  pins the outreach to the right account when the workspace has
     *  more than one Instagram connected. */
    connection?: ChannelConnection | null;
    /** Si viene, es una respuesta dentro de un hilo, no un comentario nuevo. */
    parentCommentId?: string | null;
    engagementText: string | null;
    /** De qué red viene el comentario (Instagram si no se dice). */
    commentChannel?: CommentChannel;
  },
): Promise<void> {
  if (!opts.contact.external_id) return;
  // Respect opt-out — never re-engage a contact who asked to stop.
  if (await isOptedOut(db, opts.contact.id)) return;
  // UN COMENTARIO LO ATIENDE COMENTARIOS. Siempre.
  //
  // Antes, si había una campaña activa que cubría a esta persona, la campaña se
  // quedaba el comentario: lo inscribía como destinatario y le mandaba SU copia
  // y SU oferta. El mismo comentario acababa contestado por una funcionalidad u
  // otra según qué campañas hubiera corriendo ese día, y las dos pantallas se
  // apuntaban el envío.
  //
  // Ahora el reparto es por MOMENTO, no por audiencia:
  //   - en vivo (alguien acaba de comentar) ⇒ Comentarios, y nadie más;
  //   - por lote (a quien interactuó hace días y ya no está en conversación)
  //     ⇒ Prospección, desde su propio cron (`send.ts`).
  // La persona puede estar en las dos, pero nunca en el mismo instante.
  if (opts.commentId) {
    await autonomousCommentReply(db, opts);
    return;
  }
  // Una respuesta dentro de un hilo tampoco inscribe a nadie: esa persona ya
  // está en conversación. La atiende el piso, que lee el hilo.
  if (opts.parentCommentId) {
    await autonomousCommentReply(db, opts);
    return;
  }
  const campaign = await campaignForContact(
    db,
    opts.workspaceId,
    opts.contact.id,
  );
  if (!campaign || !(await featureEnabled(db, opts.workspaceId, 'outreach'))) {
    await autonomousCommentReply(db, opts);
    return;
  }

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
      // Mismo criterio que el piso autónomo: lo que el triage llama spam se
      // oculta y no se contesta, crítica incluida. Ver el comentario largo en
      // `autonomousCommentReply`.
      if (s?.spam) {
        // Auto-hide spam/hate on the merchant's own post — sanctioned API,
        // best-effort (degrades if instagram_manage_comments isn't granted yet).
        if (opts.commentId) {
          // Hide it on the account that OWNS the comment (the connection
          // the webhook attributed it to), not an arbitrary IG row.
          const conn = opts.connection ?? (await igConnection(db, opts.workspaceId));
          if (conn)
            await setCommentHidden(conn, 'ig_comment', opts.commentId, true, 'spam');
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
  // Mismo contrato que la respuesta reactiva (pausado / alcance / horario /
  // "quiero un humano"). Antes el alcance de campaña ignoraba todo esto.
  if (!igAgentCanAutoReply(agent, opts.engagementText ?? '')) return;
  const brand = await loadBrandContext(db, opts.workspaceId, agent.id);
  // Enlaces reales de la tienda: sin ellos el modelo escribía marcadores tipo
  // "[enlace de la tienda web]" y le llegaban así al cliente.
  const links = await loadStoreLinks(
    db,
    opts.workspaceId,
    campaign.plan.recommended_products,
  );

  // Who they are → segment → tailored tone/offer. Comment-only contacts aren't
  // Profile-API-eligible yet, so profile is usually null here (segment falls
  // back to intent); the rich signals kick in once they DM.
  const profile = await loadIgProfile(db, opts.contact.id).catch(() => null);
  // Y quién es como clienta: a quien ya compró no se le vende de cero.
  const customer = await loadCustomerContext(db, opts.contact.id);
  const segment = resolveIgSegment({
    followsBusiness: profile?.follows_business,
    followerCount: profile?.follower_count,
    isVerified: profile?.is_verified,
    leadScore,
  });
  // El cerebro del producto del que habla, o el que la campaña quiere destacar.
  const productBrain = await loadProductBrain(db, opts.workspaceId, {
    text: opts.engagementText,
    preferTitles: campaign.plan.recommended_products,
  });
  const personaFields = {
    customer: customer?.brief ?? null,
    product: productBrain?.brief ?? null,
    personaHint: profile?.persona_hint ?? null,
    openerHint: profile?.opener_hint ?? null,
    followsBusiness: profile?.follows_business ?? null,
    isVerified: profile?.is_verified ?? null,
    segment,
  };

  // Trust gate: emergency pause + rolling-24h daily cap. If blocked, leave the
  // recipient queued (the cron is gated too) so nothing is lost, just deferred.
  const trust = await proactiveGate(db, opts.workspaceId);
  if (!trust.ok) return;

  // El alcance proactivo es SIEMPRE automático: no hay nada que aprobar.
  // Lo que decide si se escribe o no son las puertas reales de arriba —
  // spam/intención (`scoreLeads`), el contrato del agente
  // (`igAgentCanAutoReply`) y el límite de confianza (`proactiveGate`).

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

  const connection = await dmConnectionFor(db, opts.workspaceId, opts.connection);
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
    links,
    offer,
    products: campaign.plan.recommended_products,
    name: opts.contact.name,
    engagement: opts.engagementText,
    ...personaFields,
  });

  try {
    const dmRes = await instagramAdapter.sendText({
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
    await recordProactiveDm(db, {
      workspaceId: opts.workspaceId,
      contactId: opts.contact.id,
      externalId: opts.contact.external_id,
      connection,
      text,
      dmMessageId: dmRes?.externalMessageId ?? null,
      commentContactId: opts.commentId ? opts.contact.id : null,
      origin: 'ig_outreach',
      originName: campaign.plan.campaign_name ?? null,
    });
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
- Si preguntan por registros o aprobaciones sanitarias, contraindicaciones, ingredientes o plazos que NO estén en el contexto, no los afirmes ni los niegues: di que lo confirmas. Nunca inventes un dato regulatorio o de salud.
- Cierra con su código de descuento (si lo hay) y un siguiente paso claro.
- ENLACES: si compartes un link, copia EXACTAMENTE uno de los ENLACES REALES del contexto. PROHIBIDO escribir marcadores tipo "[enlace]" o URLs inventadas; si no hay enlace, invita a seguir por aquí.
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
  links?: StoreLinks | null;
}): Promise<string | null> {
  const first = (input.name ?? '').trim().split(/\s+/)[0] || null;
  const userPrompt = [
    brandBrief(input.brand),
    input.goal ? `OBJETIVO DE LA CAMPAÑA:\n${input.goal}` : '',
    input.plan.recommended_products.length
      ? `PRODUCTOS: ${input.plan.recommended_products.join(', ')}`
      : '',
    linksBrief(input.links ?? null),
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
 * PISO AUTÓNOMO — sin campaña activa.
 *
 * Alguien comenta "cuánto vale?" en un post y no hay ninguna campaña corriendo:
 * antes no pasaba nada. Ahora el agente le contesta por privado igual, con la
 * voz y el conocimiento del agente de IA que el comercio configuró para
 * Instagram, y le lleva la conversación a la bandeja donde su equipo la ve.
 *
 * Guardas (las mismas que todo lo proactivo): interruptor por workspace
 * (encendido por defecto), solo intención de compra real —el comentario casual
 * y el spam no reciben nada—, pausa de emergencia, tope diario, una sola
 * respuesta privada por comentario, y baja del contacto respetada.
 */
/**
 * Deja constancia de por qué este comentario no se contestó.
 *
 * Escribe en `ai_replies`, la misma tabla que el runner, para que la pregunta
 * "¿por qué no le contestó a esta persona?" se responda con UNA consulta y sin
 * importar el canal. `agent_id` va nulo a propósito: Comentarios se gobierna
 * solo y contesta con la marca y el catálogo aunque no haya ningún asistente
 * configurado, así que atarlo a un agente sería mentir.
 *
 * Best-effort: la telemetría no puede tumbar el camino que observa.
 */
async function registrarSkipComentario(
  db: SupabaseClient,
  opts: OpcionesComentario,
  motivo: string,
): Promise<void> {
  try {
    const { data } = await db
      .from('conversations')
      .select('id')
      .eq('workspace_id', opts.workspaceId)
      .eq('contact_id', opts.contact.id)
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const conversationId = (data as { id?: string } | null)?.id ?? null;
    if (!conversationId) return;
    await db.from('ai_replies').insert({
      workspace_id: opts.workspaceId,
      conversation_id: conversationId,
      agent_id: null,
      status: 'skipped',
      skip_reason: motivo,
    });
    // La misma tabla que gobierna el chat decide si además espera a una
    // persona. Los comentarios tenían su propia idea de eso, dispersa en tres
    // llamadas sueltas: ahora es una sola política para todo (`desenlace.ts`).
    await aplicarDesenlace(db, conversationId, motivo);
  } catch (err) {
    console.error('[comentarios] no se pudo registrar el motivo:', motivo, err);
  }
}

/**
 * ¿Este comentario está oculto?
 *
 * La fila de la bandeja guarda el id de Meta en `message_id`, que es el mismo
 * que llega por el webhook. Ante la duda —fila que no aparece, consulta que
 * falla— devuelve `false`: no contestar por un error de lectura sería peor que
 * el problema que arregla.
 */
async function estaOculto(
  db: SupabaseClient,
  commentId: string | null | undefined,
): Promise<boolean> {
  if (!commentId) return false;
  const { data } = await db
    .from('messages')
    .select('is_hidden')
    .eq('message_id', commentId)
    .limit(1)
    .maybeSingle();
  return Boolean((data as { is_hidden?: boolean | null } | null)?.is_hidden);
}

/** Lo que decidió el piso autónomo para un comentario. */
interface OpcionesComentario {
  workspaceId: string;
  contact: ContactLite;
  commentId?: string | null;
  sourcePostId?: string | null;
  connection?: ChannelConnection | null;
  engagementText: string | null;
  /** De qué red viene el comentario. Por defecto Instagram, que era el único
   *  canal que llegaba aquí antes de que Facebook se habilitara. */
  commentChannel?: CommentChannel;
}

/**
 * Por qué un comentario no se contestó.
 *
 * Este camino no pasa por el runner y por lo tanto no escribía NADA en
 * `ai_replies`: un comentario sin respuesta era indistinguible de un fallo, y
 * no había forma de contestar "¿por qué no le contestó a esta persona?" salvo
 * leyendo el código y adivinando. El 2026-08-29, de 16 comentarios en 48 h,
 * nueve quedaron sin responder y ninguno dejó una sola fila.
 *
 * Los motivos son propios del canal y llevan prefijo `comment_` para no
 * confundirse con los del runner (`ai/runner.ts`).
 */
async function autonomousCommentReply(
  db: SupabaseClient,
  opts: OpcionesComentario,
): Promise<void> {
  const motivo = await decidirComentario(db, opts);
  if (motivo) await registrarSkipComentario(db, opts, motivo);
}

async function decidirComentario(
  db: SupabaseClient,
  opts: OpcionesComentario,
): Promise<string | null> {
  // Solo aplica al camino comentario → DM privado: sin id de comentario no hay
  // ruta permitida por Meta para escribirle.
  if (!opts.commentId) return null;
  if (!opts.contact.external_id && !isTikTokChannel(opts.commentChannel)) {
    return 'comment_sin_destinatario';
  }
  if (!(await autoReplyCommentsEnabled(db, opts.workspaceId))) {
    return 'comment_apagado';
  }
  // Sin saldo o con la suscripcion vencida, la IA no contesta comentarios
  // tampoco: es la misma clave de Riverz pagando la misma llamada al modelo.
  if (!(await puedeUsarIa(db, opts.workspaceId))) return 'comment_sin_saldo';

  // Instagram ↔ Messenger: mismo camino, distinta red. El comentario se
  // contesta por el DM de SU plataforma — un comentario de Facebook no se
  // responde por Instagram.
  const commentChannel = opts.commentChannel ?? 'ig_comment';
  const isFacebook = commentChannel === 'fb_comment';
  // TikTok no tiene privado: su API de mensajes está cerrada a terceros. Todo
  // lo que se conteste ahí se publica bajo el video, y las ramas del DM —el
  // candado, el tope, el opt-in de Meta— simplemente no corren.
  const isTikTok = commentChannel === 'tiktok_comment';
  const dmChannel = isFacebook ? ('messenger' as const) : ('instagram' as const);
  const adapter = isFacebook ? messengerAdapter : instagramAdapter;

  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  if (!hasLlm(apiKey)) return 'comment_sin_llave';

  // Un comentario sin texto (un emoji, una mención) no dice nada que responder.
  const engagement = (opts.engagementText ?? '').trim();
  if (engagement.length < 3) return 'comment_sin_texto';

  // UN COMENTARIO OCULTO NO SE CONTESTA.
  //
  // Ocultarlo es la decisión de no darle tribuna. Contestarlo después la
  // deshace y encima queda peor: el comentario no se ve y la respuesta sí, así
  // que el que pasa lee una respuesta a una acusación invisible y se entera de
  // que existió. Medido el 2026-08-28 en la cuenta de Pilar: los TRES
  // comentarios negativos que el agente contestó en público estaban ocultos.
  //
  // Da igual quién lo ocultó —el comercio a mano, el agente por spam, o la
  // propia red—: la fila lo dice y con eso alcanza.
  if (await estaOculto(db, opts.commentId)) return 'comment_ya_oculto';

  // No abrir la puerta a fan-out: el mismo tope por minuto que el alcance de
  // campaña, para que un post viral no dispare cientos de llamadas.
  const burst = await limitByKey(`ig-auto:${opts.workspaceId}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!burst.success) return 'comment_tope_por_minuto';

  // "¿Dónde está mi pedido?" NO es intención de compra y el filtro de abajo la
  // habría descartado — justo la pregunta que más urge contestar. Se resuelve
  // primero y se responde con el estado real (misma consulta a Shopify que usa
  // la tool del Asistente), no con un pitch.
  const orderStatus = await loadOrderStatus(
    db,
    opts.workspaceId,
    opts.contact.id,
    engagement,
  );

  // A quién contesta, y cuánto insiste en un hilo: lo decide el comercio en
  // Comentarios (migración 132). Los defaults son la conducta de siempre.
  const commentCfg = await loadCommentSettings(db, opts.workspaceId);

  // ¿Hay algo que atender aunque no quiera comprar? Una crítica a la marca, un
  // reclamo o una pregunta concreta. El 2026-08-28 seis comentarios así —uno
  // pedía la aprobación de ANMAT— se descartaron por no mostrar intención de
  // compra y quedaron a la vista de todos sin respuesta.
  const motivo = mereceRespuesta(engagement);

  // ¿Intención de compra? Con 'intent' (por defecto) solo contestamos a quien
  // pregunta de verdad: el "😍" no recibe DM. Con 'all' contestamos a todo el
  // que escriba algo — el spam se sigue filtrando y ocultando en los dos casos,
  // porque contestarle a un bot no es una decisión de negocio.
  let score: LeadScore = 'medium';
  try {
    const [s] = await scoreLeads(apiKey, [engagement]);
    if (!s) return 'comment_sin_clasificar';
    // El spam se oculta y se calla. DECISIÓN DEL COMERCIO, 2026-08-28.
    //
    // Estuvo un rato al revés: `mereceRespuesta` mandaba sobre el clasificador,
    // con el argumento de que ocultar a una clienta que cuestiona la marca se
    // lee como censura. El dueño lo revisó y decidió lo contrario: a un
    // comentario que ataca a la marca —"dejen de mentir", "publicidades
    // falsas"— no se le contesta en público, se lo saca de la vista. Contestar
    // ahí sube el hilo, lo pone arriba en la publicación y le da tribuna a la
    // discusión delante de todos los que pasan.
    //
    // No hace falta una excepción para el cliente con un problema: el
    // clasificador manda a spam el insulto y la autopromo, no un "no me llegó
    // el pedido", que sigue de largo y llega a la respuesta como siempre.
    //
    // Si esto se vuelve a dar vuelta, que sea porque el dueño lo pide, no
    // porque el comentario de arriba convenza a alguien.
    // La crítica pública entra por acá junto con el spam. El clasificador no
    // la marcaba —su definición de spam es "bot, autopromo, insulto"— así que
    // un "publicidades falsas mezclando rostros" salía limpio y se contestaba
    // en público, que es exactamente lo que el dueño no quiere. `esCritica`
    // distingue el veredicto de la pregunta: quien pregunta por la aprobación
    // de ANMAT está evaluando comprar y recibe respuesta.
    const esCritica = esCriticaPublica(engagement);
    if (s.spam || esCritica) {
      // Ocultarlo es una llamada de Meta: en TikTok se deja pasar sin
      // contestar, que es lo que importa.
      if (!isTikTok) {
        const conn =
          opts.connection ?? (await dmConnection(db, opts.workspaceId, dmChannel));
        const oculto = conn
          ? await setCommentHidden(
              conn,
              commentChannel,
              opts.commentId,
              true,
              s.spam ? 'spam' : 'critica',
            )
          : false;
        // SI NO SE PUDO OCULTAR, NO SE HACE COMO QUE SÍ.
        //
        // El plan era "esto no se contesta, se saca de la vista". Cuando Meta
        // rechaza el ocultado —le falta `pages_manage_engagement` a la cuenta,
        // por ejemplo— no pasa ninguna de las dos cosas: el comentario sigue
        // publicado, sin respuesta, y hasta acá no quedaba registro de nada.
        // Facebook estuvo dos meses en ese estado sin un solo error anotado.
        // Ahora escala: lo mira una persona, que sí puede ocultarlo desde la
        // app mientras se arregla el permiso.
        if (!oculto) {
          await marcarParaUnaPersona(
            db,
            opts.contact.id,
            engagement,
            'comment_sin_moderar',
            `No se pudo ocultar en ${commentChannel}. Sigue publicado y sin respuesta: "${engagement.slice(0, 160)}". Revisa el permiso de la cuenta en Canales.`,
          );
          return 'comment_no_se_pudo_ocultar';
        }
      }
      return s.spam ? 'comment_spam' : 'comment_critica';
    }
    // El desinterés sólo descarta cuando no hay nada más que atender: ni una
    // duda de post-venta, ni una crítica, ni una pregunta. "Solo a quien
    // quiere comprar" es un filtro para no perseguir a nadie por privado, no
    // un permiso para callarse cuando cuestionan a la marca en público.
    if (
      commentCfg.audience === 'intent' &&
      s.score === 'low' &&
      !orderStatus &&
      !motivo
    ) {
      return 'comment_sin_intencion';
    }
    score = s.score;
  } catch {
    // Sin clasificar no arriesgamos un DM no pedido… salvo que el comercio haya
    // pedido explícitamente contestar a todos.
    if (!orderStatus && commentCfg.audience === 'intent') return 'comment_clasificador_fallo';
  }

  // Del agente se toma la VOZ, nunca el permiso: Asistentes IA gobierna las
  // conversaciones por DM y Comentarios se gobierna solo, con su propio
  // interruptor. Sin agente, `NO_AGENT` — se contesta igual con la marca y el
  // catálogo, solo que sin herramientas.
  const agent = await resolveIgAgent(db, opts.workspaceId, null);
  // Lo único que se respeta del agente aquí: que la persona pida un humano.
  if (!commentAgentCanReply(agent, engagement)) return 'comment_pide_humano';

  const trust = await proactiveGate(db, opts.workspaceId);
  if (!trust.ok) return 'comment_puerta_proactiva';

  // El candado de "una sola respuesta privada por comentario" se pide MÁS
  // ABAJO, justo antes de mandar el DM: en los modos que sólo publican en el
  // comentario no se manda ninguno, y pedirlo aquí gastaba la única respuesta
  // privada que Meta permite sin haber escrito a nadie — dejando mudo al
  // camino que sí quería usarla.

  // En TikTok no se busca conexión de DM: no existe esa superficie.
  const connection = isTikTok
    ? null
    : await dmConnectionFor(db, opts.workspaceId, opts.connection, dmChannel);
  // Sin conexión de DM sólo se cae el camino privado: el modo "Solo en el
  // comentario" publica igual, que es justo lo que el comercio pidió.
  if (!connection && !isTikTok && commentCfg.replyMode !== 'public') {
    return 'comment_sin_conexion';
  }

  const [brand, links, profile, customer, thread, product] = await Promise.all([
    loadBrandContext(db, opts.workspaceId, agent.id),
    loadStoreLinks(db, opts.workspaceId, []),
    loadIgProfile(db, opts.contact.id).catch(() => null),
    // Quién es como clienta: si ya compró, el mensaje deja de ser una venta a
    // una desconocida y pasa a ser una conversación con alguien de la casa.
    loadCustomerContext(db, opts.contact.id),
    // Y qué se dijeron ya bajo este post: una respuesta a nuestra respuesta no
    // es un primer contacto y no puede empezar saludando de cero.
    loadCommentThread(db, opts.contact.id, opts.sourcePostId ?? null),
    // El cerebro del producto del que habla: su conocimiento y sus barreras.
    loadProductBrain(db, opts.workspaceId, { text: engagement }),
  ]);

  // Freno anti-bucle: en un mismo hilo no insistimos más de tres veces. Si da
  // para más, ya no es un comentario — es una conversación, y sigue en la
  // bandeja con el Asistente o una persona. El tope lo elige el comercio; 0 =
  // sin tope.
  if (
    commentCfg.maxThreadReplies > 0 &&
    (thread?.ourReplies ?? 0) >= commentCfg.maxThreadReplies
  ) {
    return 'comment_tope_del_hilo';
  }

  const segment = resolveIgSegment({
    followsBusiness: profile?.follows_business,
    followerCount: profile?.follower_count,
    isVerified: profile?.is_verified,
    leadScore: score,
  });

  // Contesta el MISMO agente completo que atiende los DMs, con sus
  // herramientas: puede consultar el pedido, cotizar con el catálogo real y
  // armar un checkout desde la primera respuesta.
  //
  // Sin interruptor propio a propósito: "Responder con IA" de Comentarios ya
  // dice que contesta la IA, y tener que encender un segundo botón para que
  // esa IA pudiera hacer algo era pedirle al comercio que entendiera una
  // distinción que solo existía por dentro.
  //
  // Va aquí, DESPUÉS de todas las guardas —limitador de ráfaga, spam/intención,
  // igAgentCanAutoReply, proactiveGate, candado por comentario, anti-bucle de
  // 3— y solo COMPONE: el envío de abajo no cambia.
  let text: string | null = agent.id
    ? await composeSuperAgentReply(db, {
        workspaceId: opts.workspaceId,
        agentId: agent.id,
        commentContactId: opts.contact.id,
        commentChannel,
        commentText: engagement,
        extraBrief:
          [
            // Va PRIMERO: cómo contestar una crítica manda sobre todo lo
            // demás. Sin esto el agente le respondía a quien cuestiona la
            // marca con el mismo tono que a quien quiere comprar.
            motivo ? instruccionPara(motivo) : null,
            customer?.brief,
            orderStatus,
            thread?.brief,
            product?.brief,
          ]
            .filter(Boolean)
            .join('\n\n') || null,
      }).catch(() => null)
    : null;
  // El agente completo escribe en Markdown —`**$39.990**`— y ni Instagram ni
  // TikTok lo renderizan: al cliente le llegan los asteriscos. El resto de las
  // superficies ya pasaban por acá; ésta no, y era justo la que contesta en
  // público. Visto en producción el 2026-08-28.
  // Segunda pasada barata: el respaldo de abajo tambien escribe, y una sola
  // puerta vale mas que dos recordatorios.
  if (text) text = salidaParaCliente(text);

  // Respaldo: si el agente completo falla por lo que sea (sin clave, sin saldo,
  // texto vacío), contesta el redactor de una pasada. Un comentario no se queda
  // sin respuesta por culpa de esto.
  if (!text?.trim()) {
    text = await craftPersonalizedDM({
      apiKey,
      base: orderStatus
        ? 'Responde su duda sobre el pedido con los datos reales. No vendas nada.'
        : 'Responde a su comentario, resuelve su duda concreta y ofrécele avanzar con la compra.',
      brand,
      links,
      customer: [customer?.brief, orderStatus].filter(Boolean).join('\n\n') || null,
      thread: thread?.brief ?? null,
      product: product?.brief ?? null,
      goal: null,
      offer: null,
      products: links.products.map((p) => p.title),
      name: opts.contact.name,
      engagement,
      personaHint: profile?.persona_hint ?? null,
      openerHint: profile?.opener_hint ?? null,
      followsBusiness: profile?.follows_business ?? null,
      isVerified: profile?.is_verified ?? null,
      segment,
    });
  }
  if (!text.trim()) return 'comment_respuesta_vacia';

  // Última puerta antes de publicar: que no afirme lo que no le consta. La
  // prohibición está en el prompt y aun así se cuela —el modelo de los agentes
  // es Haiku y con una lista larga se le escapan las últimas reglas—, así que
  // se comprueba el texto ya escrito. Si afirma que los testimonios son reales
  // o que el producto tiene una aprobación, no sale nada y el comentario queda
  // para una persona: callarse es recuperable, publicarlo no.
  if (afirmaLoQueNoSabe(text)) {
    console.warn(
      '[ig-agent] respuesta descartada, afirmaba lo que no le consta:',
      text.slice(0, 160),
    );
    return 'comment_afirma_lo_que_no_sabe';
  }

  // Y la otra mitad de lo mismo: si no sabe, no contesta. Prometer en público
  // que va a averiguar y volver es peor que callarse — queda escrito debajo de
  // la publicación, lo lee cualquiera que pase, y nadie vuelve. Sin respuesta,
  // el comentario queda para una persona.
  if (prometeAveriguar(text)) {
    console.warn(
      '[ig-agent] respuesta descartada, prometía averiguar y volver:',
      text.slice(0, 160),
    );
    await marcarParaUnaPersona(db, opts.contact.id, engagement);
    return 'comment_prometia_averiguar';
  }

  // ¿Además del comentario, hace falta abrir el privado? Lo decide el modo que
  // eligió el comercio (migración 177). En 'public_smart' pregunta al
  // clasificador: la respuesta privada es UNA sola por comentario y gastarla en
  // un "qué linda foto" es perderla para el que sí quería comprar.
  const decision = await decideCommentDm({
    // En TikTok la única respuesta posible es la pública, así que no se le
    // pregunta al clasificador algo que no se puede ejecutar.
    mode: isTikTok ? 'public' : commentCfg.replyMode,
    apiKey,
    comment: engagement,
    reply: text,
    hasOrderQuestion: Boolean(orderStatus),
  });

  // Publicar bajo el comentario no consume nada de Meta; abrir el privado sí.
  // Por eso el candado se pide sólo aquí, cuando ya se sabe que va a salir un
  // DM. `external_id` es lo que hace falta para escribirle: sin él (un caso
  // raro de Graph) queda la respuesta pública, que sigue siendo una respuesta.
  const wantsDm =
    decision.dm && Boolean(opts.contact.external_id) && Boolean(connection);
  const wonPrivateReply = wantsDm
    ? await claimCommentPrivateReply(
        db,
        opts.workspaceId,
        opts.commentId,
        'campaign',
      )
    : false;

  // Si además se publica en el comentario, la bandeja recibe la respuesta
  // PÚBLICA de verdad (abajo) y no hace falta espejar encima el DM: serían dos
  // mensajes casi iguales en el mismo hilo.
  // En TikTok siempre se publica: es lo único que TikTok deja hacer, así que
  // el modo elegido para Instagram y Facebook no la puede dejar muda.
  const willPublish = isTikTok || commentCfg.publicReply;

  let dmSent = false;
  /** No salió nada: ni el privado ni la respuesta pública. */
  let falloAlPublicar = false;
  try {
    if (wonPrivateReply && connection) {
      const dmRes = await adapter.sendText({
        channel: dmChannel,
        connection,
        conversation: { id: '' } as unknown as Conversation,
        contact: {
          id: opts.contact.id,
          external_id: opts.contact.external_id,
        } as unknown as Contact,
        commentId: opts.commentId,
        text,
      } satisfies OutboundText);
      dmSent = true;
      await recordProactiveDm(db, {
        workspaceId: opts.workspaceId,
        contactId: opts.contact.id,
        externalId: opts.contact.external_id,
        dmChannel,
        commentChannel,
        connection,
        text,
        dmMessageId: dmRes?.externalMessageId ?? null,
        commentContactId: willPublish ? null : opts.contact.id,
        // Para que el hilo privado no se abra con nuestro mensaje a secas.
        commentText: engagement,
        // Comentarios se gobierna solo, así que la bandeja tiene que decirlo con
        // ese nombre: es el interruptor que el comercio apaga si no lo quiere.
        origin: 'comment_ai',
        originName: null,
      });
    }

    // Respuesta pública en el propio comentario, si el comercio la pidió.
    // Va DESPUÉS del DM y en su propio try: es lo que puede fallar por
    // permisos de Meta, y un fallo aquí no debe tumbar un DM ya enviado.
    if (willPublish) {
      // Sin DM, lo público NO puede decir "te escribí por privado": es la
      // respuesta entera, ahí mismo.
      const publicText = publicReplyFrom(text, dmSent);
      const publicConnection = opts.connection ?? connection;
      try {
        if (!publicConnection) throw new Error('sin conexión de comentarios');
        const res = await getAdapter(commentChannel).sendText({
          channel: commentChannel,
          connection: publicConnection,
          conversation: {
            id: '',
            // TikTok necesita además el video, y su adapter lo lee de aquí con
            // la forma "video:<id>|comment:<id>" que arma el poll.
            thread_external_id: isTikTok
              ? `video:${opts.sourcePostId ?? ''}|comment:${opts.commentId}`
              : opts.commentId,
          } as unknown as Conversation,
          contact: { id: opts.contact.id } as unknown as Contact,
          text: publicText,
          replyToExternalId: opts.commentId,
        } satisfies OutboundText);
        // A la bandeja, ahora. Meta no manda webhook por los comentarios de la
        // propia cuenta: sin esto la respuesta sólo aparecía cuando pasaba la
        // conciliación, diez minutos después — y en el modo "Solo en el
        // comentario" el hilo se veía sin contestar todo ese rato.
        await recordPublicCommentReply(db, {
          workspaceId: opts.workspaceId,
          commentContactId: opts.contact.id,
          commentChannel,
          text: publicText,
          externalId: res.externalMessageId ?? null,
          origin: 'comment_ai',
        });
        // Se registra aparte del DM: son dos acciones distintas y la pantalla
        // las cuenta por separado (lo que se ve en el post vs lo que llega al
        // privado).
        await logProactiveSend(db, {
          workspaceId: opts.workspaceId,
          contactId: opts.contact.id,
          kind: 'comment_public',
          // Con el texto: así la conciliación reconoce la respuesta como
          // automática si acaba re-ingresándola por su lado.
          text: publicText,
        });
      } catch (pubErr) {
        const detalle = pubErr instanceof Error ? pubErr.message : String(pubErr);
        console.error(
          '[ig-agent] respuesta pública falló (¿permisos de Meta?):',
          pubErr,
        );
        // Que se sepa desde AFUERA, no sólo en el log.
        //
        // Un permiso que falta hace fallar TODAS las publicaciones, siempre, y
        // esto era un `console.error` y nada más: si además no salió el DM, el
        // comentario quedaba sin respuesta y sin una sola fila que lo dijera.
        // Es lo que le pasó a Facebook durante dos meses (2026-08-30).
        if (publicConnection) {
          await db
            .from('channel_connections')
            .update({
              last_error: `no se pudo publicar la respuesta (${commentChannel}): ${detalle}`.slice(0, 500),
            })
            .eq('id', publicConnection.id)
            .then(undefined, () => {});
        }
        // No se publicó, así que el hilo del comentario quedaría vacío: se
        // espeja el DM, que es lo que se hacía antes de intentar publicar.
        if (dmSent) {
          await recordPublicCommentReply(db, {
            workspaceId: opts.workspaceId,
            commentContactId: opts.contact.id,
            commentChannel,
            text,
            origin: 'comment_ai',
          });
        } else {
          // Ni público ni privado: nadie contestó. Lo mira una persona en vez
          // de que el comentario se pierda en silencio.
          await marcarParaUnaPersona(
            db,
            opts.contact.id,
            engagement,
            'comment_sin_moderar',
            `No se pudo contestar en ${commentChannel}: ${detalle.slice(0, 160)}`,
          );
          falloAlPublicar = true;
        }
      }
    }
    // 'comment', no 'outreach': esto es Comentarios contestando, no una
    // campaña saliendo a buscar. Compartían el mismo kind y las dos pantallas
    // se apuntaban el mismo envío.
    //
    // Solo si el DM salió: este libro cuenta DMs (y de él sale el tope diario).
    // Registrar una respuesta pública como DM inflaba la cifra y le comía el
    // presupuesto de envío a la cuenta sin haber escrito a nadie.
    if (dmSent) {
      await logProactiveSend(db, {
        workspaceId: opts.workspaceId,
        contactId: opts.contact.id,
        kind: 'comment',
        text,
      });

      // Pedirle el permiso de Marketing Messages, igual que hace el runner tras
      // contestar un DM.
      //
      // Faltaba, y era el agujero que dejaba la prospección sin nadie a quien
      // escribir: la lista de suscriptores es la ÚNICA fuente de audiencia que
      // no se vence, y sólo se puede pedir el permiso con la ventana abierta.
      // Comentarios es la superficie que más ventanas abre —cada comentario es
      // una— y era justo la que nunca preguntaba, así que la lista arrancaba
      // vacía y se quedaba vacía. Sus propias guardas están adentro
      // (interruptor `marketing_optin_enabled`, freno de emergencia y tope
      // diario); acá sólo se agrega el opt-out del contacto.
      await maybeRequestOptIn(db, {
        workspaceId: opts.workspaceId,
        channel: dmChannel,
        connection,
        externalContactId: opts.contact.external_id,
        contactOptedOut: await isOptedOut(db, opts.contact.id),
      });
    }
  } catch (err) {
    console.error('[ig-agent] respuesta autónoma falló:', err);
    return 'comment_error';
  }
  // Se escribió una respuesta y no salió por ningún lado: eso NO es "contestado".
  if (falloAlPublicar) return 'comment_no_se_pudo_publicar';
  // Contestado: nada que explicar.
  return null;
}

/**
 * El texto que se publica EN el comentario.
 *
 * Con DM enviado: lo lee cualquiera que pase por el post, así que no repite el
 * mensaje privado —que lleva precios, códigos y datos del pedido— sino que
 * avisa de que la respuesta ya salió por privado. Corto: Meta corta los
 * comentarios largos y un párrafo bajo una foto se lee como spam.
 *
 * Sin DM (modo 'público' o el clasificador dijo que no hacía falta): la
 * respuesta ES esta, así que va entera —recortada a lo que se lee bajo una
 * foto— y sin prometer un privado que nadie va a recibir.
 */
/** ¿El comentario viene de TikTok? Se pregunta antes de resolver el canal. */
function isTikTokChannel(channel?: CommentChannel): boolean {
  return channel === 'tiktok_comment';
}

/**
 * Oraciones completas de `texto` que entran en `tope` caracteres.
 *
 * `recortarSalida` sirve para un mensaje privado, donde llenar el presupuesto
 * importa: si la primera oración ocupa menos de la mitad del tope, corta por
 * palabra y pega un `…`. Bajo una foto eso se lee mal, y salió así en público
 * el 2026-08-29:
 *
 *   «…la zona de la papada, de abajo hacia… 💬 Te escribí por privado.»
 *
 * Acá se prefiere una oración corta y entera a una larga cortada. Devuelve ''
 * si no entra ni la primera.
 */
function oracionesQueEntran(texto: string, tope: number): string {
  const partes = texto.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [];
  let salida = '';
  for (const parte of partes) {
    const siguiente = salida + parte;
    if (siguiente.trimEnd().length > tope) break;
    salida = siguiente;
  }
  return salida.trim();
}

export function publicReplyFrom(dmText: string, dmSent = true): string {
  const clean = dmText.trim();
  if (!dmSent) {
    if (!clean) return '';
    return recortarSalida(clean, 480);
  }
  const first = clean.split('\n')[0]?.trim() ?? '';
  const short = oracionesQueEntran(first, 120);
  return short ? `${short} 💬 Te escribí por privado.` : 'Te escribí por privado 💬';
}


/**
 * Alguien de una campaña respondió: lo marcamos en el embudo (sent → replied).
 * Independiente de QUIÉN conteste después — el agente configurado o el cierre
 * de respaldo—, para que las métricas no dependan del camino que atendió.
 */
export async function markCampaignReply(
  db: SupabaseClient,
  contactId: string,
): Promise<void> {
  const { data } = await db
    .from('instagram_campaign_recipients')
    .select('id')
    .eq('contact_id', contactId)
    .eq('status', 'sent')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  if (!id) return;
  await db
    .from('instagram_campaign_recipients')
    .update({ status: 'replied', replied_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'sent');
}

/**
 * ¿El workspace tiene un agente de IA atendiendo Instagram? Si lo tiene, es ÉL
 * quien debe responder —con su catálogo, sus reglas y sus herramientas
 * (crear pedido, checkout, escalar)— y no un cerrador aparte con la mitad de
 * las capacidades. El contexto de la campaña (oferta, código, lo que ya le
 * escribimos) le llega por `loadInstagramContext`.
 */
export async function hasInstagramAgent(
  db: SupabaseClient,
  workspaceId: string,
): Promise<boolean> {
  const { data } = await db
    .from('ai_agents')
    .select('id, scope, ai_agent_channels(channel)')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .is('deleted_at', null);
  const rows = (data ?? []) as Array<{
    id: string;
    scope: string;
    ai_agent_channels?: Array<{ channel: string }> | null;
  }>;
  // Mismo criterio EXACTO que `pickAgent` del runner: manda el `scope`, no
  // la ausencia de filas. Antes mirábamos sólo los canales, así que un
  // agente con scope='channels' y la lista vacía contaba como "atiende
  // Instagram" — el closer de respaldo se saltaba y `pickAgent` devolvía
  // null, dejando el hilo completamente mudo.
  return rows.some(
    (a) =>
      a.scope === 'workspace' ||
      (a.ai_agent_channels ?? []).some((c) => c.channel === 'instagram'),
  );
}

/**
 * Cierre de RESPALDO: solo corre cuando el workspace no tiene ningún agente de
 * IA atendiendo Instagram. Contesta en el contexto de la campaña para que el
 * cliente no quede en silencio; devuelve true si respondió.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function maybeRunCloser(
  db: SupabaseClient,
  opts: {
    workspaceId: string;
    contact: ContactLite;
    connection: ChannelConnection;
    inboundText: string | null;
    /** Conversación del DM — para respetar los controles a nivel chat
     *  (kill-switch / toma por humano / cerrado) igual que el runner. */
    conversation: {
      id: string;
      ai_enabled?: boolean | null;
      assigned_agent_id?: string | null;
      status?: string | null;
    };
    /** Mensaje entrante que disparó este run — para el debounce anti-ráfaga. */
    inboundMessage: { id: string; created_at: string };
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

  // Respetar los controles a nivel conversación igual que el runner genérico
  // (shouldSkip): kill-switch por chat (ai_enabled=false), toma por un humano
  // (assigned_agent_id), o chat cerrado. Antes el cerrador corría ANTES del
  // genérico y salteaba estos controles, mandando una venta automática pese a
  // que el comercio apagó la IA o un humano tomó el chat. Devolvemos false
  // para que el genérico tome la decisión final (su shouldSkip también skipea
  // estos casos → silencio; y si reply_when_assigned está ON, responde el
  // agente genérico, no el cerrador de campaña).
  const conv = opts.conversation;
  if (conv.ai_enabled === false || conv.assigned_agent_id || conv.status === 'closed') {
    return false;
  }

  // Debounce anti-ráfaga (espeja el runner genérico, runner.ts): si el cliente
  // manda varios DMs seguidos, esperamos y, si ya llegó uno más nuevo,
  // abortamos — el cierre disparado por el DM más nuevo cubre la ráfaga.
  // Sin esto, N DMs en ráfaga disparaban N cierres concurrentes (sin lock ni
  // claim atómico) y el cliente recibía 2-3 mensajes de venta duplicados. El
  // desempate (created_at,id) garantiza que exactamente un run sobreviva.
  // ¿Llegó un inbound RESPONDIBLE más nuevo? Un mensaje no-respondible (mención
  // -en-historia / post compartido: texto vacío y sin adjunto bajable) se
  // inserta pero NO dispara ningún run — así que no cuenta como "el más nuevo
  // que cubre la ráfaga". Sin este filtro, un DM real de compra seguido de una
  // story vacía quedaba sin responder (este run cedía a la story, que no
  // contesta nadie). Espeja el gate de inbox-writer.
  const newerAnswerableInbound = async (): Promise<boolean> => {
    const { data } = await db
      .from('messages')
      .select('id, content_text, media_url')
      .eq('conversation_id', conv.id)
      .eq('sender_type', 'customer')
      .or(
        `created_at.gt.${opts.inboundMessage.created_at},` +
          `and(created_at.eq.${opts.inboundMessage.created_at},id.gt.${opts.inboundMessage.id})`,
      )
      .limit(20);
    return (data ?? []).some(
      (m: { content_text?: string | null; media_url?: string | null }) =>
        Boolean((m.content_text ?? '').trim()) || Boolean(m.media_url),
    );
  };

  await sleep(8000);
  if (await newerAnswerableInbound()) return true; // el run del DM más nuevo cerrará

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
    links: await loadStoreLinks(db, opts.workspaceId, plan.recommended_products),
    offer,
    name: opts.contact.name,
    inbound: opts.inboundText,
    leadScore: rec.lead_score,
    personaHint: profile?.persona_hint ?? null,
    followsBusiness: profile?.follows_business ?? null,
    segment,
  });
  // No pudimos generar respuesta (p.ej. Anthropic caído/sin crédito): NO
  // reclamamos el DM — devolvemos false para que el asistente genérico dé su
  // fallback de cortesía/handoff en vez de dejar al cliente en silencio.
  if (!reply) return false;

  // Segunda guarda (post-LLM, espeja el runner genérico): entre el debounce y
  // el envío corrió la generación (varios segundos). Re-leemos estado FRESCO
  // de la conversación — un humano pudo tomar el chat o apagar la IA en ese
  // lapso (el check inicial usó un snapshot previo al sleep) — y re-chequeamos
  // ráfaga. Si algo cambió, cedemos sin enviar.
  const { data: freshConv } = await db
    .from('conversations')
    .select('ai_enabled, assigned_agent_id, status')
    .eq('id', conv.id)
    .maybeSingle();
  const fc = freshConv as
    | { ai_enabled?: boolean | null; assigned_agent_id?: string | null; status?: string | null }
    | null;
  if (fc && (fc.ai_enabled === false || fc.assigned_agent_id || fc.status === 'closed')) {
    return false;
  }
  if (await newerAnswerableInbound()) return true;

  let closerRes: Awaited<ReturnType<typeof instagramAdapter.sendText>> | null = null;
  try {
    closerRes = await instagramAdapter.sendText({
      channel: 'instagram',
      connection: opts.connection,
      conversation: { id: '' } as unknown as Conversation,
      contact: {
        id: opts.contact.id,
        external_id: opts.contact.external_id,
      } as unknown as Contact,
      text: reply,
    } satisfies OutboundText);
  } catch (err) {
    // NO tragar el fallo de envío: devolvemos false para que el asistente
    // genérico intente responder (marca la conexión caída / da cortesía) en
    // vez de dejar al cliente en silencio, y no marcamos 'replied' sobre un
    // envío que nunca salió (antes se marcaba antes de enviar, ocultando el
    // fallo y suprimiendo el fallback).
    console.error('[ig-closer] send failed:', err);
    return false;
  }

  // Éxito: recién ahora marcamos replied y logueamos el envío proactivo.
  await db
    .from('instagram_campaign_recipients')
    .update({ status: 'replied', replied_at: new Date().toISOString() })
    .eq('id', rec.id);
  await recordProactiveDm(db, {
    workspaceId: opts.workspaceId,
    contactId: opts.contact.id,
    externalId: opts.contact.external_id,
    connection: opts.connection,
    text: reply,
    dmMessageId: closerRes?.externalMessageId ?? null,
    origin: 'ig_outreach',
    originName: plan.campaign_name ?? null,
  });
  await logProactiveSend(db, {
    workspaceId: opts.workspaceId,
    campaignId: camp.id,
    contactId: opts.contact.id,
    kind: 'closer',
    text: reply,
  });
  return true;
}
