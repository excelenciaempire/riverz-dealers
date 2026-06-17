/**
 * Tipos compartidos del Agente de Instagram. El plan lo genera Claude en
 * /api/ai/instagram-agent; al guardarse se persiste en instagram_campaigns
 * (migración 066) y se ejecuta materializando instagram_campaign_recipients.
 */

export interface InstagramOffer {
  code: string;
  discount: string;
  conditions: string;
}

export interface InstagramFunnel {
  contacted: number;
  replies: number;
  conversions: number;
  est_revenue: string;
}

/** Plan tal como lo devuelve el endpoint generador y lo consume la UI. */
export interface InstagramPlan {
  campaign_name: string;
  audience: { description: string; source: string; estimated_reach: number };
  message: { text: string; preview_name: string };
  offer: InstagramOffer | null;
  follow_up: string;
  comment_reply: string;
  recommended_products: string[];
  funnel: InstagramFunnel;
  next_steps: string[];
}

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'done';

export type RecipientStatus =
  | 'queued'
  | 'sent'
  | 'replied'
  | 'converted'
  | 'skipped'
  | 'failed';

/** Métricas acumuladas reales (no la estimación del plan). */
export interface CampaignMetrics {
  recipients: number;
  contacted: number;
  replies: number;
  conversions: number;
  revenue: number;
  currency: string;
  // Incrementalidad (holdout): el diferenciador clave — revenue que NO
  // habría ocurrido sin el agente, no atribución de último toque.
  treatment_size: number;
  control_size: number;
  control_conversions: number;
  incremental_conversions: number;
  incremental_revenue: number;
  /** Uplift % del grupo tratado vs control (conversion-rate). */
  uplift_pct: number;
}

export interface InstagramCampaign {
  id: string;
  workspace_id: string;
  created_by: string | null;
  name: string;
  goal: string;
  status: CampaignStatus;
  plan: InstagramPlan;
  offer_code: string | null;
  metrics: CampaignMetrics | Record<string, never>;
  launched_at: string | null;
  created_at: string;
  updated_at: string;
}

export const EMPTY_METRICS: CampaignMetrics = {
  recipients: 0,
  contacted: 0,
  replies: 0,
  conversions: 0,
  revenue: 0,
  currency: 'USD',
  treatment_size: 0,
  control_size: 0,
  control_conversions: 0,
  incremental_conversions: 0,
  incremental_revenue: 0,
  uplift_pct: 0,
};

/**
 * Valida (de forma defensiva) que un objeto desconocido tenga la forma
 * mínima de un InstagramPlan antes de persistirlo. Devuelve el plan tipado
 * o null si no cumple lo esencial.
 */
export function coercePlan(value: unknown): InstagramPlan | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  const audience = p.audience as Record<string, unknown> | undefined;
  const message = p.message as Record<string, unknown> | undefined;
  const funnel = p.funnel as Record<string, unknown> | undefined;
  if (
    typeof p.campaign_name !== 'string' ||
    !audience ||
    typeof audience.description !== 'string' ||
    !message ||
    typeof message.text !== 'string'
  ) {
    return null;
  }
  return {
    campaign_name: p.campaign_name,
    audience: {
      description: String(audience.description ?? ''),
      source: String(audience.source ?? ''),
      estimated_reach: Number(audience.estimated_reach ?? 0) || 0,
    },
    message: {
      text: String(message.text ?? ''),
      preview_name: String(message.preview_name ?? 'María'),
    },
    offer: coerceOffer(p.offer),
    follow_up: String(p.follow_up ?? ''),
    comment_reply: String(p.comment_reply ?? ''),
    recommended_products: Array.isArray(p.recommended_products)
      ? (p.recommended_products as unknown[]).map(String).slice(0, 8)
      : [],
    funnel: {
      contacted: Number(funnel?.contacted ?? 0) || 0,
      replies: Number(funnel?.replies ?? 0) || 0,
      conversions: Number(funnel?.conversions ?? 0) || 0,
      est_revenue: String(funnel?.est_revenue ?? ''),
    },
    next_steps: Array.isArray(p.next_steps)
      ? (p.next_steps as unknown[]).map(String).slice(0, 6)
      : [],
  };
}

function coerceOffer(value: unknown): InstagramOffer | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (!o.code) return null;
  return {
    code: String(o.code).toUpperCase().slice(0, 40),
    discount: String(o.discount ?? ''),
    conditions: String(o.conditions ?? ''),
  };
}
