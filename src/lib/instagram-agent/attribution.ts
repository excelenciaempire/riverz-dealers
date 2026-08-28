import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchRecentOrders,
  getActiveShopifyConnection,
  normPhone,
  type ShopifyOrder,
} from '@/lib/attribution/shopify';
import { EMPTY_METRICS, type CampaignMetrics, type InstagramCampaign } from './types';
import { recordOrderAttribution } from './order-attribution';
import { traerTodo } from '@/lib/db/paginar';

/**
 * Cierra el loop de atribución de una campaña con INCREMENTALIDAD real (el
 * diferenciador frente a la atribución de último toque de Blueberry):
 *   1. Matchea órdenes de Shopify (por offer_code o email/teléfono) con los
 *      destinatarios tratados → los marca `converted` con su ingreso.
 *   2. Mide el grupo de control (holdout, que NO recibió DM) para calcular el
 *      revenue *incremental* — el que no habría ocurrido sin el agente.
 *   3. Persiste las métricas para el dashboard en vivo.
 *
 * Si Shopify no está conectado, igual recalcula el embudo (sin ingresos).
 * Service-role: el cron no tiene sesión.
 */
const ATTRIBUTION_WINDOW_DAYS = 7;

interface ContactRef {
  email: string | null;
  phone: string | null;
}

interface RecipientRow {
  id: string;
  contact_id: string | null;
  status: string;
  is_holdout: boolean;
  sent_at: string | null;
  revenue: number | null;
  currency: string | null;
  discount_code: string | null;
  contacts: ContactRef | ContactRef[] | null;
}

/** ¿La orden usó el código de descuento de la campaña? (case-insensitive) */
export function orderUsedCode(
  order: Pick<ShopifyOrder, 'discount_codes'>,
  code: string | null | undefined,
): boolean {
  if (!code) return false;
  const target = code.trim().toLowerCase();
  if (!target) return false;
  return (order.discount_codes ?? []).some(
    (d) => (d.code ?? '').trim().toLowerCase() === target,
  );
}

/**
 * Calcula la incrementalidad a partir de las tasas de conversión de tratado vs
 * control. Pura (testeable).
 *
 *   controlRate    = controlConversions / controlSize
 *   incrementales  = max(0, treatmentConversions − treatmentSize × controlRate)
 *   revenueInc     = treatmentRevenue × (incrementales / treatmentConversions)
 *   uplift%        = treatmentRate / controlRate − 1
 */
export function computeIncrementality(input: {
  treatmentSize: number;
  treatmentConversions: number;
  treatmentRevenue: number;
  controlSize: number;
  controlConversions: number;
}): {
  incremental_conversions: number;
  incremental_revenue: number;
  uplift_pct: number;
} {
  const { treatmentSize, treatmentConversions, treatmentRevenue, controlSize, controlConversions } =
    input;
  const controlRate = controlSize > 0 ? controlConversions / controlSize : 0;
  const treatmentRate = treatmentSize > 0 ? treatmentConversions / treatmentSize : 0;

  // Sin control (o control vacío): no podemos afirmar incrementalidad → la
  // igualamos a las conversiones brutas (conservador: sin baseline que restar).
  const expectedFromBaseline = controlSize > 0 ? treatmentSize * controlRate : 0;
  const incrementalConversions = Math.max(0, treatmentConversions - expectedFromBaseline);

  const incrementalRevenue =
    treatmentConversions > 0
      ? Math.round(treatmentRevenue * (incrementalConversions / treatmentConversions) * 100) / 100
      : 0;

  const upliftPct =
    controlRate > 0 ? Math.round((treatmentRate / controlRate - 1) * 100) : 0;

  return {
    incremental_conversions: Math.round(incrementalConversions * 10) / 10,
    incremental_revenue: incrementalRevenue,
    uplift_pct: upliftPct,
  };
}

function contactOf(r: { contacts: ContactRef | ContactRef[] | null }): ContactRef | null {
  return Array.isArray(r.contacts) ? r.contacts[0] ?? null : r.contacts;
}

export async function attributeAndRollup(
  db: SupabaseClient,
  campaign: Pick<
    InstagramCampaign,
    'id' | 'workspace_id' | 'launched_at' | 'offer_code'
  >,
): Promise<CampaignMetrics> {
  const recipients = await traerTodo((d, h) =>
    db
      .from('instagram_campaign_recipients')
      .select('id, contact_id, status, is_holdout, sent_at, revenue, currency, discount_code, contacts(email, phone)')
      .eq('campaign_id', campaign.id)
      .order('id', { ascending: true })
      .range(d, h),
  );
  const rows = (recipients ?? []) as unknown as RecipientRow[];

  // 1) Atribución desde Shopify (best-effort): convierte tratados + mide control.
  let currency = EMPTY_METRICS.currency;
  let controlConversions = 0;
  try {
    const r = await attributeFromShopify(db, campaign, rows);
    if (r.currency) currency = r.currency;
    controlConversions = r.controlConversions;
  } catch {
    /* Shopify caído / sin conectar: seguimos con el rollup de estados. */
  }

  // 2) Rollup — releer estados ya actualizados.
  const fresh = await traerTodo((d, h) =>
    db
      .from('instagram_campaign_recipients')
      .select('status, is_holdout, revenue, currency')
      .eq('campaign_id', campaign.id)
      .order('id', { ascending: true })
      .range(d, h),
  );
  const freshRows = (fresh ?? []) as Array<{
    status: string;
    is_holdout: boolean;
    revenue: number | null;
    currency: string | null;
  }>;

  const metrics: CampaignMetrics = { ...EMPTY_METRICS, currency };
  metrics.recipients = freshRows.length;
  for (const r of freshRows) {
    if (r.is_holdout) {
      metrics.control_size += 1;
      continue;
    }
    metrics.treatment_size += 1;
    if (r.status === 'sent' || r.status === 'replied' || r.status === 'converted') {
      metrics.contacted += 1;
    }
    if (r.status === 'replied' || r.status === 'converted') metrics.replies += 1;
    if (r.status === 'converted') {
      metrics.conversions += 1;
      metrics.revenue += Number(r.revenue ?? 0) || 0;
      if (r.currency) metrics.currency = r.currency;
    }
  }

  metrics.control_conversions = controlConversions;
  const inc = computeIncrementality({
    treatmentSize: metrics.treatment_size,
    treatmentConversions: metrics.conversions,
    treatmentRevenue: metrics.revenue,
    controlSize: metrics.control_size,
    controlConversions,
  });
  metrics.incremental_conversions = inc.incremental_conversions;
  metrics.incremental_revenue = inc.incremental_revenue;
  metrics.uplift_pct = inc.uplift_pct;

  await db.from('instagram_campaigns').update({ metrics }).eq('id', campaign.id);
  return metrics;
}

async function attributeFromShopify(
  db: SupabaseClient,
  campaign: Pick<InstagramCampaign, 'id' | 'workspace_id' | 'launched_at' | 'offer_code'>,
  rows: RecipientRow[],
): Promise<{ currency: string | null; controlConversions: number }> {
  // Tratados pendientes de convertir (no holdout, enviados/respondidos).
  const treatmentPending = new Map<
    string,
    { id: string; sentAt: number; contactId: string | null }
  >();
  const treatmentPendingPhone = new Map<
    string,
    { id: string; sentAt: number; contactId: string | null }
  >();
  // Código único → destinatario: atribución DETERMINISTA (la orden usó SU
  // código → convirtió ESA persona), sin adivinar por email/teléfono.
  const codeToRecipient = new Map<string, { id: string; contactId: string | null }>();
  // Identidades del grupo de control para medir su baseline de compra.
  const controlEmails = new Set<string>();
  const controlPhones = new Set<string>();

  for (const r of rows) {
    const c = contactOf(r);
    if (r.is_holdout) {
      if (c?.email) controlEmails.add(c.email.toLowerCase());
      const np = normPhone(c?.phone);
      if (np) controlPhones.add(np);
      continue;
    }
    if (r.status === 'sent' || r.status === 'replied') {
      const sentAt = r.sent_at ? new Date(r.sent_at).getTime() : 0;
      if (r.discount_code) {
        codeToRecipient.set(r.discount_code.trim().toLowerCase(), {
          id: r.id,
          contactId: r.contact_id,
        });
      }
      if (!c) continue;
      if (c.email)
        treatmentPending.set(c.email.toLowerCase(), {
          id: r.id,
          sentAt,
          contactId: r.contact_id,
        });
      const np = normPhone(c.phone);
      if (np)
        treatmentPendingPhone.set(np, { id: r.id, sentAt, contactId: r.contact_id });
    }
  }

  const nothingToDo =
    treatmentPending.size === 0 &&
    treatmentPendingPhone.size === 0 &&
    codeToRecipient.size === 0 &&
    controlEmails.size === 0 &&
    controlPhones.size === 0;
  if (nothingToDo) return { currency: null, controlConversions: 0 };

  // Conexión Shopify del workspace (token descifrado, o null si no conecta).
  const conn = await getActiveShopifyConnection(db, campaign.workspace_id);
  if (!conn) return { currency: null, controlConversions: 0 };

  const since = campaign.launched_at
    ? new Date(campaign.launched_at)
    : new Date(Date.now() - 30 * 86_400_000);
  const orders = await fetchRecentOrders(conn, since.toISOString());

  let currency: string | null = null;
  let controlConversions = 0;
  const countedControl = new Set<string>();

  for (const order of orders) {
    const orderTime = new Date(order.created_at).getTime();
    const email = order.email?.toLowerCase() ?? null;
    const phone = normPhone(order.phone);

    // (a) Conversión del grupo de control (baseline orgánico).
    const controlKey =
      (email && controlEmails.has(email) && `e:${email}`) ||
      (phone && controlPhones.has(phone) && `p:${phone}`) ||
      null;
    if (controlKey && !countedControl.has(controlKey)) {
      countedControl.add(controlKey);
      controlConversions += 1;
      currency = order.currency || currency;
    }

    // (b0) Atribución determinista por código único: si la orden usó el
    // código personal de un destinatario, esa persona convirtió — sin
    // ventana de tiempo ni match por identidad.
    let matchedByCode = false;
    for (const dc of order.discount_codes ?? []) {
      const key = (dc.code ?? '').trim().toLowerCase();
      const rec = key ? codeToRecipient.get(key) : undefined;
      if (rec) {
        const total = Number(order.total_price ?? '0') || 0;
        currency = order.currency || currency;
        await db
          .from('instagram_campaign_recipients')
          .update({
            status: 'converted',
            converted_at: new Date().toISOString(),
            revenue: total,
            currency: order.currency ?? null,
          })
          .eq('id', rec.id);
        await recordOrderAttribution(db, {
          workspaceId: campaign.workspace_id,
          shopifyOrderId: String(order.id),
          source: 'campaign',
          campaignId: campaign.id,
          contactId: rec.contactId,
          channel: 'instagram',
          code: dc.code ?? null,
          revenue: total,
          currency: order.currency ?? null,
        });
        codeToRecipient.delete(key); // un código, una conversión
        matchedByCode = true;
        break;
      }
    }
    if (matchedByCode) continue;

    // (b) Conversión del grupo tratado.
    const match =
      (email && treatmentPending.get(email)) ||
      (phone && treatmentPendingPhone.get(phone)) ||
      null;
    if (!match) continue;
    const usedCode = orderUsedCode(order, campaign.offer_code);
    if (!usedCode) {
      if (orderTime <= match.sentAt) continue;
      if (orderTime - match.sentAt > ATTRIBUTION_WINDOW_DAYS * 86_400_000) continue;
    }
    const total = Number(order.total_price ?? '0') || 0;
    currency = order.currency || currency;
    await db
      .from('instagram_campaign_recipients')
      .update({
        status: 'converted',
        converted_at: new Date().toISOString(),
        revenue: total,
        currency: order.currency ?? null,
      })
      .eq('id', match.id);
    await recordOrderAttribution(db, {
      workspaceId: campaign.workspace_id,
      shopifyOrderId: String(order.id),
      source: 'campaign',
      campaignId: campaign.id,
      contactId: match.contactId,
      channel: 'instagram',
      code: campaign.offer_code ?? null,
      revenue: total,
      currency: order.currency ?? null,
    });
    // One recipient converts once. Drop their identities so a SECOND order
    // in the same run can't re-match and OVERWRITE the attributed revenue
    // (the code path already does this via codeToRecipient.delete).
    if (email) treatmentPending.delete(email);
    if (phone) treatmentPendingPhone.delete(phone);
  }

  return { currency, controlConversions };
}
