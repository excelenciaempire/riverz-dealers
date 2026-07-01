/**
 * Audience segmentation for Instagram 1:1 — the "clases de público".
 *
 * We message everyone who interacts, but not everyone the same way. A contact's
 * class is derived ONLY from behavior, purchase history and the owned-audience
 * relationship — NEVER from inferred sensitive/protected attributes (Meta Ad
 * Standards + Platform Terms). The profile-pic persona hint may color the copy
 * but must not define a segment. Each class shifts the tone AND the offer so a
 * new non-follower and a returning VIP don't get the same DM.
 */

export type LeadScore = 'high' | 'medium' | 'low';

export interface IgSegment {
  /** Machine key. */
  class:
    | 'creator'
    | 'vip'
    | 'returning'
    | 'cart_abandoner'
    | 'engaged_follower'
    | 'new_high_intent'
    | 'low_intent'
    | 'standard';
  /** Short human label (es) for a badge / prompt. */
  label: string;
  /** Guidance for the DM tone. */
  toneHint: string;
  /** Guidance for the offer. */
  offerHint: string;
}

export interface SegmentSignals {
  followsBusiness?: boolean | null;
  followerCount?: number | null;
  isVerified?: boolean | null;
  leadScore?: LeadScore | null;
  // Shopify (optional — absent until a store is connected → degrades gracefully).
  ordersCount?: number | null;
  totalSpent?: number | null;
  hasAbandonedCart?: boolean | null;
}

const CREATOR_FOLLOWERS = 20_000;
const VIP_ORDERS = 5;

/**
 * Resolve the class from the strongest available signal, in priority order.
 * Degrades to Meta-only axes (relationship / follower tier / intent) when
 * Shopify buyer data is absent.
 */
export function resolveIgSegment(s: SegmentSignals): IgSegment {
  const followers = s.followerCount ?? 0;
  const orders = s.ordersCount ?? 0;

  if (s.isVerified || followers >= CREATOR_FOLLOWERS) {
    return {
      class: 'creator',
      label: 'creador/verificado',
      toneHint: 'trato de par, ángulo de colaboración o gifting; deriva a una persona del equipo',
      offerHint: 'invitación a colaborar, NO un cupón',
    };
  }
  if (orders >= VIP_ORDERS) {
    return {
      class: 'vip',
      label: 'VIP',
      toneHint: 'concierge, cálido, sin presión; reconoce su fidelidad',
      offerHint: 'un perk o acceso, evita descuento (protege margen)',
    };
  }
  if (s.hasAbandonedCart) {
    return {
      class: 'cart_abandoner',
      label: 'carrito abandonado',
      toneHint: 'retoma el producto exacto que dejó, útil y directo',
      offerHint: 'código de recuperación con vigencia corta',
    };
  }
  if (orders >= 1) {
    return {
      class: 'returning',
      label: 'recurrente',
      toneHint: 'familiaridad, “qué bueno verte de vuelta”',
      offerHint: 'lealtad o acceso anticipado, NO un descuento de primerizo',
    };
  }
  if (s.followsBusiness && s.leadScore !== 'low') {
    return {
      class: 'engaged_follower',
      label: 'seguidor activo',
      toneHint: 'cálido y cercano; ya te sigue, no hace falta convencer de eso',
      offerHint: 'código de bienvenida estándar',
    };
  }
  if (s.leadScore === 'high') {
    return {
      class: 'new_high_intent',
      label: 'nuevo, alta intención',
      toneHint: 'cálido, baja fricción; invita suavemente a seguirte',
      offerHint: 'código de bienvenida estándar',
    };
  }
  if (s.leadScore === 'low') {
    return {
      class: 'low_intent',
      label: 'baja intención',
      toneHint: 'breve y sin presión',
      offerHint: 'sin oferta',
    };
  }
  return {
    class: 'standard',
    label: 'estándar',
    toneHint: 'cálido y natural',
    offerHint: 'la oferta de la campaña si aplica',
  };
}
